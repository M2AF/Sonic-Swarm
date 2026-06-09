/**
 * SonicSwarm Backend Server
 * Full P2P music streaming infrastructure
 * 
 * Start: npm start (from project root)
 * API: http://localhost:9191
 * Frontend: http://localhost:9191
 */

import dotenv from 'dotenv';
import path, { resolve } from 'path';

// Explicitly load .env from project root — works reliably in ES modules
// regardless of which subdirectory server.js lives in
dotenv.config({ path: resolve(process.cwd(), '.env') });

import express from 'express';
import torrentStream from 'torrent-stream';
import axios from 'axios';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { createServer as createViteServer } from 'vite';

// ─────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────

// Prevent WebTorrent v3 null-piece crashes from killing the server
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('Cannot read properties of null')) {
    // WebTorrent v3 bug: null pieces during early download phase — safe to ignore
    return;
  }
  console.error('FATAL:', err);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const app = express();
const PORT = process.env.PORT || 9191;

// Database setup
const dataDir = path.join(rootDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'sonicswarm.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Bump this string whenever you add/remove a provider.
// It busts all stale empty-result caches automatically on restart.
const PROVIDER_SET_VERSION = 'v5-prowlarr';

// Log which optional integrations are active at startup
console.log('🔌 Optional integrations:',
  process.env.PROWLARR_URL  ? `Prowlarr @ ${process.env.PROWLARR_URL}` : 'Prowlarr (not configured)',
  process.env.JACKETT_URL   ? `| Jackett @ ${process.env.JACKETT_URL}` : ''
);

// ─────────────────────────────────────────────────────────
// DATABASE INITIALIZATION
// ─────────────────────────────────────────────────────────

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      year INTEGER,
      mbid TEXT UNIQUE,
      cover_url TEXT,
      track_count INTEGER,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(artist, title)
    );

    CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
    CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      duration INTEGER,
      track_number INTEGER,
      mbid TEXT,
      FOREIGN KEY(album_id) REFERENCES albums(id),
      UNIQUE(album_id, track_number)
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

    CREATE TABLE IF NOT EXISTS torrents (
      id TEXT PRIMARY KEY,
      magnet TEXT UNIQUE NOT NULL,
      track_id TEXT,
      album_id TEXT,
      artist TEXT,
      title TEXT,
      seeders INTEGER DEFAULT 0,
      leechers INTEGER DEFAULT 0,
      file_size INTEGER,
      file_name TEXT,
      quality TEXT,
      source TEXT,
      last_seen TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(track_id) REFERENCES tracks(id),
      FOREIGN KEY(album_id) REFERENCES albums(id)
    );

    CREATE INDEX IF NOT EXISTS idx_torrents_track ON torrents(track_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_album ON torrents(album_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_seeders ON torrents(seeders DESC);

    CREATE TABLE IF NOT EXISTS user_library (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      pinned BOOLEAN DEFAULT 0,
      FOREIGN KEY(album_id) REFERENCES albums(id)
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id TEXT PRIMARY KEY,
      action TEXT,
      entity_type TEXT,
      entity_id TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty-result cache: 1-hour TTL prevents re-spamming trackers
    -- when we already know a query returns nothing (avoids IP bans)
    CREATE TABLE IF NOT EXISTS torrent_query_cache (
      query_hash TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_torrent_query_cache_age ON torrent_query_cache(created_at);

    -- Torrentio-style pre-built index: iTunes ID → torrent magnets
    -- Populated by background indexer, queried instantly at request time
    CREATE TABLE IF NOT EXISTS torrent_index (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      itunes_id   TEXT    NOT NULL,
      info_hash   TEXT    NOT NULL,
      magnet      TEXT    NOT NULL,
      file_name   TEXT,
      seeders     INTEGER DEFAULT 0,
      quality     TEXT,
      source      TEXT,
      artist      TEXT,
      album       TEXT,
      indexed_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(itunes_id, info_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_torrent_index_itunes ON torrent_index(itunes_id);
    CREATE INDEX IF NOT EXISTS idx_torrent_index_age    ON torrent_index(indexed_at DESC);
  `);

  // Seed demo data if tables are empty
  const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get().count;
  if (albumCount === 0) {
    seedDemoData();
  }

  // Purge empty-result cache entries from old provider sets so new sources get queried.
  // Only purges entries that cached an empty result — real torrent hits are kept.
  const purged = db.prepare(
    `DELETE FROM torrent_query_cache WHERE results_json = '[]' AND query_hash NOT LIKE ?`
  ).run(`${PROVIDER_SET_VERSION}|%`);
  if (purged.changes > 0) {
    console.log(`🧹 Purged ${purged.changes} stale empty-result cache entries (provider set upgraded)`);
  }

  console.log('✓ Database initialized');
}

function seedDemoData() {
  console.log('🌱 Seeding demo data...');
  const insertAlbum = db.prepare(`
    INSERT OR IGNORE INTO albums (id, title, artist, year, track_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertTorrent = db.prepare(`
    INSERT OR IGNORE INTO torrents (id, magnet, artist, title, seeders, leechers, file_name, quality, source, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const albums = [
    {
      id: 'album-1', title: 'Midnight Dreams', artist: 'Synthetic Minds', year: 2023,
      tracks: [
        { id: 'track-1-1', title: 'Awakening', duration: 222 },
        { id: 'track-1-2', title: 'Binary Sunset', duration: 255 },
        { id: 'track-1-3', title: 'Quantum Loop', duration: 178 },
        { id: 'track-1-4', title: 'Infinite Echo', duration: 312 }
      ]
    },
    {
      id: 'album-2', title: 'Neural Networks', artist: 'Cyber Collective', year: 2023,
      tracks: [
        { id: 'track-2-1', title: 'Connection', duration: 240 },
        { id: 'track-2-2', title: 'Signal', duration: 210 },
        { id: 'track-2-3', title: 'Resonance', duration: 285 }
      ]
    },
    {
      id: 'album-3', title: 'Digital Horizons', artist: 'The Nodes', year: 2024,
      tracks: [
        { id: 'track-3-1', title: 'Into the Mesh', duration: 198 },
        { id: 'track-3-2', title: 'Packet Storm', duration: 267 },
        { id: 'track-3-3', title: 'Latency', duration: 145 },
        { id: 'track-3-4', title: 'Bandwidth Dreams', duration: 320 },
        { id: 'track-3-5', title: 'Disconnect', duration: 290 }
      ]
    }
  ];

  for (const album of albums) {
    insertAlbum.run(album.id, album.title, album.artist, album.year, album.tracks.length);
    for (let i = 0; i < album.tracks.length; i++) {
      const t = album.tracks[i];
      insertTrack.run(t.id, album.id, album.artist, t.title, t.duration, i + 1);

      // Create demo magnet links (these are real-ish looking but for demo purposes)
      const demoHash = uuidv4().replace(/-/g, '').substring(0, 40);
      const filename = `${album.artist} - ${t.title}.mp3`;
      const magnet = `magnet:?xt=urn:btih:${demoHash}&dn=${encodeURIComponent(filename)}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.opentrackr.org:1337`;
      insertTorrent.run(
        uuidv4(), magnet, album.artist, t.title,
        Math.floor(Math.random() * 80) + 15,  // seeders: 15-95
        Math.floor(Math.random() * 15) + 1,   // leechers: 1-15
        filename,
        detectQuality(filename),
        'SonicSwarm Demo Index',
      );
    }
  }
  console.log('✓ Demo data seeded');
}

// ─────────────────────────────────────────────────────────
// WEBTORRENT CLIENT SETUP
// ─────────────────────────────────────────────────────────

// ─── BitTorrent Engine Tracker ───
// Each torrent gets its own torrent-stream engine.
// Keyed by infoHash (extracted from magnet) for cross-request lookup.
const torrentEngines = new Map();   // infoHash → torrent-stream engine
const activeTorrents = new Map();   // streamId → { magnet, infoHash, engine, files, createdAt }
const activeSwarms = new Map();     // infoHash → stats for the UI

// Temp directory for torrent data
const tmpDir = path.join(rootDir, 'data', 'torrents');
fs.mkdirSync(tmpDir, { recursive: true });

/**
 * Create or retrieve a torrent-stream engine for a magnet link.
 * torrent-stream speaks standard BitTorrent TCP/UDP — connects to
 * the full DHT network of desktop clients, not just WebRTC peers.
 */
function getTorrentEngine(magnet) {
  const infoHash = extractInfoHash(magnet);
  if (!infoHash) return null;

  // Return existing engine if already running
  const existing = torrentEngines.get(infoHash);
  if (existing) return existing;

  console.log(`🧲 Starting BitTorrent engine for ${infoHash}...`);

  const engine = torrentStream(magnet, {
    connections: 200,
    uploads: 20,
    tmp: tmpDir,
    path: tmpDir,
    dht: true,
    tracker: true,
  });

  // Track it
  torrentEngines.set(infoHash, engine);

  // Initialize swarm stats
  activeSwarms.set(infoHash, {
    id: infoHash,
    name: 'Loading metadata...',
    size: 0,
    peers: 0,
    seeds: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: 0,
    status: 'connecting',
    addedAt: new Date()
  });

  engine.on('ready', () => {
    console.log(`✓ Engine ready: ${engine.torrent?.name || infoHash} (${engine.files?.length || 0} files)`);
    const swarm = activeSwarms.get(infoHash);
    if (swarm) {
      swarm.name = engine.torrent?.name || infoHash;
      swarm.size = engine.files?.reduce((s, f) => s + f.length, 0) || 0;
      swarm.status = 'downloading';
    }
  });

  engine.on('download', (pieceIndex) => {
    const swarm = activeSwarms.get(infoHash);
    if (swarm) {
      swarm.downloadSpeed = Number((engine.swarm?.downloaded || 0) / 1024).toFixed(2);
      swarm.uploadSpeed = Number((engine.swarm?.uploaded || 0) / 1024).toFixed(2);
      swarm.peers = Object.keys(engine.swarm?.peers || {}).length || 0;
      swarm.seeds = Object.keys(engine.swarm?.seeds || {}).length || 0;
      const total = engine.files?.reduce((s, f) => s + f.length, 0) || 1;
      swarm.progress = Math.round(((engine.swarm?.downloaded || 0) / total) * 10000) / 100;
    }
  });

  engine.on('idle', () => {
    const swarm = activeSwarms.get(infoHash);
    if (swarm) swarm.status = 'seeding';
  });

  engine.on('error', (err) => {
    console.error(`✗ Engine error [${infoHash}]: ${err.message}`);
    const swarm = activeSwarms.get(infoHash);
    if (swarm) swarm.status = 'error';
  });

  return engine;
}

// ─────────────────────────────────────────────────────────
// METADATA & RESOLUTION SERVICES
// ─────────────────────────────────────────────────────────

/**
 * MusicBrainz API wrapper
 */
async function getMusicBrainzMetadata(artist, album) {
  try {
    // Check cache first
    const cached = db.prepare(
      'SELECT * FROM albums WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)'
    ).get(artist, album);

    if (cached) {
      return {
        id: cached.id,
        title: cached.title,
        artist: cached.artist,
        year: cached.year,
        coverUrl: cached.cover_url,
        trackCount: cached.track_count,
        fromCache: true
      };
    }

    // Query MusicBrainz
    const response = await axios.get('https://musicbrainz.org/ws/2/release', {
      params: { query: `${artist} ${album}`, limit: 1, fmt: 'json' },
      headers: { 'User-Agent': 'SonicSwarm/1.0 (+https://sonicswarm.local)' },
      timeout: 5000
    });

    if (!response.data.releases || response.data.releases.length === 0) {
      return null;
    }

    const release = response.data.releases[0];
    const albumId = uuidv4();

    db.prepare(`
      INSERT OR IGNORE INTO albums (id, title, artist, year, mbid, track_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(albumId, release.title,
      release['artist-credit']?.[0]?.name || 'Unknown',
      parseInt(release.date?.substring(0, 4)) || null,
      release.id,
      release['track-count'] || 0
    );

    return {
      id: albumId,
      title: release.title,
      artist: release['artist-credit']?.[0]?.name || 'Unknown',
      year: parseInt(release.date?.substring(0, 4)) || null,
      mbid: release.id,
      trackCount: release['track-count'] || 0,
      fromCache: false
    };
  } catch (error) {
    console.error(`MusicBrainz error: ${error.message}`);
    return null;
  }
}

/**
 * Fuzzy string matching for torrent validation
 */
function calculateMatchScore(filename, artist, track, album) {
  const normalized = filename.toLowerCase();
  let score = 0;
  const weights = { artistMatch: 3, trackMatch: 2, albumMatch: 1, extension: 0.5 };

  const artistWords = artist.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2);
  for (const word of artistWords) {
    if (normalized.includes(word)) score += weights.artistMatch;
  }

  const trackWords = track.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2);
  for (const word of trackWords) {
    if (normalized.includes(word)) score += weights.trackMatch;
  }

  if (album) {
    const albumWords = album.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2);
    for (const word of albumWords) {
      if (normalized.includes(word)) score += weights.albumMatch;
    }
  }

  if (normalized.match(/\.(mp3|flac|aac|ogg|m4a|wav)$/)) {
    score += weights.extension;
  }

  if (normalized.includes('live') || normalized.includes('compilation')) {
    score *= 0.5;
  }

  return score;
}

/**
 * Empty-result cache: 1-hour TTL to prevent re-spamming trackers
 * when we already know a query returns nothing.
 */
function getFromCache(cacheKey) {
  const cached = db.prepare(
    'SELECT results_json FROM torrent_query_cache WHERE query_hash = ? AND created_at > ?'
  ).get(cacheKey, Date.now() - 3600000); // 1 hour TTL
  if (!cached) return null;
  try { return JSON.parse(cached.results_json); } catch { return null; }
}

function setCache(cacheKey, results) {
  db.prepare(
    'INSERT OR REPLACE INTO torrent_query_cache (query_hash, query_text, results_json, created_at) VALUES (?, ?, ?, ?)'
  ).run(cacheKey, cacheKey, JSON.stringify(results), Date.now());
}

/**
 * Torrent Resolver - queries database + external APIs
 * Returns magnet links for a given artist + track
 */
// In-flight deduplication: if the same query is already running, wait for it
// instead of launching a second parallel fetch. Prevents the UI's multi-click
// storm from spawning 5 identical 16s timeout races simultaneously.
const inFlightResolves = new Map(); // cacheKey → Promise

async function resolveMusicTorrent(artist, track, album = '', itunesId = null, backgroundJob = false) {
  const cacheKey = `${PROVIDER_SET_VERSION}|${artist}|${track}|${album}`.toLowerCase();
  const startTime = Date.now();
  console.log(`🔍 [${new Date().toISOString()}] Resolving: ${artist} - ${track}${album ? ` [${album}]` : ''}${itunesId ? ` (iTunes: ${itunesId})` : ''}`);

  // Dedup: if an identical query is already in-flight, piggyback on it
  if (inFlightResolves.has(cacheKey)) {
    console.log(`⏳ Dedup: waiting on in-flight resolve for "${artist} - ${track}"`);
    return inFlightResolves.get(cacheKey);
  }

  const resolvePromise = _doResolveMusicTorrent(artist, track, album, itunesId, backgroundJob, cacheKey, startTime);
  inFlightResolves.set(cacheKey, resolvePromise);
  resolvePromise.finally(() => inFlightResolves.delete(cacheKey));
  return resolvePromise;
}

async function _doResolveMusicTorrent(artist, track, album, itunesId, backgroundJob, cacheKey, startTime) {
  try {
    // 0. Fast-path: check pre-built torrent_index by iTunes ID (Torrentio-style)
    //    This is a sub-millisecond DB lookup — no network I/O at all
    if (itunesId) {
      const TWELVE_HOURS = 12 * 60 * 60; // seconds
      const indexed = db.prepare(`
        SELECT * FROM torrent_index
        WHERE itunes_id = ?
          AND indexed_at > (unixepoch() - ?)
          AND seeders > 0
        ORDER BY seeders DESC
        LIMIT 8
      `).all(itunesId, TWELVE_HOURS);

      if (indexed.length > 0) {
        console.log(`⚡ Index hit for ${itunesId}: ${indexed.length} results (${Date.now() - startTime}ms)`);
        return indexed.map(r => ({
          magnet:   r.magnet,
          seeders:  r.seeders,
          leechers: 0,
          fileName: r.file_name,
          quality:  r.quality || 'Unknown',
          source:   r.source,
          confidence: 'high'
        }));
      }
    }

    // 1. Check database cache first — only real torrents with seeders
    const cachedTorrents = db.prepare(`
      SELECT * FROM torrents 
      WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)
      AND seeders > 0 AND magnet LIKE 'magnet:%'
      ORDER BY seeders DESC
      LIMIT 5
    `).all(artist, track);

    if (cachedTorrents.length > 0) {
      console.log(`📚 Found ${cachedTorrents.length} cached torrents with seeders (${Date.now() - startTime}ms)`);
      return cachedTorrents.map(t => ({
        magnet: t.magnet,
        seeders: t.seeders,
        leechers: t.leechers,
        fileName: t.file_name,
        quality: t.quality || 'Unknown',
        source: t.source,
        confidence: 'high'
      }));
    }

    // 2. Check empty-result cache (1hr TTL) — skip trackers if we already know there's nothing
    const emptyCached = getFromCache(cacheKey);
    if (emptyCached !== null) {
      if (emptyCached.length === 0) {
        console.log(`📭 Empty-result cache hit — skipping tracker queries (${Date.now() - startTime}ms)`);
        return [];
      }
      // Non-empty cached results from previous query
      console.log(`📚 Cache hit: ${emptyCached.length} results (${Date.now() - startTime}ms)`);
      return emptyCached;
    }

    // 3. Query JSON APIs in parallel — allSettled collects all results, dedup by hash
    console.log(`⏱️  Querying tracker APIs (8s budget)...`);

    // Background jobs skip SolidTorrents to preserve its rate-limit budget for real users
    const queryPromises = [
      queryTrackerAPI(artist, track, 'prowlarr',      album, 15000), // Local aggregator — slow but thorough
      queryTrackerAPI(artist, track, 'piratebay',     album, 5000),
      queryTrackerAPI(artist, track, 'bitsearch',     album, 6000),
      queryTrackerAPI(artist, track, 'torrentgalaxy', album, 6000),
      ...(backgroundJob ? [] : [queryTrackerAPI(artist, track, 'solidtorrents', album, 5000)]),
      queryTrackerAPI(artist, track, 'knaben',        album, 7000),
      queryTrackerAPI(artist, track, 'jackett',       album, 5000),
    ];

    const GLOBAL_TIMEOUT = 16000;
    const settled = await Promise.race([
      Promise.allSettled(queryPromises),
      new Promise(resolve =>
        setTimeout(() => resolve(queryPromises.map(() => ({ status: 'timeout', value: [] }))), GLOBAL_TIMEOUT)
      )
    ]);

    // Flatten + deduplicate by info-hash
    const seen = new Set();
    const allTorrents = settled
      .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
      .flatMap(r => r.value)
      .filter(t => {
        if (!t?.magnet) return false;
        const hashMatch = t.magnet.match(/urn:btih:([a-f0-9]{32,40})/i);
        const hash = hashMatch ? hashMatch[1].toLowerCase() : t.magnet;
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      });

    const providerHits = settled.filter(r => r.status === 'fulfilled' && r.value?.length > 0).length;
    console.log(`📡 ${allTorrents.length} unique results across ${providerHits} providers (${Date.now() - startTime}ms)`);

    // 4. Cache the result — even if empty (prevents re-spamming trackers for 1hr)
    setCache(cacheKey, allTorrents);

    if (allTorrents.length === 0) {
      console.log(`⚠️  No torrents found for "${artist} - ${track}" (${Date.now() - startTime}ms)`);
      return [];
    }

    console.log(`✅ Got ${allTorrents.length} torrents (${Date.now() - startTime}ms)`);

    // 5. Score and rank results
    const scored = allTorrents.map(t => ({
      ...t,
      matchScore: calculateMatchScore(t.fileName, artist, track, album)
    }));

    const ranked = scored
      .sort((a, b) => ((b.matchScore - a.matchScore) * 100) + (b.seeders - a.seeders))
      .slice(0, 6);

    // 6. Cache good results to the torrents table
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO torrents 
      (id, magnet, artist, title, seeders, leechers, file_name, quality, source, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const torrent of ranked) {
      if (torrent.seeders > 0) {
        insertStmt.run(uuidv4(), torrent.magnet, artist, track,
          torrent.seeders, torrent.leechers, torrent.fileName,
          torrent.quality || 'Unknown', torrent.source);
      }
    }

    // 7. Write results into torrent_index if we have an iTunes ID (pre-builds the fast path)
    if (itunesId && ranked.length > 0) {
      const upsertIndex = db.prepare(`
        INSERT OR REPLACE INTO torrent_index
          (itunes_id, info_hash, magnet, file_name, seeders, quality, source, artist, album, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `);
      for (const t of ranked) {
        const hashMatch = t.magnet?.match(/urn:btih:([a-fA-F0-9]{32,40})/i);
        if (hashMatch) {
          try {
            upsertIndex.run(itunesId, hashMatch[1].toLowerCase(), t.magnet,
              t.fileName, t.seeders, t.quality || 'Unknown', t.source, artist, album || track);
          } catch(_) {}
        }
      }
      console.log(`💾 Wrote ${ranked.length} entries to torrent_index for ${itunesId}`);
    }

    console.log(`✅ Returning ${ranked.length} torrents (total time: ${Date.now() - startTime}ms)`);
    return ranked.map(t => ({
      magnet: t.magnet,
      seeders: t.seeders,
      leechers: t.leechers,
      fileName: t.fileName,
      quality: t.quality || 'Unknown',
      source: t.source,
      confidence: t.matchScore > 5 ? 'high' : 'medium'
    }));
  } catch (error) {
    console.error(`❌ Resolution error: ${error.message} (${Date.now() - startTime}ms)`);
    return [];
  }
}

/**
 * Query external tracker APIs for music torrents — Stremio-style with retry + DHT fallback
 * Key insight: Don't give up on first failure. Retry with fresh headers.
 * If all scrapers fail, use DHT lookup as fallback.
 */
async function queryTrackerAPI(artist, track, source, album = '', timeout = 5000) {
  const queryStart = Date.now();

  try {
    switch (source) {
      case 'piratebay': {
        // CRITICAL FIX: Query is TOO SPECIFIC with all three (artist, album, track)
        // Stremio queries ONCE with artist + track only
        // Also: cat=100 (all music) not cat=101 (mp3 only)
        const trackQuery = encodeURIComponent(`${artist} ${track}`);
        const albumQuery = album ? encodeURIComponent(`${artist} ${album}`) : null;

        try {
          // Try track-specific first (faster, focused)
          const trackResp = await fetchWithRetry(
            `https://apibay.org/q.php?q=${trackQuery}&cat=100`,
            { timeout: timeout - 1000 },
            2  // Retry up to 2 times
          );

          if (trackResp?.data && Array.isArray(trackResp.data)) {
            const results = trackResp.data
              .filter(item => item.id && item.info_hash && parseInt(item.seeders) > 0)
              .slice(0, 8)
              .map(item => ({
                magnet: buildMagnet(item.info_hash, item.name),
                fileName: item.name,
                seeders: parseInt(item.seeders) || 0,
                leechers: parseInt(item.leechers) || 0,
                quality: detectQuality(item.name),
                source: 'ThePirateBay'
              }));

            if (results.length > 0) {
              console.log(`  ✓ PirateBay: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          }
        } catch (e) {
          console.log(`  ✗ PirateBay track search failed: ${e.message?.substring(0, 60)}`);
        }

        // If track search failed/empty, try album pack search
        if (albumQuery) {
          try {
            const albumResp = await fetchWithRetry(
              `https://apibay.org/q.php?q=${albumQuery}&cat=100`,
              { timeout: Math.max(timeout - (Date.now() - queryStart) - 500, 1000) },
              1
            );

            if (albumResp?.data && Array.isArray(albumResp.data)) {
              const results = albumResp.data
                .filter(item => item.id && item.info_hash && parseInt(item.seeders) > 0)
                .slice(0, 4)  // Fewer album results
                .map(item => ({
                  magnet: buildMagnet(item.info_hash, item.name),
                  fileName: item.name,
                  seeders: parseInt(item.seeders) || 0,
                  leechers: parseInt(item.leechers) || 0,
                  quality: detectQuality(item.name),
                  source: 'ThePirateBay (album)'
                }));

              if (results.length > 0) {
                console.log(`  ✓ PirateBay (album): ${results.length} results (${Date.now() - queryStart}ms)`);
                return results;
              }
            }
          } catch (e) {
            console.log(`  ✗ PirateBay album search failed: ${e.message?.substring(0, 60)}`);
          }
        }

        return [];
      }

      case 'solidtorrents': {
        // SolidTorrents has a public JSON API — skip gracefully on 429 rate-limit
        const query = encodeURIComponent(`${artist} ${track}`);

        try {
          const resp = await fetchWithRetry(
            `https://solidtorrents.to/api/v1/search?q=${query}&category=Music&sort=seeders`,
            { timeout },
            1   // Only 1 attempt — retrying a 429 just makes rate-limiting worse
          );

          if (resp?.data?.results && Array.isArray(resp.data.results)) {
            const results = resp.data.results
              .filter(item => parseInt(item.swarm?.seeders) > 0)
              .slice(0, 6)
              .map(item => ({
                magnet: item.magnet || buildMagnet(item.infohash || item.hash, item.title),
                fileName: item.title,
                seeders: parseInt(item.swarm?.seeders) || 0,
                leechers: parseInt(item.swarm?.leechers) || 0,
                quality: detectQuality(item.title),
                source: 'SolidTorrents'
              }));

            if (results.length > 0) {
              console.log(`  ✓ SolidTorrents: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          }
        } catch (e) {
          console.log(`  ✗ SolidTorrents: ${e.message?.substring(0, 60)}`);
        }

        return [];
      }

      case 'prowlarr': {
        // Prowlarr — self-hosted indexer aggregator (100+ trackers via one local API call)
        // Install: https://prowlarr.com  →  default port 9696
        // Set env vars: PROWLARR_URL=http://localhost:9696  PROWLARR_API_KEY=xxxxxxxx
        // In Prowlarr UI: Settings → General → copy the API Key
        // Add indexers: Indexers → + Add Indexer → search "music" / "general"
        //   Recommended: 1337x, Knaben, TorrentGalaxy, BTdigg, Rutracker (music), GazelleGames
        //
        // Prowlarr uses the same Torznab format as Jackett — same response shape,
        // just a different URL path: /prowlarr/api/v1/search  (not /api/v2.0/indexers/all/results)
        const baseUrl = process.env.PROWLARR_URL;
        const apiKey  = process.env.PROWLARR_API_KEY;

        if (!baseUrl || !apiKey) return []; // Not configured — skip silently

        // Try track query first, then fall back to album query
        const queries = [
          `${artist} ${track}`,
          album ? `${artist} ${album}` : null
        ].filter(Boolean);

        for (const q of queries) {
          try {
            // Direct install (Windows) = /api/v1/search
            // Docker/reverse-proxy = /prowlarr/api/v1/search
            const url = `${baseUrl}/api/v1/search` +
              `?apikey=${apiKey}` +
              `&query=${encodeURIComponent(q)}` +
              `&categories[]=3000` +  // 3000 = Audio (all music)
              `&categories[]=3010` +  // 3010 = Audio/MP3
              `&categories[]=3040` +  // 3040 = Audio/Lossless
              `&type=search`;

            const resp = await fetchWithRetry(url, { timeout }, 0); // No retry — slow aggregator, one shot

            if (resp?.data && Array.isArray(resp.data)) {
              const results = resp.data
                .filter(item => (item.seeders || 0) > 0 && (item.magnetUrl || item.infoHash || item.downloadUrl))
                .slice(0, 12)  // Prowlarr returns many results — take more
                .map(item => {
                  const hash = (item.infoHash || '').toLowerCase();
                  return {
                    magnet:   item.magnetUrl || buildMagnet(hash, item.title),
                    fileName: item.title,
                    seeders:  item.seeders  || 0,
                    leechers: item.leechers || 0,
                    quality:  detectQuality(item.title),
                    source:   `Prowlarr/${item.indexer || 'multi'}`
                  };
                })
                .filter(t => t.magnet.startsWith('magnet:'));

              if (results.length > 0) {
                console.log(`  ✓ Prowlarr: ${results.length} results from ${new Set(results.map(r => r.source)).size} indexers (${Date.now() - queryStart}ms)`);
                return results;
              }
            }
          } catch (e) {
            // Log but don't crash — Prowlarr is optional
            if (!e.message?.includes('ECONNREFUSED') && !e.message?.includes('ENOTFOUND')) {
              console.log(`  ✗ Prowlarr: ${e.message?.substring(0, 60)}`);
            }
            // ECONNREFUSED = not running yet, skip silently
          }
        }

        return [];
      }

      case 'jackett': {
        // Jackett: if the user has it installed, query it (OPTIONAL integration)
        // Set via: JACKETT_URL=http://localhost:9117 JACKETT_API_KEY=xxxxx
        const baseUrl = process.env.JACKETT_URL;
        const apiKey = process.env.JACKETT_API_KEY;

        if (!baseUrl || !apiKey) return []; // Not configured

        try {
          const query = encodeURIComponent(`${artist} ${track}`);
          const url = `${baseUrl}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Categories%5B%5D=3000`;

          const resp = await fetchWithRetry(url, { timeout }, 1);

          if (resp?.data?.Results && Array.isArray(resp.data.Results)) {
            const results = resp.data.Results
              .filter(item => item.Seeders > 0 && (item.MagnetUri || item.InfoHash))
              .slice(0, 8)
              .map(item => ({
                magnet: item.MagnetUri || buildMagnet(item.InfoHash, item.Title),
                fileName: item.Title,
                seeders: item.Seeders || 0,
                leechers: Math.max(0, (item.Peers || item.Leechers || 0) - (item.Seeders || 0)),
                quality: detectQuality(item.Title),
                source: `Jackett/${item.Tracker || 'multi'}`
              }));

            if (results.length > 0) {
              console.log(`  ✓ Jackett: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          }
        } catch (e) {
          // Silently fail for optional Jackett integration
        }

        return [];
      }

      case 'knaben': {
        // Knaben.eu — public REST aggregator, indexes 50+ torrent sites, no API key needed
        // Music = category 400. Returns JSON with infohash + seeder data directly.
        const queries = [
          `${artist} ${track}`,
          album ? `${artist} ${album}` : null
        ].filter(Boolean);

        for (const q of queries) {
          try {
            const resp = await axios.post(
              'https://knaben.eu/api/v1',
              {
                search_term: q,
                categories:  [400],       // 400 = Audio/Music
                order_by:    'seeders',
                amount:      20,
                from:        0,
                hide_unsafe: false
              },
              {
                timeout,
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent':   getRandomUserAgent()
                }
              }
            );

            const hits = resp.data?.hits || resp.data?.data || resp.data || [];
            if (!Array.isArray(hits) || hits.length === 0) continue;

            const results = hits
              .filter(h => (h.seeders || h.Seeders || 0) > 0 && (h.info_hash || h.infohash || h.hash || h.InfoHash))
              .slice(0, 8)
              .map(h => {
                const hash = h.info_hash || h.infohash || h.hash || h.InfoHash || '';
                const name = h.title || h.Title || h.name || `${artist} ${track}`;
                return {
                  magnet:   h.magnet || buildMagnet(hash, name),
                  fileName: name,
                  seeders:  parseInt(h.seeders || h.Seeders) || 0,
                  leechers: parseInt(h.leechers || h.Leechers) || 0,
                  quality:  detectQuality(name),
                  source:   'Knaben'
                };
              });

            if (results.length > 0) {
              console.log(`  ✓ Knaben: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          } catch (e) {
            console.log(`  ✗ Knaben: ${e.message?.substring(0, 60)}`);
          }
        }
        return [];
      }

      case 'bitsearch': {
        // Bitsearch.to — public JSON search API, no key needed, good music coverage
        // Returns hits with magnet links directly. Category 'audio' covers all music.
        const queries = [
          `${artist} ${track}`,
          album ? `${artist} ${album}` : null
        ].filter(Boolean);

        for (const q of queries) {
          try {
            const resp = await fetchWithRetry(
              `https://bitsearch.to/api/1/search?q=${encodeURIComponent(q)}&category=1&page=1`,
              {
                timeout,
                headers: {
                  'Accept': 'application/json',
                  'Referer': 'https://bitsearch.to/'
                }
              },
              1
            );

            const hits = resp?.data?.data;
            if (!Array.isArray(hits) || hits.length === 0) continue;

            const results = hits
              .filter(h => (h.stats?.seeders || 0) > 0 && (h.info_hash || h.magnet))
              .slice(0, 8)
              .map(h => {
                const hash = (h.info_hash || '').toLowerCase();
                const name = h.name || `${artist} ${track}`;
                return {
                  magnet:   h.magnet || buildMagnet(hash, name),
                  fileName: name,
                  seeders:  parseInt(h.stats?.seeders) || 0,
                  leechers: parseInt(h.stats?.leechers) || 0,
                  quality:  detectQuality(name),
                  source:   'Bitsearch'
                };
              });

            if (results.length > 0) {
              console.log(`  ✓ Bitsearch: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          } catch (e) {
            console.log(`  ✗ Bitsearch: ${e.message?.substring(0, 60)}`);
          }
        }
        return [];
      }

      case 'torrentgalaxy': {
        // TorrentGalaxy — public tracker with a JSON search endpoint.
        // Category 43 = Music. Returns results with magnet and seeder count.
        const queries = [
          `${artist} ${track}`,
          album ? `${artist} ${album}` : null
        ].filter(Boolean);

        for (const q of queries) {
          try {
            const resp = await fetchWithRetry(
              `https://torrentgalaxy.to/torrents.php?search=${encodeURIComponent(q)}&cat=43&lang=0&nox=2&sort=seeders&order=desc`,
              {
                timeout,
                headers: {
                  'Accept': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest',
                  'Referer': 'https://torrentgalaxy.to/'
                }
              },
              1
            );

            // TGX returns JSON array when called with the right headers
            const hits = Array.isArray(resp?.data)
              ? resp.data
              : (resp?.data?.torrents || []);

            if (!hits.length) continue;

            const results = hits
              .filter(h => (h.seeders || h.s || 0) > 0)
              .slice(0, 8)
              .map(h => {
                const hash  = (h.hash || h.info_hash || '').toLowerCase();
                const name  = h.name || h.title || `${artist} ${track}`;
                const seeds = parseInt(h.seeders || h.s) || 0;
                const leeches = parseInt(h.leechers || h.l) || 0;
                return {
                  magnet:   h.magnet || buildMagnet(hash, name),
                  fileName: name,
                  seeders:  seeds,
                  leechers: leeches,
                  quality:  detectQuality(name),
                  source:   'TorrentGalaxy'
                };
              })
              .filter(t => t.magnet.startsWith('magnet:'));

            if (results.length > 0) {
              console.log(`  ✓ TorrentGalaxy: ${results.length} results (${Date.now() - queryStart}ms)`);
              return results;
            }
          } catch (e) {
            console.log(`  ✗ TorrentGalaxy: ${e.message?.substring(0, 60)}`);
          }
        }
        return [];
      }

      default:
        return [];
    }
  } catch (error) {
    console.log(`  ✗ ${source}: ${error.message?.substring(0, 60)}`);
    return [];
  }
}

/**
 * Detect audio quality from filename
 */
function detectQuality(filename) {
  if (!filename) return 'Unknown';
  const name = filename.toLowerCase();
  if (name.includes('flac') || name.includes('lossless')) return 'FLAC';
  if (name.includes('320') || name.includes('320kbps')) return 'MP3-320';
  if (name.includes('v0') || name.includes('vbr')) return 'MP3-V0';
  if (name.includes('256')) return 'MP3-256';
  if (name.includes('aac') || name.includes('m4a')) return 'AAC';
  if (name.includes('mp3')) return 'MP3';
  return 'Unknown';
}

/**
 * Stremio-Style Approach: Realistic Headers & Retry Logic
 * Bypasses "bot detection" by mimicking real browsers
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Torrentio Strategy: Retry with exponential backoff
 * Don't give up on first timeout/403 — retry with fresh headers
 */
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: options.timeout || 5000,
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          ...options.headers
        },
        ...options
      });

      return response;
    } catch (error) {
      lastError = error;

      // 403 = anti-bot, worth retrying
      // 429 = rate limit, worth retrying with delay
      // timeout = worth retrying
      const isRetryable = error.response?.status === 403 ||
        error.response?.status === 429 ||
        error.code === 'ECONNABORTED' ||
        error.message.includes('timeout');

      if (!isRetryable || attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 500ms, 1000ms
      const delay = Math.pow(2, attempt) * 500;
      console.log(`  ⟳ Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Build magnet link with trackers
 */
const ANNOUNCE_LIST = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
];

function buildMagnet(infoHash, displayName) {
  const trackers = ANNOUNCE_LIST.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(displayName)}${trackers}`;
}

// ─────────────────────────────────────────────────────────
// EXPRESS MIDDLEWARE & ROUTES
// ─────────────────────────────────────────────────────────

/**
 * Format milliseconds to m:ss string (for iTunes track durations)
 */
function formatMillis(millis) {
  if (!millis) return '0:00';
  const minutes = Math.floor(millis / 60000);
  const seconds = Math.floor((millis % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/api/swarm-stats')) { // Don't spam stats endpoint
      console.log(`[${res.statusCode}] ${req.method} ${req.path} (${duration}ms)`);
    }
  });
  next();
});

// ───────────────────────── API ROUTES ─────────────────────

/**
 * POST /api/sources
 * Stremio/Torrentio-style scraper: given artist + album + track,
 * returns metadata, tracklist, and prioritized source options
 * (both album packs and single tracks)
 */
app.post('/api/sources', async (req, res) => {
  const { artist, album, track, itunesId } = req.body;

  if (!artist || !album || !track) {
    return res.status(400).json({ success: false, error: 'Missing artist, album, or track parameter' });
  }

  // Queue this album for background re-indexing (keeps the index fresh)
  if (itunesId) queueForIndexing(itunesId, artist, album);

  try {
    // 1. Fetch/refresh album metadata from MusicBrainz
    const metadata = await getMusicBrainzMetadata(artist, album);
    const albumId = metadata?.id || uuidv4();

    // 2. Fetch full tracklist from MusicBrainz if we have an MBID
    let tracks = [];
    if (metadata?.mbid) {
      try {
        const mbResponse = await axios.get(
          `https://musicbrainz.org/ws/2/release/${metadata.mbid}`,
          {
            params: { inc: 'recordings', fmt: 'json' },
            headers: { 'User-Agent': 'SonicSwarm/1.0' },
            timeout: 5000
          }
        );
        const media = mbResponse.data?.media || [];
        tracks = media.flatMap(m =>
          (m.tracks || []).map((t, i) => ({
            id: uuidv4(),
            album_id: albumId,
            artist: artist,
            title: t.title,
            duration: t.length ? Math.round(t.length / 1000) : null,
            track_number: parseInt(t.position) || i + 1
          }))
        );
        // Cache tracks in DB
        const insertTrack = db.prepare(
          'INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const t of tracks) {
          insertTrack.run(t.id, t.album_id, t.artist, t.title, t.duration, t.track_number);
        }
      } catch (e) {
        console.log('  ⚠ Could not fetch full tracklist, using placeholder');
        tracks = Array.from({ length: metadata?.trackCount || 5 }, (_, i) => ({
          id: uuidv4(), album_id: albumId, artist,
          title: `Track ${i + 1}`, duration: 200, track_number: i + 1
        }));
      }
    } else {
      tracks = Array.from({ length: metadata?.trackCount || 5 }, (_, i) => ({
        id: uuidv4(), album_id: albumId, artist,
        title: `Track ${i + 1}`, duration: 200, track_number: i + 1
      }));
    }

    // 3. Multi-strategy torrent resolution
    // Strategy A: Search for the exact single track
    const singleTrackPromise = resolveMusicTorrent(artist, track, album, itunesId);

    // Strategy B: Search for the full album pack (itunesId lets both paths write to index)
    const albumPackPromise = resolveMusicTorrent(artist, album, '', itunesId);

    const [singleResults, albumResults] = await Promise.allSettled([
      singleTrackPromise, albumPackPromise
    ]);

    // 4. Build the source list (Torrentio-style)
    //    Deduplicate by info-hash across both strategies — same torrent should only
    //    appear once, labelled as Album Pack if found in both searches.
    const seenHashes = new Set();
    const sources = [];

    const addSource = (t, type) => {
      const hashMatch = t.magnet?.match(/urn:btih:([a-fA-F0-9]{32,40})/i);
      const hash = hashMatch ? hashMatch[1].toLowerCase() : t.magnet;
      if (!hash || seenHashes.has(hash)) return;
      seenHashes.add(hash);
      sources.push({
        id:              `src-${uuidv4().substring(0, 8)}`,
        magnet:          t.magnet,
        fileName:        t.fileName,
        seeders:         t.seeders,
        leechers:        t.leechers,
        quality:         t.quality || 'Unknown',
        source:          t.source || 'Public Tracker',
        type,
        matchConfidence: t.confidence || 'medium'
      });
    };

    // Album packs first — preferred, gets hash priority for dedup
    if (albumResults.status === 'fulfilled') {
      for (const t of (albumResults.value || [])) addSource(t, 'album_pack');
    }
    // Single-track results — only added if hash not already seen
    if (singleResults.status === 'fulfilled') {
      for (const t of (singleResults.value || [])) addSource(t, 'single_track');
    }

    // Sort: seeders desc, album packs get a small boost
    sources.sort((a, b) => {
      const boost = (x) => x.seeders + (x.type === 'album_pack' ? 5 : 0);
      return boost(b) - boost(a);
    });

    console.log(`📡 Sources for "${artist} - ${track}": ${sources.length} unique (${sources.filter(s => s.type === 'album_pack').length} album packs, ${sources.filter(s => s.type === 'single_track').length} single tracks)`);

    res.json({
      success: true,
      query: { artist, album, track },
      metadata: {
        id: albumId,
        title: metadata?.title || album,
        artist: metadata?.artist || artist,
        year: metadata?.year || null,
        coverUrl: metadata?.coverUrl || null,
        trackCount: tracks.length
      },
      tracks,
      sources,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sources error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resolve
 * Resolve artist + track → torrent magnet links
 */
app.post('/api/resolve', async (req, res) => {
  const { artist, track, album, itunesId } = req.body;

  if (!artist || !track) {
    return res.status(400).json({ success: false, error: 'Missing artist or track parameter' });
  }

  if (itunesId) queueForIndexing(itunesId, artist, album || track);

  try {
    const metadata = await getMusicBrainzMetadata(artist, album || '');
    const torrents = await resolveMusicTorrent(artist, track, album || '', itunesId);

    res.json({
      success: true,
      query: { artist, track, album },
      metadata,
      torrents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Resolve error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/search
 * Full-text search for albums — iTunes primary, MusicBrainz fallback
 * The iTunes Search API is free, requires no key, and covers virtually
 * every commercially released album with high-res artwork out of the box.
 */
app.get('/api/search', async (req, res) => {
  const { q, type = 'album' } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ success: false, error: 'Query too short (min 2 characters)' });
  }

  try {
    let results = [];

    // ── 1. PRIMARY: iTunes Search API (global catalog, high-res art) ──
    try {
      console.log(`[CATALOG] Searching iTunes for: ${q}`);
      const itunesResp = await axios.get(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=24`,
        { timeout: 6000 }
      );

      if (itunesResp.data?.results?.length > 0) {
        const seen = new Set();
        results = itunesResp.data.results
          .filter(r => r.collectionId && r.collectionName && r.artistName)
          .map(r => {
            const key = `${r.artistName}|${r.collectionName}`.toLowerCase();
            if (seen.has(key)) return null;
            seen.add(key);
            return {
              id: String(r.collectionId),
              title: r.collectionName,
              artist: r.artistName,
              coverUrl: r.artworkUrl100
                ? r.artworkUrl100.replace('100x100bb', '600x600bb')
                : null,
              year: r.releaseDate ? r.releaseDate.substring(0, 4) : null,
              track_count: r.trackCount || 0,
              source: 'itunes'
            };
          })
          .filter(Boolean);

        // Cache iTunes results for fast repeat lookups
        const upsert = db.prepare(
          `INSERT OR IGNORE INTO albums (id, title, artist, year, cover_url, track_count)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const a of results) {
          upsert.run(a.id, a.title, a.artist, a.year, a.coverUrl, a.track_count);
        }

        console.log(`[CATALOG] iTunes returned ${results.length} albums`);
      }
    } catch (itunesErr) {
      console.error('[CATALOG] iTunes search failed:', itunesErr.message);
    }

    // ── 2. FALLBACK: MusicBrainz (community-driven, good for non-mainstream) ──
    if (results.length < 5) {
      try {
        console.log(`[CATALOG] Falling back to MusicBrainz for: ${q}`);
        const mbResp = await axios.get('https://musicbrainz.org/ws/2/release', {
          params: { query: `artist:${encodeURIComponent(q)} OR release:${encodeURIComponent(q)}`, limit: 15, fmt: 'json' },
          headers: { 'User-Agent': 'SonicSwarm/1.0 (+https://sonicswarm.local)' },
          timeout: 6000
        });

        if (mbResp.data?.releases) {
          const seen = new Set(results.map(r => `${r.artist}|${r.title}`.toLowerCase()));
          const mbResults = mbResp.data.releases
            .filter(r => {
              const key = `${r['artist-credit']?.[0]?.name || ''}|${r.title || ''}`.toLowerCase();
              return !seen.has(key);
            })
            .slice(0, 10)
            .map(r => ({
              id: r.id || uuidv4(),
              title: r.title || 'Unknown',
              artist: r['artist-credit']?.[0]?.name || 'Unknown',
              year: r.date ? parseInt(r.date.substring(0, 4)) : null,
              mbid: r.id,
              coverUrl: null,
              track_count: r['track-count'] || 0,
              source: 'musicbrainz'
            }));

          // Fetch cover art in parallel
          const withCovers = await Promise.all(mbResults.map(async (album) => {
            if (!album.mbid) return album;
            try {
              const coverResp = await axios.get(
                `https://coverartarchive.org/release/${album.mbid}`,
                { timeout: 2000 }
              );
              const images = coverResp.data?.images || [];
              const front = images.find(img => img.front) || images[0];
              album.coverUrl = front?.thumbnails?.small || front?.image || null;
            } catch { /* no cover */ }
            return album;
          }));

          results = [...results, ...withCovers];
          console.log(`[CATALOG] MusicBrainz added ${withCovers.length} albums`);
        }
      } catch (mbErr) {
        console.error('[CATALOG] MusicBrainz search failed:', mbErr.message);
      }
    }

    // ── 3. LAST RESORT: Local cache ──
    if (results.length < 3) {
      const localResults = db.prepare(`
        SELECT * FROM albums
        WHERE LOWER(title) LIKE LOWER(?) OR LOWER(artist) LIKE LOWER(?)
        LIMIT 20
      `).all(`%${q}%`, `%${q}%`);

      const seen = new Set(results.map(r => r.id));
      for (const a of localResults) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          results.push({
            id: a.id,
            title: a.title,
            artist: a.artist,
            year: a.year,
            coverUrl: a.cover_url,
            track_count: a.track_count,
            mbid: a.mbid,
            source: 'cache'
          });
        }
      }
    }

    console.log(`🔍 Search "${q}": ${results.length} total results`);
    res.json({ success: true, query: q, type, results: results.slice(0, 20) });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/library
 * Returns albums saved to the user's library
 * Falls back to demo data if library is empty
 */
app.get('/api/library', (req, res) => {
  try {
    // Fetch user library with full album details via JOIN
    const library = db.prepare(`
      SELECT a.*, ul.added_at, ul.pinned
      FROM user_library ul
      JOIN albums a ON a.id = ul.album_id
      ORDER BY ul.added_at DESC
    `).all();

    if (library.length > 0) {
      const fullAlbums = library.map(album => {
        const tracks = db.prepare(
          'SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number'
        ).all(album.id);
        return { ...album, tracks };
      });
      return res.json({ success: true, albums: fullAlbums });
    }

    // Library is empty — seed with demo albums automatically
    const demoAlbums = [
      {
        id: 'album-1', title: 'Midnight Dreams', artist: 'Synthetic Minds', year: 2023,
        tracks: [
          { id: 't1', title: 'Awakening', duration: '3:42' },
          { id: 't2', title: 'Binary Sunset', duration: '4:15' },
          { id: 't3', title: 'Quantum Loop', duration: '2:58' },
          { id: 't4', title: 'Infinite Echo', duration: '5:12' }
        ]
      },
      {
        id: 'album-2', title: 'Neural Networks', artist: 'Cyber Collective', year: 2023,
        tracks: [
          { id: 't5', title: 'Connection', duration: '4:00' },
          { id: 't6', title: 'Signal', duration: '3:30' },
          { id: 't7', title: 'Resonance', duration: '4:45' }
        ]
      }
    ];

    const insertAlbum = db.prepare(
      'INSERT OR IGNORE INTO albums (id, title, artist, year, track_count) VALUES (?, ?, ?, ?, ?)'
    );
    const insertTrack = db.prepare(
      'INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertLibrary = db.prepare(
      'INSERT OR IGNORE INTO user_library (id, album_id) VALUES (?, ?)'
    );

    for (const album of demoAlbums) {
      insertAlbum.run(album.id, album.title, album.artist, album.year, album.tracks.length);
      insertLibrary.run(uuidv4(), album.id);
      for (let i = 0; i < album.tracks.length; i++) {
        const t = album.tracks[i];
        insertTrack.run(t.id, album.id, album.artist, t.title, t.duration, i + 1);
      }
    }

    // Return the freshly-seeded demo albums
    const seeded = db.prepare(`
      SELECT a.* FROM user_library ul
      JOIN albums a ON a.id = ul.album_id
      ORDER BY ul.added_at DESC
    `).all();

    const fullSeeded = seeded.map(album => {
      const tracks = db.prepare(
        'SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number'
      ).all(album.id);
      return { ...album, tracks };
    });

    res.json({ success: true, albums: fullSeeded, seeded: true });
  } catch (error) {
    console.error('Library error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/library
 * Add an album to the user's library
 * Body: { id, title, artist, year, cover, trackCount }
 */
app.post('/api/library', (req, res) => {
  const { id, title, artist, year, cover, trackCount } = req.body;

  if (!id || !title || !artist) {
    return res.status(400).json({ success: false, error: 'Missing required fields: id, title, artist' });
  }

  try {
    // Check for duplicate first — album_id has no DB-level unique constraint
    // so we guard here to avoid multiple identical entries
    const existing = db.prepare(
      'SELECT id FROM user_library WHERE album_id = ?'
    ).get(id);

    if (existing) {
      return res.json({ success: true, albumId: id, alreadyInLibrary: true, message: `"${title}" is already in your library` });
    }

    // Upsert album metadata (cover may have improved since first add)
    db.prepare(
      `INSERT INTO albums (id, title, artist, year, cover_url, track_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cover_url   = COALESCE(excluded.cover_url, cover_url),
         track_count = COALESCE(excluded.track_count, track_count)`
    ).run(id, title, artist, year || null, cover || null, trackCount || 0);

    // Add to user library
    db.prepare(
      'INSERT INTO user_library (id, album_id) VALUES (?, ?)'
    ).run(uuidv4(), id);

    console.log(`📚 Added to library: ${artist} - ${title}`);
    res.json({ success: true, albumId: id, alreadyInLibrary: false, message: `Added "${title}" to library` });
  } catch (error) {
    console.error('Library add error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/library/:albumId
 * Remove an album from the user's library
 */
app.delete('/api/library/:albumId', (req, res) => {
  const { albumId } = req.params;

  if (!albumId) {
    return res.status(400).json({ success: false, error: 'Missing albumId' });
  }

  try {
    db.prepare('DELETE FROM user_library WHERE album_id = ?').run(albumId);
    console.log(`📚 Removed from library: ${albumId}`);
    res.json({ success: true, albumId, message: 'Removed from library' });
  } catch (error) {
    console.error('Library remove error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Extract infoHash from a magnet URI
 */
function extractInfoHash(magnet) {
  if (!magnet || !magnet.includes('btih:')) return null;
  return magnet.split('btih:')[1].split('&')[0].toLowerCase();
}

/**
 * POST /api/stream
 */
app.post('/api/stream', async (req, res) => {
  const { magnet, targetTrackTitle, trackNumber } = req.body;

  if (!magnet) {
    return res.status(400).json({ success: false, error: 'Missing magnet URI' });
  }

  try {
    const infoHash = extractInfoHash(magnet);
    if (!infoHash) {
      return res.status(400).json({ success: false, error: 'Invalid magnet URI — could not extract infoHash' });
    }

    // Get or create the BitTorrent engine
    let engine = torrentEngines.get(infoHash);
    if (!engine) {
      engine = getTorrentEngine(magnet);
    }

    // Wait for metadata (file list) to arrive from the swarm
    if (!engine.torrent || !engine.files || engine.files.length === 0) {
      console.log(`⏳ Waiting for torrent metadata from DHT/trackers... (infoHash: ${infoHash})`);
      const ready = await new Promise((resolve) => {
        const start = Date.now();
        const maxWait = 120000; // 2 minutes for metadata
        const check = () => {
          if (engine.torrent && engine.files && engine.files.length > 0) {
            console.log(`  ✓ Metadata arrived: "${engine.torrent.name}" (${engine.files.length} files)`);
            resolve(true);
            return;
          }
          if (Date.now() - start > maxWait) {
            resolve(false);
            return;
          }
          setTimeout(check, 1000);
        };
        check();
        // Also listen for the ready event
        engine.once('ready', () => {
          console.log(`  ✓ Engine ready event fired`);
          resolve(true);
        });
      });

      if (!ready) {
        return res.status(503).json({
          success: false,
          error: `Metadata not available after 120s. The torrent may have no seeders on the DHT network.`,
          hint: 'Try a magnet with more seeders, or check that the torrent is still alive.'
        });
      }
    }

    const streamId = uuidv4();
    const fileList = (engine.files || []).map((f, idx) => ({
      index: idx, name: f.name, length: f.length
    }));

    const validExts = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus'];
    let audioIndex = 0;

    if (engine.files && engine.files.length > 0) {
      // Step 1: Intelligent multi-layer track matching for album packs
      if (targetTrackTitle) {
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanTarget = normalize(targetTrackTitle);
        // Strip "feat. X" and parenthetical notes for a cleaner base name to match against
        const cleanTargetBase = normalize(targetTrackTitle.split('(')[0].split('feat')[0]);

        let bestMatchIndex = -1;
        let highestScore = 0;

        engine.files.forEach((file, index) => {
          const isAudio = validExts.some(ext => file.name.toLowerCase().endsWith(ext));
          if (!isAudio) return;

          const fileNameClean = normalize(file.name);
          let currentScore = 0;

          // Layer 1a: Base title match (without features/parens) — most reliable string signal
          if (fileNameClean.includes(cleanTargetBase)) currentScore += 50;
          // Layer 1b: Full title match (bonus for exact match including feat. suffix)
          if (fileNameClean.includes(cleanTarget)) currentScore += 20;

          // Layer 2: Track number prefix match — highly reliable for properly-tagged album packs
          if (trackNumber) {
            const paddedNum = String(trackNumber).padStart(2, '0'); // "03"
            const simpleNum = String(trackNumber);                   // "3"
            if (
              file.name.toLowerCase().startsWith(paddedNum) ||
              file.name.toLowerCase().startsWith(simpleNum + ' ') ||
              file.name.toLowerCase().startsWith(simpleNum + '-') ||
              file.name.toLowerCase().startsWith(simpleNum + '.')
            ) {
              currentScore += 40;
            }
          }

          if (currentScore > highestScore) {
            highestScore = currentScore;
            bestMatchIndex = index;
          }
        });

        if (bestMatchIndex !== -1 && highestScore >= 40) {
          audioIndex = bestMatchIndex;
          console.log(`  🎯 Intelligent Track Match: "${targetTrackTitle}" → "${engine.files[audioIndex].name}" (Score: ${highestScore})`);
        } else if (trackNumber) {
          // Fallback: sort audio files alphabetically/numerically and select by position
          const audioFilesOnly = engine.files
            .map((f, i) => ({ name: f.name, originalIndex: i }))
            .filter(f => validExts.some(ext => f.name.toLowerCase().endsWith(ext)))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

          if (audioFilesOnly[trackNumber - 1]) {
            audioIndex = audioFilesOnly[trackNumber - 1].originalIndex;
            console.log(`  🔀 Position Fallback: Track #${trackNumber} → "${engine.files[audioIndex].name}"`);
          }
        }
      }

      // Step 2: Fallback to first audio file (skip non-audio like .jpg/.nfo)
      if (audioIndex === 0 && !validExts.some(ext => (engine.files[0]?.name || '').toLowerCase().endsWith(ext))) {
        const found = engine.files.findIndex(f =>
          validExts.some(ext => f.name.toLowerCase().endsWith(ext))
        );
        if (found !== -1) audioIndex = found;
      }
    }

    activeTorrents.set(streamId, { magnet, engine, infoHash, createdAt: new Date(), files: fileList });

    console.log(`🎵 Stream ${streamId}: ${engine.torrent?.name || 'Unknown'} (${fileList.length} files, audioIndex=${audioIndex})`);

    res.json({
      success: true, streamId,
      torrent: engine.torrent?.name || 'Unknown',
      fileName: (engine.files && engine.files[audioIndex]) ? engine.files[audioIndex].name : 'Unknown',
      files: fileList.map(f => f.name),
      totalSize: engine.files?.reduce((s, f) => s + f.length, 0) || 0,
      peerCount: Object.keys(engine.swarm?.peers || {}).length || 0,
      ready: fileList.length > 0,
      status: fileList.length > 0 ? 'streaming' : 'connecting',
      audioIndex
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/swarm-stats
 * Live P2P network statistics (polled by frontend)
 */
app.get('/api/swarm-stats', (req, res) => {
  const stats = Array.from(activeSwarms.values());
  // Update live stats from engines
  for (const [infoHash, swarm] of activeSwarms) {
    const engine = torrentEngines.get(infoHash);
    if (engine) {
      swarm.peers = Object.keys(engine.swarm?.peers || {}).length || 0;
      swarm.seeds = Object.keys(engine.swarm?.seeds || {}).length || 0;
      swarm.downloadSpeed = Number((engine.swarm?.downloaded || 0) / 1024).toFixed(2);
      swarm.uploadSpeed = Number((engine.swarm?.uploaded || 0) / 1024).toFixed(2);
      const total = engine.files?.reduce((s, f) => s + f.length, 0) || 1;
      swarm.progress = Math.round(((engine.swarm?.downloaded || 0) / total) * 10000) / 100;
    }
  }

  res.json({
    success: true,
    activeTorrents: stats.length,
    totalPeers: stats.reduce((sum, s) => sum + s.peers, 0),
    totalSeeds: stats.reduce((sum, s) => sum + s.seeds, 0),
    totalDownloadSpeed: stats.reduce((sum, s) => sum + parseFloat(s.downloadSpeed || 0), 0).toFixed(2),
    swarms: stats.map(s => ({
      id: s.id,
      name: s.name,
      peers: s.peers,
      seeds: s.seeds,
      downloadSpeed: `${s.downloadSpeed} KB/s`,
      uploadSpeed: `${s.uploadSpeed} KB/s`,
      progress: `${s.progress}%`,
      status: s.status,
      addedAt: s.addedAt
    }))
  });
});

/**
 * POST /api/prebuffer
 * Pre-cache upcoming tracks for instant skipping
 */
app.post('/api/prebuffer', async (req, res) => {
  const { magnets } = req.body;

  if (!Array.isArray(magnets) || magnets.length === 0) {
    return res.status(400).json({ success: false, error: 'magnets must be a non-empty array' });
  }

  try {
    const results = [];

    for (const magnet of magnets) {
      if (!magnet) continue;

      let existingEngine = torrentEngines.get(extractInfoHash(magnet));
      if (!existingEngine) {
        getTorrentEngine(magnet); // Start the engine (pre-buffer)

        results.push({
          magnet: magnet.substring(0, 80) + '...',
          status: 'buffering'
        });

        console.log(`⏳ Prebuffering: ${magnet.substring(0, 50)}...`);
      } else {
        results.push({
          magnet: magnet.substring(0, 80) + '...',
          status: 'already-cached'
        });
      }
    }

    res.json({ success: true, prebuffered: results });
  } catch (error) {
    console.error('Prebuffer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/torrent/:streamId/file/:fileIndex
 * Stream audio file bytes with range support (for HTML audio element)
 * Handles metadata-not-ready by waiting for the torrent 'ready' event
 */
app.get('/api/torrent/:streamId/file/:fileIndex', async (req, res) => {
  const { streamId, fileIndex } = req.params;
  const idx = parseInt(fileIndex);
  const stream = activeTorrents.get(streamId);

  if (!stream) {
    return res.status(404).json({ success: false, error: 'Stream not found. Re-request /api/stream first.' });
  }

  // Get the torrent-stream engine (always fresh — not a stale WebTorrent ref)
  const engine = stream.engine || torrentEngines.get(stream.infoHash);
  if (!engine) {
    return res.status(503).json({ success: false, error: 'BitTorrent engine not found. Try streaming again.' });
  }

  // If files not ready, poll
  if (!engine.files || engine.files.length === 0 || !engine.files[idx]) {
    console.log(`⏳ File ${idx} pending, waiting for metadata...`);

    const ready = await new Promise((resolve) => {
      const startTime = Date.now();
      const maxWait = 120000;

      const check = () => {
        if (engine.files && engine.files[idx]) {
          resolve(true);
          return;
        }
        if (Date.now() - startTime > maxWait) {
          resolve(false);
          return;
        }
        setTimeout(check, 2000);
      };
      check();
    });

    if (!ready) {
      return res.status(503).json({
        success: false,
        error: `File metadata still not available after 120s. Try a magnet with more seeders.`
      });
    }
  }

  // Update stream entry
  activeTorrents.set(streamId, { ...stream, engine });

  const file = engine.files[idx];
  const range = req.headers.range;
  const fileSize = file.length;

  // Prioritize this file for sequential download
  if (typeof file.select === 'function') {
    file.select();
  }

  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeType = ext === 'flac' ? 'audio/flac' :
      ext === 'm4a' ? 'audio/mp4' :
        ext === 'ogg' ? 'audio/ogg' :
          ext === 'wav' ? 'audio/wav' :
            ext === 'aac' ? 'audio/aac' :
              ext === 'opus' ? 'audio/opus' : 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mimeType,
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range'
      });

      const readStream = file.createReadStream({ start, end });
      readStream.pipe(res);

      req.on('close', () => {
        readStream.destroy();
      });

    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range'
      });

      const readStream = file.createReadStream();
      readStream.pipe(res);

      req.on('close', () => {
        readStream.destroy();
      });
    }
  } catch (error) {
    console.error('File stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

/**
 * GET /api/discover
 * iTunes-powered discovery homepage — fetches real-time popular charts
 * from the iTunes RSS feeds. Returns two sections: Popular Albums + Popular Singles.
 * 
 * No API key required. iTunes RSS feeds are free and public.
 */
app.get('/api/discover', async (req, res) => {
  try {
    // Fetch both feeds in parallel
    const [albumsResp, songsResp] = await Promise.allSettled([
      axios.get('https://itunes.apple.com/us/rss/topalbums/limit=25/json', { timeout: 8000 }),
      axios.get('https://itunes.apple.com/us/rss/topsongs/limit=25/json', { timeout: 8000 })
    ]);

    // ── Normalize Albums ──
    const albums = [];
    if (albumsResp.status === 'fulfilled' && albumsResp.value?.data?.feed?.entry) {
      const seen = new Set();
      for (const entry of albumsResp.value.data.feed.entry) {
        const collectionId = entry.id?.attributes?.['im:id'];
        const artist = entry['im:artist']?.label || 'Unknown';
        const title = entry['im:name']?.label || 'Unknown';
        const key = `${artist}|${title}`.toLowerCase();
        if (!collectionId || seen.has(key)) continue;
        seen.add(key);

        // Get highest-res artwork (last image in the array is largest)
        const images = entry['im:image'] || [];
        const bestImage = images[images.length - 1]?.label || '';
        const cover = bestImage.replace(/\/\d+x\d+bb/, '/600x600bb');

        albums.push({
          id: `itunes_${collectionId}`,
          title,
          artist,
          cover,
          type: 'album',
          year: entry['im:releaseDate']?.label
            ? new Date(entry['im:releaseDate'].label).getFullYear()
            : null,
          trackCount: entry['im:itemCount']?.label
            ? parseInt(entry['im:itemCount'].label)
            : null
        });

        // Cache in DB for fast repeat lookups
        db.prepare(
          `INSERT OR IGNORE INTO albums (id, title, artist, year, cover_url, track_count)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(`itunes_${collectionId}`, title, artist,
          entry['im:releaseDate']?.label ? new Date(entry['im:releaseDate'].label).getFullYear() : null,
          cover,
          entry['im:itemCount']?.label ? parseInt(entry['im:itemCount'].label) : null
        );
      }
    }

    // ── Normalize Singles ──
    const singles = [];
    if (songsResp.status === 'fulfilled' && songsResp.value?.data?.feed?.entry) {
      const seen = new Set();
      for (const entry of songsResp.value.data.feed.entry) {
        const trackId = entry.id?.attributes?.['im:id'];
        const artist = entry['im:artist']?.label || 'Unknown';
        const title = entry['im:name']?.label || 'Unknown';
        const key = `${artist}|${title}`.toLowerCase();
        if (!trackId || seen.has(key)) continue;
        seen.add(key);

        const images = entry['im:image'] || [];
        const bestImage = images[images.length - 1]?.label || '';
        const cover = bestImage.replace(/\/\d+x\d+bb/, '/600x600bb');

        singles.push({
          id: `itunes_${trackId}`,
          title,
          artist,
          cover,
          type: 'single'
        });
      }
    }

    console.log(`📡 Discover: ${albums.length} albums, ${singles.length} singles from iTunes`);
    res.json({
      success: true,
      albums,
      singles,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Discovery error:', error);
    // Fallback to cached albums
    const fallback = db.prepare(
      'SELECT * FROM albums WHERE cover_url IS NOT NULL ORDER BY cached_at DESC LIMIT 20'
    ).all();
    res.json({
      success: true,
      albums: fallback.map(a => ({
        id: a.id, title: a.title, artist: a.artist,
        cover: a.cover_url, type: 'album', year: a.year,
        trackCount: a.track_count
      })),
      singles: [],
      fallback: true,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/album/lookup/:id
 * iTunes Lookup alias — fetches full tracklist for a collectionId.
 * Convenience route for the discovery flow (equivalent to /api/album/:id/tracks).
 */
app.get('/api/album/lookup/:id', async (req, res) => {
  // Forward to the existing album tracks endpoint
  req.params.albumId = req.params.id;
  const { albumId } = req.params;

  try {
    // Check local cache first
    let cachedTracks = db.prepare(
      'SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number'
    ).all(albumId);

    if (cachedTracks.length > 0) {
      return res.json({ success: true, albumId, tracks: cachedTracks, source: 'cache' });
    }

    const isNumericId = /^\d+$/.test(albumId.replace('itunes_', ''));
    const lookupId = albumId.startsWith('itunes_') ? albumId.replace('itunes_', '') : albumId;

    if (isNumericId || albumId.startsWith('itunes_')) {
      try {
        console.log(`[CATALOG] iTunes Lookup for album: ${lookupId}`);
        const itunesResp = await axios.get(
          `https://itunes.apple.com/lookup?id=${lookupId}&entity=song`,
          { timeout: 6000 }
        );

        if (itunesResp.data?.results) {
          const tracks = itunesResp.data.results
            .filter(item => item.wrapperType === 'track')
            .map((track, i) => ({
              id: String(track.trackId || `t-${i}`),
              album_id: albumId,
              artist: track.artistName || 'Unknown',
              title: track.trackName,
              duration: track.trackTimeMillis
                ? Math.round(track.trackTimeMillis / 1000)
                : null,
              track_number: track.trackNumber || i + 1,
              duration_formatted: formatMillis(track.trackTimeMillis)
            }));

          if (tracks.length > 0) {
            const insertTrack = db.prepare(
              'INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number) VALUES (?, ?, ?, ?, ?, ?)'
            );
            for (const t of tracks) {
              insertTrack.run(t.id, t.album_id, t.artist, t.title, t.duration, t.track_number);
            }
            console.log(`[CATALOG] iTunes returned ${tracks.length} tracks`);
            return res.json({ success: true, albumId, tracks, source: 'itunes' });
          }
        }
      } catch (itunesErr) {
        console.error(`[CATALOG] iTunes track lookup failed for ${lookupId}:`, itunesErr.message);
      }
    }

    res.json({ success: true, albumId, tracks: [], source: 'none' });
  } catch (error) {
    console.error('Album lookup error:', error);
    res.json({ success: true, albumId, tracks: [], source: 'error' });
  }
});

/**
 * Background: fetch fresh releases from MusicBrainz and cache them
 */
async function refreshDiscoveryCache(count) {
  console.log('🔄 Background discovery refresh...');

  const queries = ['tag:rock', 'tag:electronic', 'tag:hip-hop', 'tag:pop', 'tag:metal'];
  const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 2);

  const mbResults = [];
  for (const q of shuffled) {
    try {
      const response = await axios.get('https://musicbrainz.org/ws/2/release', {
        params: { query: q, limit: 15, fmt: 'json' },
        headers: { 'User-Agent': 'SonicSwarm/1.0 (+https://sonicswarm.local)' },
        timeout: 6000
      });
      if (response.data?.releases) mbResults.push(...response.data.releases);
    } catch { /* skip */ }
  }

  // Deduplicate
  const seen = new Set();
  const unique = mbResults.filter(r => {
    if (!r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).slice(0, count);

  // Fetch cover art IN PARALLEL (not sequentially!)
  const enriched = await Promise.all(unique.map(async (release) => {
    const albumId = uuidv4();
    const artist = release['artist-credit']?.[0]?.name || 'Unknown Artist';
    const year = release.date ? parseInt(release.date.substring(0, 4)) : null;

    let coverUrl = null;
    try {
      const coverResponse = await axios.get(
        `https://coverartarchive.org/release/${release.id}`,
        { timeout: 2000 }
      );
      const images = coverResponse.data?.images || [];
      const front = images.find(img => img.front) || images[0];
      if (front?.thumbnails?.small) coverUrl = front.thumbnails.small;
      else if (front?.image) coverUrl = front.image;
    } catch { /* no cover */ }

    // Cache
    db.prepare(`INSERT OR IGNORE INTO albums (id, title, artist, year, mbid, cover_url, track_count) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(albumId, release.title, artist, year, release.id, coverUrl, release['track-count'] || 0);

    return { id: albumId, title: release.title, artist, year, coverUrl, trackCount: release['track-count'] || 0, mbid: release.id };
  }));

  console.log(`✓ Discovery cache refreshed: ${enriched.length} new albums`);
}

/**
 * GET /api/album/:albumId/tracks
 * Fetch full tracklist — tries iTunes Lookup first, falls back to MusicBrainz/cache
 * iTunes album IDs are numeric; MusicBrainz IDs are UUIDs. We detect and route accordingly.
 */
app.get('/api/album/:albumId/tracks', async (req, res) => {
  const { albumId } = req.params;

  try {
    // Check local cache first
    let cachedTracks = db.prepare(
      'SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number'
    ).all(albumId);

    if (cachedTracks.length > 0) {
      return res.json({ success: true, albumId, tracks: cachedTracks, source: 'cache' });
    }

    // ── 1. PRIMARY: iTunes Lookup (numeric IDs = collectionId) ──
    const isItunesId = albumId.startsWith('itunes_') || /^\d+$/.test(albumId);
    const lookupId = albumId.startsWith('itunes_') ? albumId.replace('itunes_', '') : albumId;

    if (isItunesId) {
      try {
        console.log(`[CATALOG] iTunes Lookup for album: ${lookupId}`);
        const itunesResp = await axios.get(
          `https://itunes.apple.com/lookup?id=${lookupId}&entity=song`,
          { timeout: 6000 }
        );

        if (itunesResp.data?.results) {
          const tracks = itunesResp.data.results
            .filter(item => item.wrapperType === 'track')
            .map((track, i) => ({
              id: String(track.trackId || uuidv4()),
              album_id: albumId,
              artist: track.artistName || 'Unknown',
              title: track.trackName,
              duration: track.trackTimeMillis
                ? Math.round(track.trackTimeMillis / 1000)
                : null,
              track_number: track.trackNumber || i + 1,
              duration_formatted: formatMillis(track.trackTimeMillis)
            }));

          if (tracks.length > 0) {
            // Cache in DB
            const insertTrack = db.prepare(
              'INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number) VALUES (?, ?, ?, ?, ?, ?)'
            );
            for (const t of tracks) {
              insertTrack.run(t.id, t.album_id, t.artist, t.title, t.duration, t.track_number);
            }
            console.log(`[CATALOG] iTunes returned ${tracks.length} tracks`);
            return res.json({ success: true, albumId, tracks, source: 'itunes' });
          }
        }
      } catch (itunesErr) {
        console.error(`[CATALOG] iTunes track lookup failed for ${albumId}:`, itunesErr.message);
      }
    }

    // ── 2. FALLBACK: MusicBrainz (UUID-based IDs) ──
    const album = db.prepare('SELECT * FROM albums WHERE id = ? OR mbid = ?').get(albumId, albumId);
    try {
      const mbResponse = await axios.get(
        `https://musicbrainz.org/ws/2/release/${albumId}`,
        {
          params: { inc: 'recordings', fmt: 'json' },
          headers: { 'User-Agent': 'SonicSwarm/1.0' },
          timeout: 5000
        }
      );

      const media = mbResponse.data?.media || [];
      const artist = album?.artist || mbResponse.data?.['artist-credit']?.[0]?.name || 'Unknown';

      const tracks = media.flatMap(m =>
        (m.tracks || []).map((t, i) => ({
          id: uuidv4(),
          album_id: albumId,
          artist: artist,
          title: t.title,
          duration: t.length ? Math.round(t.length / 1000) : null,
          track_number: parseInt(t.position) || i + 1
        }))
      );

      if (tracks.length > 0) {
        const insertTrack = db.prepare(
          'INSERT OR IGNORE INTO tracks (id, album_id, artist, title, duration, track_number) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const t of tracks) {
          insertTrack.run(t.id, t.album_id, t.artist, t.title, t.duration, t.track_number);
        }
        return res.json({ success: true, albumId, tracks, source: 'musicbrainz' });
      }
    } catch (mbErr) {
      console.error(`MusicBrainz track fetch failed for ${albumId}:`, mbErr.message);
    }

    // ── 3. Nothing found ──
    res.json({ success: true, albumId, tracks: [], source: 'none' });
  } catch (error) {
    console.error('Album tracks error:', error);
    res.json({ success: true, albumId, tracks: [], source: 'error' });
  }
});

/**
 * GET /api/health
 * Server health check
 */
app.get('/api/health', (req, res) => {
  let totalPeers = 0;
  let totalSeeds = 0;
  for (const engine of torrentEngines.values()) {
    totalPeers += Object.keys(engine.swarm?.peers || {}).length || 0;
    totalSeeds += Object.keys(engine.swarm?.seeds || {}).length || 0;
  }

  res.json({
    success: true,
    status: 'online',
    bittorrent: {
      peers: totalPeers,
      seeds: totalSeeds,
      activeEngines: torrentEngines.size,
      protocol: 'TCP/UDP BitTorrent (torrent-stream)'
    },
    database: {
      albumsCached: db.prepare('SELECT COUNT(*) as count FROM albums').get().count,
      torrentsCached: db.prepare('SELECT COUNT(*) as count FROM torrents').get().count
    },
    uptime: process.uptime()
  });
});

// ─────────────────────────────────────────────────────────
// STATIC FILE SERVING (Frontend)
// ─────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV !== 'development';
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');

// Production mode: serve pre-built files from dist/
if (isProduction) {
  const frontendDir = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : publicDir;
  app.use(express.static(frontendDir));
  console.log(`📂 Serving frontend from: ${frontendDir === distDir ? 'dist/ (React build)' : 'public/ (vanilla)'}`);

  // SPA fallback: serve index.html for all non-API routes (production only)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      const indexPath = path.join(frontendDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Frontend not built. Run: npm run build:ui');
      }
    } else {
      res.status(404).json({ success: false, error: 'API endpoint not found' });
    }
  });
}

// ─────────────────────────────────────────────────────────
// BACKGROUND INDEXER  (Torrentio-style async pre-indexing)
// ─────────────────────────────────────────────────────────

/**
 * In-memory queue of albums waiting to be indexed.
 * Each entry: { itunesId, artist, album }
 * Items are deduplicated by itunesId and processed one at a time
 * with a delay so we don't hammer trackers.
 */
const indexQueue   = new Map();   // itunesId → {itunesId, artist, album}
let   indexerBusy  = false;

function queueForIndexing(itunesId, artist, album) {
  if (!itunesId || indexQueue.has(itunesId)) return;

  // Skip if already freshly indexed (< 6 hours old)
  const fresh = db.prepare(
    'SELECT COUNT(*) as n FROM torrent_index WHERE itunes_id = ? AND indexed_at > (unixepoch() - 21600)'
  ).get(itunesId);
  if (fresh?.n > 0) return;

  indexQueue.set(itunesId, { itunesId, artist, album });
  console.log(`🗂️  Queued for indexing: ${artist} — ${album} (queue size: ${indexQueue.size})`);
  if (!indexerBusy) processIndexQueue();
}

async function processIndexQueue() {
  if (indexQueue.size === 0) { indexerBusy = false; return; }
  indexerBusy = true;

  const [itunesId, item] = indexQueue.entries().next().value;
  indexQueue.delete(itunesId);

  try {
    console.log(`🔄 Background indexing: ${item.artist} — ${item.album}`);
    // Background: skip SolidTorrents (save its rate-limit budget for real user requests)
    // Only use piratebay + knaben for background jobs
    const results = await resolveMusicTorrent(item.artist, item.album, '', item.itunesId, true);
    if (results.length > 0) {
      console.log(`✅ Indexed ${results.length} torrents for ${item.itunesId}`);
    } else {
      console.log(`⚠️  No torrents found during background index of ${item.artist} — ${item.album}`);
    }
  } catch (e) {
    console.error(`❌ Background index error for ${item.itunesId}:`, e.message);
  }

  // Throttle: 10s between index jobs — gives rate-limited APIs time to cool down
  setTimeout(processIndexQueue, 10000);
}

/**
 * Startup indexer — fetches iTunes top-50 albums and queues them all.
 * This pre-warms the index so the first user to play any popular album
 * gets an instant ⚡ index hit instead of waiting for live scraping.
 */
async function startBackgroundIndexer() {
  console.log('🌐 Background indexer starting — fetching iTunes top charts...');
  try {
    const resp = await axios.get(
      'https://itunes.apple.com/us/rss/topalbums/limit=50/json',
      { timeout: 8000 }
    );
    const entries = resp.data?.feed?.entry || [];
    let queued = 0;

    for (const entry of entries) {
      const artist   = entry['im:artist']?.label;
      const title    = entry['im:name']?.label;
      const rawId    = entry.id?.attributes?.['im:id'];
      if (!artist || !title || !rawId) continue;

      const itunesId = `itunes_${rawId}`;
      queueForIndexing(itunesId, artist, title);
      queued++;
    }

    console.log(`📋 Queued ${queued} albums for background indexing from iTunes top charts`);
  } catch (e) {
    console.error('Background indexer fetch error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────

initializeDatabase();

async function startServer() {
  let httpServer;

  // Development mode: attach Vite's dev server as middleware
  // This gives you HMR, JSX transform, and instant reload — no build step needed.
  if (!isProduction) {
    try {
      // Create HTTP server first so Vite can intercept WebSocket upgrades for HMR
      httpServer = app.listen(PORT, () => {
        console.log('⚡ Vite dev server attached — HMR + JSX transform active');
        printBanner();
      });

      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: { server: httpServer } },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error('⚠ Failed to start Vite dev server:', e.message);
      console.log('   Falling back to raw public/ directory...');
      app.use(express.static(publicDir));

      if (!httpServer) {
        httpServer = app.listen(PORT, printBanner);
      }
    }
  } else {
    // Production mode: serve pre-built files
    httpServer = app.listen(PORT, printBanner);
  }

  function printBanner() {
    const mode = isProduction ? 'PRODUCTION' : 'DEVELOPMENT';
    console.log(`
╔════════════════════════════════════════════════════════════╗
║        🎵 SONICSWARM P2P BACKEND ONLINE 🎵                 ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Mode:          ${mode.padEnd(40)}║
║  Frontend:      http://localhost:${PORT}                      ║
║  API:           http://localhost:${PORT}/api                  ║
║  Database:      ${dbPath}
║  BitTorrent:  TCP/UDP + DHT (torrent-stream)              ║
║  Status:        Ready for connections                     ║
║                                                            ║
║  API Endpoints:                                            ║
║    GET    /api/discover          → Discovery homepage      ║
║    GET    /api/album/:id/tracks  → Album tracklist          ║
║    POST   /api/sources           → Stremio-style scraper   ║
║    POST   /api/resolve           → Find torrents            ║
║    GET    /api/search            → Search albums            ║
║    GET    /api/library           → View library             ║
║    POST   /api/stream            → Start playback           ║
║    GET    /api/swarm-stats       → Live statistics          ║
║    POST   /api/prebuffer         → Pre-cache tracks         ║
║    GET    /api/health            → Server status            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);

    // Start the background indexer 8 seconds after server boot
    // (gives WebTorrent + DB time to fully initialize first)
    setTimeout(() => {
      startBackgroundIndexer();
      // Re-run every 2 hours to keep the index fresh with new releases
      setInterval(startBackgroundIndexer, 2 * 60 * 60 * 1000);
    }, 8000);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    for (const engine of torrentEngines.values()) {
      try { engine.destroy(() => { }); } catch (e) { /* ok */ }
    }
    try { db.close(); } catch (e) { /* ok */ }
    httpServer.close();
    process.exit(0);
  });
}

startServer();

export default app;