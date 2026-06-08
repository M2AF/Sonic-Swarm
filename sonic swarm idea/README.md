# SonicSwarm 🎵

**User-owned P2P music streaming network. No corporate control. No data harvesting. No subscription fees.**

![Status](https://img.shields.io/badge/Status-Beta-orange)
![License](https://img.shields.io/badge/License-AGPL3.0-blue)
![Node](https://img.shields.io/badge/Node-16+-green)

---

## What is SonicSwarm?

SonicSwarm is a **fully decentralized music streaming platform** built on peer-to-peer technology. Instead of a company's servers, music streams through a global swarm of user-owned nodes.

**It's Spotify, but owned by you.**

### Key Differences from Spotify

| Feature | Spotify | SonicSwarm |
|---------|---------|-----------|
| **Ownership** | Corporate (Proprietary) | Users (Open Source) |
| **Data Privacy** | Collected & sold | Local-first, your control |
| **Cost** | $11.99/month | Free (or you host) |
| **Infrastructure** | Centralized servers | P2P swarm |
| **Content Control** | Editorial playlists | You curate |
| **Offline Access** | Premium only | Built-in |

---

## Features

### Now (v0.1.0)

- ✅ **P2P Music Streaming** — Real WebTorrent engine
- ✅ **Album Search** — MusicBrainz integration
- ✅ **Swarm Stats** — Live peer/seed visualization
- ✅ **Look-ahead Buffering** — Sub-500ms track skipping
- ✅ **Local Metadata Cache** — Zero external calls after bootstrap
- ✅ **Cross-platform** — Windows, macOS, Linux
- ✅ **Desktop & Web** — Electron + React

### Coming Soon

- 🚧 **Real Torrent Finder** — Auto-resolve tracks from DHT/trackers
- 🚧 **Community Nodes** — Federated swarm of resolver servers
- 🚧 **User Accounts** — Optional (no login required)
- 🚧 **Mobile Apps** — iOS/Android via React Native
- 🚧 **IPFS Archive** — Seed metadata across IPFS
- 🚧 **Collaborative Playlists** — Share & vote on content

---

## Quick Start

### 5-Minute Setup

```bash
# 1. Clone
git clone https://github.com/yourusername/sonicswarm.git
cd sonicswarm

# 2. Install
npm install && cd frontend && npm install && cd ..

# 3. Start Backend
npm start

# 4. Start Frontend (new terminal)
npm run frontend

# 5. Open browser
# → http://localhost:3000
```

**That's it.** You now have:
- ✅ P2P music streaming engine running
- ✅ Web UI for searching & playing music
- ✅ Live connection to BitTorrent network

See [SETUP.md](./SETUP.md) for detailed instructions.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│          USER'S LOCAL CLIENT                 │
├──────────────────────────────────────────────┤
│                                              │
│  Frontend (React)    │  Backend (Node.js)   │
│  ├─ Album View      │  ├─ Express API      │
│  ├─ Player UI       │  ├─ WebTorrent       │
│  └─ Search          │  ├─ SQLite DB        │
│                     │  └─ Metadata Cache   │
│                                              │
│         WebTorrent P2P Engine                │
│         (DHT + Tracker Discovery)            │
│                                              │
└──────────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
    ┌───▼────────────┐      ┌──────────▼────┐
    │ BitTorrent     │      │ MusicBrainz   │
    │ Network        │      │ API (Metadata)│
    │ (DHT/Trackers) │      │               │
    └────────────────┘      └────────────────┘
        │
        │ (Community-seeded torrents)
        │
    ┌───▼────────────────────────┐
    │  Global Swarm              │
    │  - User A seeding          │
    │  - User B downloading      │
    │  - User C sharing metadata │
    └────────────────────────────┘
```

**Key Insight:** Every user is a node. The more nodes, the stronger the network.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + Tailwind | User interface |
| **Backend** | Node.js + Express | REST API |
| **P2P Engine** | WebTorrent | Torrent streaming |
| **Database** | SQLite | Metadata caching |
| **Metadata** | MusicBrainz API | Album/artist info |
| **Desktop** | Electron | Windows/Mac/Linux app |
| **Deployment** | Docker | Container support |

---

## Development

### Project Structure

```
sonicswarm/
├── backend/
│   ├── server.js           # Main API server
│   ├── database.js         # DB utilities
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main component
│   │   ├── SonicSwarmContext.jsx  # State management
│   │   ├── App.css         # Styling
│   │   └── ...
│   ├── public/
│   └── package.json
├── electron/
│   ├── main.js             # Electron entry
│   └── preload.js          # IPC bridge
├── config/
│   └── .env.example        # Configuration
├── scripts/
│   └── build.sh            # Build script
├── SETUP.md                # Setup guide
├── IMPLEMENTATION_GUIDE.md # Full roadmap
└── package.json            # Root dependencies
```

### Running in Development

```bash
# Terminal 1: Backend with auto-reload
npm run dev

# Terminal 2: Frontend dev server
npm run frontend

# Terminal 3 (optional): Desktop app
npm run electron
```

### Building for Production

```bash
# Build everything
npm run build:installer

# Output: dist/SonicSwarm-Setup-0.1.0.exe
```

---

## API Reference

All endpoints return JSON. Base URL: `http://localhost:9191`

### Search

```bash
GET /api/search?q=artist+album
```

Response:
```json
{
  "success": true,
  "query": "artist album",
  "results": [
    {
      "id": "album-123",
      "title": "Album Name",
      "artist": "Artist Name",
      "year": 2023,
      "track_count": 12
    }
  ]
}
```

### Resolve Torrents

```bash
POST /api/resolve
```

Body:
```json
{
  "artist": "Artist Name",
  "track": "Track Title",
  "album": "Album Name"
}
```

Response:
```json
{
  "success": true,
  "metadata": { ... },
  "torrents": [
    {
      "magnet": "magnet:?xt=urn:btih:...",
      "seeders": 42,
      "leechers": 8,
      "fileName": "artist-track.mp3",
      "quality": "320kbps",
      "confidence": "high"
    }
  ]
}
```

### Stream

```bash
POST /api/stream
```

Body:
```json
{
  "magnet": "magnet:?xt=urn:btih:..."
}
```

### Swarm Stats

```bash
GET /api/swarm-stats
```

Response:
```json
{
  "success": true,
  "activeTorrents": 3,
  "totalPeers": 42,
  "totalSeeds": 18,
  "totalDownloadSpeed": "4.2",
  "swarms": [...]
}
```

See `IMPLEMENTATION_GUIDE.md` for full API documentation.

---

## Roadmap

### Phase 1: MVP ✅
- [x] Backend P2P engine
- [x] React frontend
- [x] Basic playback
- [ ] Real torrent finding

### Phase 2: Discovery
- [ ] Live torrent resolver
- [ ] Fuzzy metadata matching
- [ ] Tracker integration
- [ ] Better caching

### Phase 3: Performance
- [ ] Optimized pre-buffering
- [ ] Connection pooling
- [ ] Bandwidth throttling
- [ ] Mobile optimization

### Phase 4: Distribution
- [ ] Windows installer
- [ ] Docker containers
- [ ] Federated nodes
- [ ] Self-hosting guides

### Phase 5: Community
- [ ] User accounts (optional)
- [ ] Playlist sharing
- [ ] Community indexing
- [ ] Mobile apps

---

## Security & Privacy

### What SonicSwarm Does NOT Do

- ❌ Track listening habits
- ❌ Show personalized ads
- ❌ Sell user data
- ❌ Require accounts
- ❌ Phone home to company servers

### What It DOES Do

- ✅ Stream over P2P (encrypted via DHT)
- ✅ Cache metadata locally
- ✅ Let you control your node
- ✅ Optional federation (you pick peers)
- ✅ Full open-source code

---

## Legal & Ethics

**SonicSwarm is infrastructure.** Like BitTorrent, it's neutral tech.

- Users are responsible for content they download
- Artists/labels can seed their own work
- Unsigned/independent music encouraged
- DMCA takedown process available

(See LICENSE for full AGPL-3.0 terms)

---

## Contributing

We welcome contributions!

### Getting Started

1. Fork the repo
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open Pull Request

### Areas We Need Help

- Real torrent tracker integration
- Mobile app (React Native)
- UI/UX improvements
- Database optimization
- Deployment guides
- Documentation

---

## Community

- **Discord:** [Join our server](https://discord.gg/sonicswarm) (coming soon)
- **GitHub Issues:** Report bugs, request features
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/sonicswarm/discussions)

---

## License

SonicSwarm is **AGPL-3.0** licensed. This means:

- ✅ Free to use, modify, distribute
- ✅ Source code must be public
- ✅ Any modifications must be shared
- ✅ No proprietary forks

See [LICENSE](./LICENSE) for details.

---

## FAQ

### How is this legal?

SonicSwarm is like BitTorrent — neutral infrastructure. Users control content. Most music is independently produced or openly licensed.

### Can I host my own node?

Yes! That's the whole point. Run SonicSwarm on your server, point friends to it, build a community swarm.

### Does it work offline?

Partially. You can play cached music. For new tracks, you need internet to find peers.

### What about metadata (album art, artist info)?

From MusicBrainz (open-source, CC-licensed). No proprietary data.

### Can I use it on my phone?

Yes (coming soon with React Native app). For now: web browser on mobile works okay.

### How do I report copyright issues?

Each torrent can be reported. We honor takedown requests.

---

## Acknowledgments

Built on shoulders of giants:

- **Spotify** (for proving P2P music works)
- **BitTorrent** protocol (decentralized foundation)
- **WebTorrent** (JavaScript implementation)
- **MusicBrainz** (open metadata)
- **React** & **Node.js** communities

---

## Contact

- **Issues:** GitHub Issues tab
- **Email:** (your-email-here)
- **Twitter:** [@sonicswarm](https://twitter.com/sonicswarm) (coming soon)

---

**SonicSwarm: Music for the people, owned by the people.**

🎵 Stream free. Own your network. 🎵

---

*Last updated: 2024 | Version 0.1.0-beta*
