# 🔊 SonicSwarm

### The P2P Music Network You Actually Own

**SonicSwarm** is a self-hosted, peer-to-peer music streaming platform that turns the entire BitTorrent DHT network into your personal music library. No subscriptions. No corporate gatekeepers. No centralized servers holding your listening data. Just you, the swarm, and every song ever released — streamed on demand, directly from other listeners around the world.

---

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D16.0.0-green" alt="Node Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />
</p>

---

## 🧠 What Makes SonicSwarm Different?

| Traditional Streaming | SonicSwarm |
|---|---|
| Pay $12/month forever | **Free. Forever.** |
| Company owns the catalog | **The swarm owns the catalog** |
| Tracks disappear when licenses expire | **Tracks live as long as one person seeds** |
| Your listening data is tracked and sold | **Your data stays on your machine** |
| Region-locked, censored catalogs | **Global. Uncensored. Unstoppable.** |
| Centralized servers can go down | **The swarm has no single point of failure** |

SonicSwarm doesn't stream music *to* you from a data center. It streams music *through* you, from a decentralized mesh of peers running standard BitTorrent over TCP/UDP. Every listener is also a server. Every song is a torrent. Every album is a swarm.

---

## 🎯 How It Works (In Plain English)

### 1. Search for Anything
Type an artist, album, or track name. SonicSwarm queries the **iTunes Search API** and the **MusicBrainz** community database to find matching albums — complete with high-resolution cover art, tracklists, and release years.

### 2. Pick a Source (Stremio-Style)
Click a track and a drawer slides open showing every available source on the P2P network — ranked by quality (FLAC, MP3-320, MP3-V0) and seed count. Sources come from:

- **ThePirateBay** — The oldest and largest public tracker
- **SolidTorrents** — A modern torrent aggregator
- **Jackett** (optional) — Your private tracker gateway

### 3. The Swarm Takes Over
Behind the scenes, `torrent-stream` establishes a full BitTorrent connection over standard TCP/UDP — not the limited WebRTC subset used by browser-only clients. This means SonicSwarm connects to **millions of desktop torrent clients**, not just a niche WebTorrent network. The result: more peers, faster downloads, and access to torrents that have been seeding for decades.

### 4. Stream Instantly
The music starts playing the moment enough data arrives — no waiting for the full download. SonicSwarm prioritizes the first chunks of audio so playback begins in seconds. Skip tracks, seek through the timeline, and the engine adapts.

### 5. Auto-Advance Like a Real Player
When a track ends, SonicSwarm is smart:

- **Strategy 1:** If you're playing from an album pack torrent, it finds the next track inside the same torrent and jumps there — no new connections needed. Instant.
- **Strategy 2:** If the next track isn't in the current torrent, it queries `/api/sources` in the background, ranks results by quality preference and seeders, and spins up a fresh stream.

Manual skips (Next/Prev buttons) use the **exact same logic** via a shared `executeTrackChange` function. No split code paths. No edge cases.

---

## 🖥️ The Interface

SonicSwarm has a dark-themed, three-panel interface inspired by the best desktop music players:

```
┌──────────────┬────────────────────────────────┬──────────────┐
│              │                                │              │
│   Sidebar    │        Main Content            │   Stats      │
│              │                                │              │
│  • Library   │   [Album Art]                  │  14 peers    │
│  • Search    │   Album Title                  │  ↓ 2.4 MB/s  │
│              │   Artist • Year                │  67% buffrd  │
│  Swarm:      │                                │              │
│  3 active    │   #  Title       Status  Dur   │              │
│  47 peers    │   1  Track One   Ready   3:42  │              │
│              │   2  Track Two   Queue   4:15  │              │
│              │   3  Track Three Queue   2:58  │              │
│              │                                │              │
├──────────────┴────────────────────────────────┴──────────────┤
│ 🎵 Track Name — Artist                     ↓ 2.4 MB/s  47p   │
│  ◀◀   ▶   ⏸   ▶▶     ───⬤─────────────     1:23 / 3:42   │
└──────────────────────────────────────────────────────────────┘
```

- **Left Sidebar:** Your library, search navigation, and live swarm statistics
- **Center:** The album grid, search results, and detailed album view with tracklist
- **Bottom Player Bar:** Fixed playback controls with seekable progress bar, live peer count, and download speed
- **Source Picker Drawer:** Slides out below any track to show all available torrent sources, à la Stremio/Torrentio

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** ≥ 16.0.0
- **npm** ≥ 8.0.0
- A network connection that allows BitTorrent traffic (most do)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/sonicswarm.git
cd sonicswarm

# Install dependencies
npm install

# Build the React frontend
npm run build:ui

# Start the server
npm start
```

Open your browser to **`http://localhost:9191`**. That's it. You're live on the swarm.

### Development Mode

```bash
# Terminal 1: Start the backend with auto-reload
npm run dev

# Terminal 2: Start the React dev server with hot module replacement
npm run dev:ui
```

The UI dev server runs on `http://localhost:3000` and proxies API requests to the backend on `:9191`.

---

## 🧱 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     YOUR BROWSER                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              React SPA (Vite)                    │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────┐   │    │
│  │  │ App.jsx  │  │ SonicSwarm   │  │  CSS     │   │    │
│  │  │          │  │ Context.jsx  │  │ (Dark)   │   │    │
│  │  └──────────┘  └──────────────┘  └──────────┘   │    │
│  └───────────────────┬─────────────────────────────┘    │
│                      │  HTTP /api/*                      │
└──────────────────────┼──────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────┐
│              EXPRESS BACKEND (server.js)                 │
│  ┌───────────────────┴─────────────────────────────┐    │
│  │  Routes: /api/search, /api/sources, /api/stream │    │
│  │          /api/resolve, /api/health, ...         │    │
│  └───────────────────┬─────────────────────────────┘    │
│                      │                                   │
│  ┌───────────────────┴─────────────────────────────┐    │
│  │         BitTorrent Engine (torrent-stream)       │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │    │
│  │  │ Engine 1 │  │ Engine 2 │  │  Engine N...  │   │    │
│  │  │(infoHash)│  │(infoHash)│  │               │   │    │
│  │  └────┬─────┘  └────┬─────┘  └──────────────┘   │    │
│  └───────┼─────────────┼────────────────────────────┘    │
│          │             │                                  │
│  ┌───────┴─────────────┴────────────────────────────┐    │
│  │     SQLite Database (better-sqlite3)              │    │
│  │  Albums • Tracks • Torrents • Cache • Library     │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │  TCP/UDP BitTorrent + DHT
                       ▼
          ┌────────────────────────────┐
          │   THE GLOBAL P2P SWARM     │
          │                            │
          │  🌐 Millions of peers      │
          │  📦 Billions of files      │
          │  🔗 Standard BitTorrent    │
          │                            │
          └────────────────────────────┘
```

### Key Design Decisions

| Decision | Why |
|---|---|
| **torrent-stream** over WebTorrent | TCP/UDP connects to 100x more peers than WebRTC-only |
| **Express** for the API layer | Battle-tested HTTP server with rich middleware ecosystem |
| **SQLite via better-sqlite3** | Zero-config, embedded, fast — no separate database process |
| **Vite** for the frontend | Instant HMR, optimized builds, native ESM |
| **React 19** with Context API | Modern reactive UI without Redux boilerplate |
| **lucide-react** for icons | Tree-shakeable, beautiful, consistent icon set |
| **iTunes + MusicBrainz** for metadata | iTunes covers all commercial music; MusicBrainz fills the gaps |

---

## 📡 API Reference

All endpoints are served from `http://localhost:9191/api`.

### Search & Discovery

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q=...&type=album` | Search iTunes + MusicBrainz for albums |
| `GET` | `/api/discover?genre=...&page=...` | Curated discovery homepage |
| `GET` | `/api/album/:id/tracks` | Full tracklist (iTunes Lookup → MusicBrainz → cache) |
| `POST` | `/api/sources` | Stremio-style scraper: metadata + ranked sources |

### Torrent Resolution

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/resolve` | Find torrent magnets for artist + track |
| `POST` | `/api/stream` | Start BitTorrent engine + return stream ID |
| `GET` | `/api/torrent/:streamId/file/:index` | Stream audio bytes (HTTP 206 Range) |
| `POST` | `/api/prebuffer` | Pre-cache upcoming tracks in background |

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/swarm-stats` | Live peer count, download speed, swarm status |
| `GET` | `/api/health` | Server uptime, DB stats, BitTorrent status |
| `GET` | `/api/library` | Full local library with tracks |

### Example: Full Playback Flow

```bash
# 1. Search for an artist
curl "http://localhost:9191/api/search?q=kendrick+lamar&type=album"

# 2. Get tracks for an album
curl "http://localhost:9191/api/album/1781316864/tracks"

# 3. Scrape all available sources (Stremio-style)
curl -X POST http://localhost:9191/api/sources \
  -H "Content-Type: application/json" \
  -d '{"artist":"Kendrick Lamar","album":"GNX","track":"squabble up"}'

# 4. Start streaming the best source
curl -X POST http://localhost:9191/api/stream \
  -H "Content-Type: application/json" \
  -d '{"magnet":"magnet:?xt=urn:btih:...","targetTrackTitle":"squabble up"}'

# 5. The audio element will request:
#    GET /api/torrent/{streamId}/file/{fileIndex}
#    with HTTP Range headers for seeking
```

---

## 🧲 The Magnet Paste Superpower

In the search bar, there's a clipboard icon. Click it, and SonicSwarm reads your clipboard. If it finds a magnet link, it:

1. Parses the infoHash and connects to the DHT swarm
2. Waits for the torrent metadata (file list) to arrive
3. Builds a temporary album from every audio file in the torrent
4. Starts playing immediately

This means you can paste **any music magnet link from any site** and start streaming instantly. No metadata needed. No catalog entry. The torrent IS the album.

---

## 🎨 The Stremio-Style Source Picker

When you click a track in the album view, a drawer slides open showing every available source:

```
┌──────────────────────────────────────────────────────────┐
│  📡 Aggregated Swarm Streams                         ✕  │
│──────────────────────────────────────────────────────────│
│  ┌──────────────────────────────────────────────────┐    │
│  │ 📦 Album Pack    FLAC                            │    │
│  │ Kendrick Lamar - GNX (2024) [24Bit-48kHz] FLAC   │    │
│  │ via ThePirateBay                     👥 47 seeds │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 🎵 Single Track  MP3-320                         │    │
│  │ Kendrick Lamar - squabble up.mp3                 │    │
│  │ via SolidTorrents                     👥 23 seeds │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 📦 Album Pack    MP3-V0                          │    │
│  │ Kendrick Lamar - GNX [MP3-V0] [2024]             │    │
│  │ via ThePirateBay (album)              👥 31 seeds │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

Sources are ranked intelligently:
1. **Quality match** — If you started with a FLAC source, FLAC results get priority. Same for MP3-320, etc.
2. **Seed count** — Within the same quality tier, more seeds = higher rank
3. **Album packs** — Torrents containing the full album get a slight boost (they enable instant track switching via Strategy 1)

---

## 🔄 Torrent Resolution: The Multi-Tracker Pipeline

When you search for a track, SonicSwarm doesn't just query one tracker and hope for the best. It runs a sophisticated parallel pipeline:

```
QUERY:  "Kendrick Lamar squabble up"
         │
         ├──▶ ThePirateBay (apibay.org)
         │    • Track-specific search first (faster, focused)
         │    • Album pack search as fallback
         │    • Retry up to 2× with fresh User-Agent headers
         │    ✓ Typically 3-8 results in <800ms
         │
         ├──▶ SolidTorrents (solidtorrents.to)
         │    • JSON API, less aggressively blocked
         │    • Retry up to 2×
         │    ✓ Typically 3-6 results in <400ms
         │
         └──▶ Jackett (optional, self-hosted)
              • Your private trackers via Jackett proxy
              • Only used if JACKETT_URL + JACKETT_API_KEY are set
              ✓ Unlimited private tracker access

         RESULTS MERGED • DEDUPED • SCORED • RANKED
```

### Caching Strategy

- **Empty-result cache (1 hour):** If we already know a query returns nothing, we don't spam the trackers again. This prevents IP bans.
- **Smart retry with exponential backoff:** 403/429/timeout errors trigger automatic retries with random User-Agent headers. 500ms → 1000ms → give up.
- **Torrent metadata cache:** Successfully resolved torrents are stored in SQLite for instant recall on repeat plays.

---

## 🗄️ The Local Database

SonicSwarm ships with a SQLite database that serves as your personal music metadata cache:

| Table | Purpose |
|---|---|
| `albums` | iTunes/MusicBrainz metadata, cover art URLs, release years |
| `tracks` | Full tracklists with durations and track numbers |
| `torrents` | Resolved magnet links with seed counts and quality tags |
| `user_library` | Your pinned/saved albums |
| `torrent_query_cache` | 1-hour TTL empty-result cache to avoid tracker bans |
| `sync_history` | Audit log of all catalog operations |

The database lives at `./data/sonicswarm.db`. You can inspect it with any SQLite browser.

---

## 🚀 Feature Tour

### ✅ Works Today

- **Global Search** — iTunes + MusicBrainz with high-res cover art
- **Stremio-Style Source Picker** — Ranked sources from multiple trackers
- **Full BitTorrent Streaming** — TCP/UDP via torrent-stream (not WebRTC)
- **Album Pack Detection** — Auto-identifies multi-file torrents for instant track switching
- **Smart Auto-Advance** — Two-strategy system (same-torrent jump OR new source fetch)
- **Quality Memory** — Remembers your preferred audio quality and prioritizes matching sources
- **Magnet Paste** — Paste any magnet link to stream instantly
- **HTTP Range Requests** — Full seeking support in the audio player
- **Live Swarm Stats** — Peers, download speed, buffer progress updated every second
- **Pre-Buffering** — Background caching of upcoming tracks for instant skips
- **Responsive Dark UI** — Works on desktop, tablet, and mobile layouts
- **SQLite Metadata Cache** — Instant repeat lookups, no repeated API calls
- **Electron Desktop App** — Optional native window with system menu integration

### 🔮 Roadmap

- [ ] **Local Library Import** — Scan your hard drive and seed your own collection
- [ ] **Playlist System** — Create, save, and share playlists
- [ ] **Social Discovery** — See what swarms are trending, follow friends' libraries
- [ ] **BitTorrent v2 Support** — Per-file hash trees for even faster verification
- [ ] **IPFS Integration** — Dual-stack P2P (BitTorrent + IPFS) for maximum reach
- [ ] **Mobile App** — React Native build with background audio
- [ ] **Libre.fm Scrobbling** — Federated listening history, not corporate surveillance
- [ ] **Multi-Language Metadata** — Search and display results in your language
- [ ] **Offline Mode** — Cache entire albums for offline listening without re-downloading

---

## 🔧 Optional: Jackett Integration

[Jackett](https://github.com/Jackett/Jackett) is a proxy server that translates queries from apps into tracker-site HTTP queries. If you run it locally, SonicSwarm can tap into **every private tracker you have access to**.

```bash
# Set these environment variables before starting
export JACKETT_URL="http://localhost:9117"
export JACKETT_API_KEY="your-jackett-api-key"

npm start
```

SonicSwarm will automatically include Jackett results in the source picker alongside the public trackers.

---

## 🛡️ Privacy & Philosophy

SonicSwarm is built on the belief that **music should belong to everyone**, not to corporations. Here's what that means in practice:

- **No telemetry.** Zero. The code contains no analytics, no crash reporters, no usage tracking. We don't want your data.
- **No accounts.** There is no "SonicSwarm account." Your library lives in your SQLite database on your hard drive.
- **No central servers.** The only servers involved are public tracker APIs (which you can disable) and the BitTorrent DHT (which is fully decentralized).
- **AGPL-3.0 Licensed.** Anyone can use, modify, and redistribute SonicSwarm. If you improve it, you share your improvements. That's the deal.
- **You are a peer, not a product.** When you stream, you also seed. This is how the swarm stays alive. Every listener contributes.

---

## 🤝 Contributing

SonicSwarm is a community project. Whether you're fixing a bug, adding a feature, improving the UI, or writing documentation — you're welcome here.

```bash
# Fork and clone
git clone https://github.com/M2AF/sonic-swarm.git

# Create a branch
git checkout -b feature/my-awesome-feature

# Make your changes, then...
npm run build:ui   # Verify the frontend builds
npm start          # Test locally

# Submit a PR!
```

Please keep the codebase accessible. This is an app for everyone — not just developers.

---

## 📜 License

**GNU Affero General Public License v3.0 (AGPL-3.0)**

This license requires that anyone who runs a modified version of SonicSwarm on a server must make their source code available to the users of that server. This is intentional: if corporations want to use this software to build a service, they must contribute back their improvements to the commons.

See [LICENSE](LICENSE) for the full text.

---

## 🙏 Acknowledgments

SonicSwarm stands on the shoulders of giants:

- **[torrent-stream](https://github.com/mafintosh/torrent-stream)** — The BitTorrent engine that makes this possible
- **[Express](https://expressjs.com/)** — The HTTP framework powering the API
- **[React](https://react.dev/)** — The UI library that makes the interface reactive
- **[Vite](https://vitejs.dev/)** — The build tool that makes development fast
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — The fastest SQLite bindings for Node.js
- **[lucide-react](https://lucide.dev/)** — Beautiful, consistent icons
- **[MusicBrainz](https://musicbrainz.org/)** — The open music encyclopedia
- **[iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)** — Free, keyless, comprehensive catalog
- **[Cover Art Archive](https://coverartarchive.org/)** — Community-driven album artwork
- **The global BitTorrent DHT** — Millions of nodes, zero central servers. The largest decentralized network in human history.

---

<p align="center">
  <strong>🎵 Music belongs to everyone. Now the software does too.</strong>
</p>
