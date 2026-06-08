# SonicSwarm Quick Reference

## Common Commands

### Installation & Setup
```bash
# Clone and install
git clone https://github.com/yourusername/sonicswarm.git
cd sonicswarm
npm install
cd frontend && npm install && cd ..

# Create .env file
cp config/.env.example .env
```

### Running
```bash
# Backend only
npm start

# Frontend dev server (new terminal)
npm run frontend

# Both together
npm run dev  # (requires concurrently)

# Desktop app
npm run electron:dev

# Production build
npm run build:installer
```

### Development
```bash
# Backend with auto-reload
npm run dev

# Run tests
npm test

# Build frontend
cd frontend && npm run build

# Check database
sqlite3 data/sonicswarm.db
```

---

## API Endpoints (Quick Reference)

### Search Albums
```bash
curl "http://localhost:9191/api/search?q=beatles&type=album"
```

### Resolve Track to Torrents
```bash
curl -X POST http://localhost:9191/api/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "artist": "The Beatles",
    "track": "Let It Be",
    "album": "Let It Be"
  }'
```

### Start Stream
```bash
curl -X POST http://localhost:9191/api/stream \
  -H "Content-Type: application/json" \
  -d '{
    "magnet": "magnet:?xt=urn:btih:..."
  }'
```

### Get Swarm Stats
```bash
curl http://localhost:9191/api/swarm-stats
```

### Server Health
```bash
curl http://localhost:9191/api/health
```

---

## React Hooks Usage

### Use SonicSwarm Context
```jsx
import { useSonicSwarm } from './SonicSwarmContext';

function MyComponent() {
  const {
    searchAlbums,
    resolveTorrent,
    startStream,
    swarmStats,
    serverConnected
  } = useSonicSwarm();

  // Use these...
}
```

### Search for Albums
```jsx
const { searchResults, searchLoading, searchAlbums } = useSonicSwarm();

// Call search
await searchAlbums("the beatles");

// Results available in searchResults state
searchResults.forEach(album => console.log(album.title));
```

### Resolve Torrent
```jsx
const { resolveTorrent } = useSonicSwarm();

const data = await resolveTorrent(
  "The Beatles",
  "Let It Be",
  "Let It Be Album"
);

console.log(data.torrents);  // Array of magnets
```

### Start Playing
```jsx
const { startStream, streamStatus } = useSonicSwarm();

await startStream("magnet:?xt=urn:btih:...");

// streamStatus changes: idle → connecting → streaming
```

### Get Live Stats
```jsx
const { swarmStats } = useSonicSwarm();

console.log(swarmStats.totalPeers);        // Number of peers
console.log(swarmStats.totalDownloadSpeed); // MB/s
console.log(swarmStats.activeTorrents);    // Active torrents
```

---

## Database Queries

### Find Album
```javascript
const album = db.prepare(
  'SELECT * FROM albums WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)'
).get('The Beatles', 'Let It Be');
```

### Search Albums
```javascript
const results = db.prepare(`
  SELECT * FROM albums
  WHERE LOWER(title) LIKE LOWER(?) OR LOWER(artist) LIKE LOWER(?)
  LIMIT 20
`).all('%beatles%', '%beatles%');
```

### Find Torrents for Track
```javascript
const torrents = db.prepare(`
  SELECT * FROM torrents
  WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)
  AND seeders > 0
  ORDER BY seeders DESC
  LIMIT 5
`).all('The Beatles', 'Let It Be');
```

### Insert Torrent
```javascript
const stmt = db.prepare(`
  INSERT INTO torrents (id, magnet, artist, title, seeders, leechers, file_name, quality, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

stmt.run(
  uuidv4(),
  'magnet:?xt=urn:btih:...',
  'The Beatles',
  'Let It Be',
  150,  // seeders
  10,   // leechers
  'beatles-let-it-be.mp3',
  'MP3-320',
  'PirateBay'
);
```

### Get User Library
```javascript
const library = db.prepare(`
  SELECT a.* FROM albums a
  JOIN user_library ul ON a.id = ul.album_id
  ORDER BY ul.added_at DESC
  LIMIT 50
`).all();
```

### Record Playback
```javascript
const stmt = db.prepare(`
  INSERT INTO playback_history (id, track_id, album_id, duration_played)
  VALUES (?, ?, ?, ?)
`);

stmt.run(uuidv4(), trackId, albumId, 180); // 3 minutes played
```

---

## Common Code Patterns

### Add New API Endpoint
```javascript
// In backend/server.js

app.post('/api/my-endpoint', async (req, res) => {
  const { param1, param2 } = req.body;

  if (!param1) {
    return res.status(400).json({ error: 'Missing param1' });
  }

  try {
    // Do something
    const result = await someOperation(param1, param2);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### Use New API from React
```javascript
// In SonicSwarmContext.jsx

const myFunction = useCallback(async (param1, param2) => {
  try {
    const response = await fetch(`${API_BASE}/api/my-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ param1, param2 })
    });

    if (!response.ok) throw new Error('API error');

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}, []);

// Add to context return value
// And export via context...
```

### Add Database Table
```javascript
// In backend/database.js, in initializeDatabase()

db.exec(`
  CREATE TABLE IF NOT EXISTS my_table (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
  );

  CREATE INDEX IF NOT EXISTS idx_my_table_name ON my_table(name);
`);
```

---

## Debugging

### Check Backend Logs
```bash
# Logs appear in terminal where you ran: npm start

# Look for errors like:
# ✗ Torrent error
# 🔴 MusicBrainz error
# Connection errors
```

### Check Frontend Console
```bash
# Press F12 in browser
# Console tab shows:
# - Network errors
# - API responses
# - State changes
```

### Test API Directly
```bash
# Check if server is responding
curl http://localhost:9191/api/health

# If connection refused = backend not running
# If returns 200 = backend working
```

### Monitor Database
```bash
# View database contents
sqlite3 data/sonicswarm.db

# Useful queries:
sqlite> SELECT COUNT(*) FROM albums;
sqlite> SELECT COUNT(*) FROM torrents;
sqlite> SELECT * FROM albums LIMIT 5;
sqlite> .tables
sqlite> .schema albums
```

### Check Torrent Swarm
```bash
# Get live stats
curl http://localhost:9191/api/swarm-stats | jq '.'

# Shows:
# - Active torrents
# - Total peers
# - Download speed
# - Each torrent status
```

---

## Performance Tips

### Speed Up Queries
```javascript
// Add indexes for frequently searched columns
db.prepare(`
  CREATE INDEX idx_torrents_artist_title 
  ON torrents(LOWER(artist), LOWER(title))
`).run();

// Use LIMIT on searches
.all() → limit results to ~20
```

### Reduce Memory Usage
```javascript
// Limit concurrent torrents
const maxConcurrentSwarms = 3;

// Clean old cache regularly
db.prepare(`
  DELETE FROM torrents 
  WHERE last_seen < datetime('now', '-30 days')
`).run();
```

### Improve UI Performance
```jsx
// Virtualize long lists (coming soon)
// Use React.memo for components that don't change
// Lazy-load images
// Debounce search input
```

---

## Environment Variables

### Backend
```bash
PORT=9191                    # Server port
NODE_ENV=development         # dev or production
LOG_LEVEL=info              # debug, info, warn, error
DB_DEBUG=false              # Log SQL queries?
```

### Frontend
```bash
REACT_APP_API_URL=http://localhost:9191
REACT_APP_DEBUG=false
```

### Run with Custom Values
```bash
PORT=8080 npm start
REACT_APP_API_URL=https://api.example.com npm run frontend
```

---

## File Editing Checklist

### Adding a Feature

1. **Database Schema** (if needed)
   - Edit `backend/database.js`
   - Run: `npm start` (auto-initializes)

2. **Backend Endpoint**
   - Edit `backend/server.js`
   - Test with curl

3. **Frontend Hook** (if needed)
   - Edit `SonicSwarmContext.jsx`
   - Export new function

4. **React Component**
   - Edit `frontend/src/App.jsx`
   - Call the hook
   - Update CSS in `App.css`

5. **Test**
   - `npm start` (backend)
   - `npm run frontend` (frontend)
   - Open browser, test flow

---

## Keyboard Shortcuts (UI)

- **Space** → Play/Pause (when focused on player)
- **>** → Next track
- **<** → Previous track
- **F12** → Developer console
- **Ctrl+K** → Focus search (coming soon)

---

## File Paths Reference

```
Root:                   /home/claude/sonicswarm-complete/
Backend:                ./backend/server.js
Frontend source:        ./frontend/src/
Frontend build:         ./frontend/build/
Database:               ./data/sonicswarm.db
Config template:        ./config/.env.example
Environment file:       ./.env (create from template)
```

---

## Quick Problem Solver

| Problem | Likely Cause | Solution |
|---------|--------------|----------|
| "Cannot find module" | Dependency not installed | `npm install` |
| Port already in use | Another app using port | Change PORT in .env |
| API not responding | Backend not running | Run `npm start` |
| No results found | Typo in search | Try simpler query |
| Torrent won't play | No seeders | Try popular album |
| Database locked | Multiple processes | Restart both terminals |
| UI not updating | React state issue | Check browser console |
| Slow search | Index missing | Run `npm run rebuild-db` |

---

## Resources

- **WebTorrent Docs:** https://webtorrent.io/
- **Express API:** https://expressjs.com/
- **React Hooks:** https://react.dev/reference/react/hooks
- **SQLite:** https://www.sqlite.org/cli.html
- **MusicBrainz API:** https://musicbrainz.org/doc/MusicBrainz_API

---

**Print this page for quick reference!** 📋

*Last updated: 2024 | SonicSwarm v0.1.0*
