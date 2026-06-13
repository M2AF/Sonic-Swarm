# SonicSwarm × IPFS Bridge — Integration Plan
## Method 1: Dual-Protocol Seeding Container

**Status:** Planning only. No files modified yet.  
**Goal:** When a torrent is fully downloaded, automatically push its files to IPFS, extract the root CID, and inject a public gateway URL as a `ws=` WebSeed parameter into the enriched magnet. Store the infoHash → CID mapping in SQLite so future resolutions can advertise the IPFS fallback seed to all clients.

---

## Architecture Summary

```
[torrent-stream engine]
        │
        │  engine.on('idle') — full download confirmed
        ▼
[backend/ipfs/ipfsBridge.js]
        │
        ├─→ verifyCompleteDownload(engine)  — sanity check bytes
        │
        ├─→ ipfsMultiAdd(dirPath)           — POST to local Kubo API
        │         returns rootCID
        │
        ├─→ buildEnrichedMagnet(infoHash, displayName, rootCID)
        │         appends  &ws=https://ipfs.io/ipfs/{rootCID}/
        │
        └─→ db: INSERT INTO ipfs_seeds (...)
            db: UPDATE torrent_index SET magnet = enrichedMagnet WHERE info_hash = ?
```

The bridge is entirely server-side. No frontend changes are required at this stage. The enriched magnet surfaces automatically when `buildMagnet()` is replaced by `buildEnrichedMagnet()` for any infoHash that has a confirmed CID.

---

## Question 1 — Event Hooking

### Hook location
**File:** `server.js` → `getTorrentEngine()` function  
**Line:** Inside the existing `engine.on('idle', ...)` handler (currently ~line 336)

### Why `idle` and not `ready` or `download`
`torrent-stream` fires events in this order:

| Event      | Meaning                                                  | Suitable for IPFS push? |
|------------|----------------------------------------------------------|-------------------------|
| `ready`    | Torrent metadata received; file list known               | ❌ No files on disk yet  |
| `download` | A piece arrived; fires repeatedly during streaming       | ❌ Partial download      |
| `idle`     | Download queue empty; all requested pieces are on disk   | ⚠️  Conditional (see below) |

### Critical nuance — `idle` ≠ 100% complete
In torrent-stream, `idle` fires when the **priority download queue** is empty — not necessarily when every byte of every file is on disk. During music streaming, only the pieces needed for playback are prioritized; the rest download in the background at lower priority.

**Solution:** Inside the `idle` handler, we add a byte-verification guard before triggering the IPFS push:

```
engine.on('idle', () => {
    // Existing status update (keep it)
    swarm.status = 'seeding';

    // NEW: Check if the full torrent is actually on disk
    //      before attempting an IPFS add
    const totalExpected = engine.files?.reduce((s, f) => s + f.length, 0) || 0;
    const totalDownloaded = engine.swarm?.downloaded || 0;
    const isFullyDownloaded = totalDownloaded >= totalExpected * 0.99; // 99% threshold

    if (isFullyDownloaded && totalExpected > 0) {
        triggerIpfsPush(engine, infoHash);  // Async, non-blocking
    }
});
```

`triggerIpfsPush` will be a fire-and-forget async call exported from `ipfsBridge.js`. It must not throw synchronously into the engine event loop.

### Guard against duplicate pushes
`torrentEngines` (Map) persists for the lifetime of the server. `idle` can fire more than once if pieces are re-requested. The bridge must check the `ipfs_seeds` table first:

```
// Before doing any work:
const alreadyPinned = db.prepare(
    'SELECT id FROM ipfs_seeds WHERE info_hash = ? AND pin_status = "pinned"'
).get(infoHash);
if (alreadyPinned) return;
```

---

## Question 2 — IPFS Multi-Add API

### Node options

| Option | URL | Auth | Privacy | Requires setup |
|--------|-----|------|---------|----------------|
| **Local Kubo** (default) | `http://localhost:5001/api/v0/add` | None | ✅ Full | Run `ipfs daemon` |
| **Pinata** (opt-in) | `https://api.pinata.cloud/pinning/pinFileToIPFS` | `PINATA_JWT` env var | ❌ Cloud | Sign up |
| **web3.storage** (opt-in) | `https://api.web3.storage/upload` | `WEB3_STORAGE_TOKEN` env var | ❌ Cloud | Sign up |

**Default to local Kubo.** Match SonicSwarm's privacy ethos. Remote pinning services are opt-in via `.env` flags. The bridge checks `IPFS_NODE_URL` first, falls back to `http://localhost:5001`.

### The upload call
The IPFS HTTP API accepts a multipart form upload. For a directory:

```
POST http://localhost:5001/api/v0/add
  ?recursive=true
  &wrap-with-directory=true
  &pin=true
  &progress=false
Content-Type: multipart/form-data; boundary=...

[all audio files in the torrent directory as multipart parts]
```

The API returns **newline-delimited JSON** (JSONL), one object per file, with the final object being the root directory:

```jsonl
{"Name":"01 - Track One.mp3","Hash":"QmAbc...","Size":"8234567"}
{"Name":"02 - Track Two.flac","Hash":"QmDef...","Size":"42000000"}
{"Name":"Artist - Album","Hash":"QmROOT...","Size":"..."}
```

The root CID is the last line where `Name` matches the torrent directory name (or `Name === ""`).

### File path resolution
Torrent-stream downloads files into `data/torrents/` (the `tmpDir` constant at ~line 266 of server.js). The exact path for a torrent named `"Artist - Album"` would be:

```
data/torrents/{torrent.name}/
    01 - Track One.mp3
    02 - Track Two.mp3
    ...
```

The bridge reads `engine.torrent.name` to construct `path.join(tmpDir, engine.torrent.name)`.

### What if the user is running without a local Kubo node?
The bridge should fail **silently** with a log warning if the IPFS API is unreachable. It must never block music playback. IPFS push is always a background bonus, not a requirement.

---

## Question 3 — Metadata Injection (WebSeed)

### BEP-19 WebSeed standard
Per **BEP-19**, a torrent client that can't find peers checks for HTTP seed URLs in two keys:
- `url-list` — in the torrent file's bencoded info dict
- `ws=` — magnet URI extension parameter (what we control)

Since SonicSwarm works with **magnets**, not `.torrent` files, the `ws=` magnet parameter is the correct injection point.

### Current `buildMagnet()` signature (server.js ~line 1164)
```js
function buildMagnet(infoHash, displayName) {
  const trackers = ANNOUNCE_LIST.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(displayName)}${trackers}`;
}
```

### New `buildEnrichedMagnet()` signature (in ipfsBridge.js)
```js
function buildEnrichedMagnet(infoHash, displayName, ipfsCID) {
  const base = buildMagnet(infoHash, displayName);   // reuse existing function
  if (!ipfsCID) return base;
  const webseed = `https://ipfs.io/ipfs/${ipfsCID}/`;
  return `${base}&ws=${encodeURIComponent(webseed)}`;
}
```

The `ws=` parameter must point to a **directory URL** (trailing slash required per BEP-19). Clients then append individual filenames: `https://ipfs.io/ipfs/QmROOT/01 - Track One.mp3`.

### Where enriched magnets surface in the app
Two call sites need to check for a stored IPFS CID before returning a magnet to the client:

1. **`GET /api/swarm-stats`** — does not serve magnets, no change needed
2. **`/api/sources` response** — the `magnet` field on each source object
3. **`/api/resolve` response** — the `magnet` field on each torrent object
4. **`torrent_index` table reads** — the `magnet` column returned in fast-path hits

The cleanest approach: **enrich at read time, not write time.** When any route reads a magnet from the DB, it calls a helper:

```js
function enrichMagnetIfPinned(infoHash, rawMagnet) {
    const pin = db.prepare(
        'SELECT ipfs_cid FROM ipfs_seeds WHERE info_hash = ? AND pin_status = "pinned"'
    ).get(infoHash);
    if (!pin) return rawMagnet;
    return buildEnrichedMagnet(infoHash, /* dn from magnet */, pin.ipfs_cid);
}
```

This means the DB is never mutated by the enrichment — the `ipfs_seeds` table is the only new write. The `magnet` columns in `torrents` and `torrent_index` stay as scraped originals (clean, reversible).

---

## Question 4 — Database Schema

### New table: `ipfs_seeds`

```sql
CREATE TABLE IF NOT EXISTS ipfs_seeds (
  id             TEXT    PRIMARY KEY,
  info_hash      TEXT    NOT NULL UNIQUE,
  ipfs_cid       TEXT    NOT NULL,
  gateway_url    TEXT    NOT NULL,     -- "https://ipfs.io/ipfs/{CID}/"
  pinning_service TEXT   DEFAULT 'local', -- 'local' | 'pinata' | 'web3storage'
  pin_status     TEXT    DEFAULT 'pending', -- 'pending' | 'pinned' | 'failed'
  file_count     INTEGER,
  total_bytes    INTEGER,
  pinned_at      INTEGER,              -- unixepoch() when pin confirmed
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ipfs_seeds_hash ON ipfs_seeds(info_hash);
CREATE INDEX IF NOT EXISTS idx_ipfs_seeds_status ON ipfs_seeds(pin_status);
```

### Why `info_hash` as the join key (not `magnet` or `torrent.id`)
- `info_hash` is the canonical identifier for a torrent across all tables
- `torrents` table has a `magnet UNIQUE` column but its `id` is a UUID — not portable
- `torrent_index` uses `info_hash TEXT NOT NULL` directly
- `activeTorrents` Map is keyed by `streamId` (UUID), but `torrentEngines` is keyed by `info_hash`
- **Join chain:** `ipfs_seeds.info_hash` → `torrent_index.info_hash` → `torrents.magnet`

### No schema migration risk
The `ipfs_seeds` table is additive. `CREATE TABLE IF NOT EXISTS` means existing databases are unaffected. No ALTER TABLE required. This avoids the migration debt noted in the audit until a proper migration runner is in place.

### `.env` additions required
```
# IPFS Bridge — all optional
IPFS_NODE_URL=http://localhost:5001       # Default: local Kubo daemon
IPFS_PUBLIC_GATEWAY=https://ipfs.io       # Gateway used in ws= WebSeed URL
IPFS_ENABLED=true                         # Master switch — default false until stable
PINATA_JWT=                               # Optional cloud pinning fallback
```

---

## New File Structure

```
backend/
  server.js                       ← existing, minimal changes (hook + helper call)
  ipfs/
    ipfsBridge.js                 ← Phase 1: core module (upload + verify + store)
    metadataInjector.js           ← Phase 2: enrichMagnetIfPinned(), buildEnrichedMagnet()
    pinningServices.js            ← Phase 3: Pinata/web3.storage adapters
```

The three files in `backend/ipfs/` are pure ES modules imported by `server.js`. They share the `db` instance (passed as a parameter, not imported — avoids circular deps) and the `tmpDir` constant.

---

## Implementation Order

### Phase 1 — Backbone (first session)
1. Create `backend/ipfs/ipfsBridge.js` with:
   - `isIpfsAvailable()` — health-checks `IPFS_NODE_URL/api/v0/version`
   - `ipfsAddDirectory(dirPath)` — multipart POST, returns `rootCID`
   - `savePinRecord(db, infoHash, cid, gateway, fileCount, totalBytes)` — writes `ipfs_seeds`
   - `triggerIpfsPush(db, engine, infoHash, tmpDir)` — orchestrator (called from idle hook)
2. Add `ipfs_seeds` table to `initializeDatabase()` in server.js
3. Add `.env` variables: `IPFS_ENABLED`, `IPFS_NODE_URL`, `IPFS_PUBLIC_GATEWAY`
4. Wire the idle hook in `getTorrentEngine()` — call `triggerIpfsPush` behind `IPFS_ENABLED` guard

**Verification gate:** After Phase 1, manually play a full album, confirm `ipfs_seeds` row is written with `pin_status = 'pinned'`, and verify the CID resolves at `https://ipfs.io/ipfs/{CID}/`.

### Phase 2 — Magnet Enrichment (second session)
5. Create `backend/ipfs/metadataInjector.js` with `enrichMagnetIfPinned(db, infoHash, rawMagnet)`
6. Import and apply to `/api/sources` and `/api/resolve` response builders
7. Add `buildEnrichedMagnet(infoHash, displayName, cid)` as an exported variant of `buildMagnet`

**Verification gate:** Call `/api/sources` for a track whose torrent was previously pinned. Confirm `ws=` parameter appears in the returned magnet. Paste magnet into a client that supports WebSeeds (qBittorrent) and confirm it fetches from IPFS when peers are blocked.

### Phase 3 — Cloud Pinning Fallback (third session, optional)
8. Create `backend/ipfs/pinningServices.js` with `pinWithPinata(cid, name)` and `pinWithWeb3Storage(dirPath)`
9. Add fallback chain in `triggerIpfsPush`: try local Kubo → if fails, try Pinata (if key set) → log and bail gracefully
10. Add `GET /api/ipfs/status` route to expose bridge health to admin

---

## Open Questions

| # | Question | Impact | Decision needed before |
|---|----------|--------|----------------------|
| 1 | Should `IPFS_ENABLED` default to `false` or `true`? | UX (opt-in vs. ambient) | Phase 1 |
| 2 | Which public gateway for `ws=` URL — `ipfs.io` or `dweb.link`? `dweb.link` has better uptime SLA. | Reliability | Phase 2 |
| 3 | Do we re-pin on every idle event, or only once per `info_hash`? | DB writes, Kubo storage | Phase 1 |
| 4 | Should the bridge also update the `magnet` column in `torrent_index` with the enriched URI, or keep read-time enrichment only? | DB write complexity | Phase 2 |
| 5 | For album packs with 10+ files, the IPFS add could take 30-120 seconds. Do we show a UI indicator? | Frontend work | Phase 2/3 |

---

## Dependencies to Install

```bash
# No new npm packages required for Phase 1.
# The Kubo HTTP API is called with the existing `axios` package (already in package.json).
# FormData for multipart upload uses Node.js built-in `FormData` (available in Node 18+).

# Optional — Phase 3 only (cloud pinning):
# npm install @pinata/sdk           # Pinata SDK
# npm install @web3-storage/w3up-client  # web3.storage v2 client
```

Phase 1 and 2 add **zero new npm dependencies**. The bridge uses `axios` (already present) and Node 18's native `FormData` + `fs.createReadStream`.

---

*Plan authored: June 2026 — ManCave Productions / SonicSwarm*
