# SonicSwarm Setup & Installation Guide

## System Requirements

- **Node.js:** 16+ (18+ recommended)
- **npm:** 8+
- **OS:** Windows, macOS, or Linux
- **RAM:** 2GB minimum (4GB+ recommended)
- **Disk Space:** 500MB for app + database

## Quick Start (5 Minutes)

### 1. Clone/Download SonicSwarm

```bash
git clone https://github.com/yourusername/sonicswarm.git
cd sonicswarm
```

### 2. Install Dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 3. Start Backend Server

```bash
npm start
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║        🎵 SONICSWARM P2P BACKEND ONLINE 🎵                 ║
╠════════════════════════════════════════════════════════════╣
║  API Server:     http://localhost:9191                     ║
║  Status:         Ready for connections                     ║
╚════════════════════════════════════════════════════════════╝
```

### 4. Start Frontend (New Terminal)

```bash
npm run frontend
```

This opens http://localhost:3000 with the SonicSwarm UI.

### 5. Test Connection

Open browser to http://localhost:3000

You should see:
- ✅ P2P Node status: "🟢 Online"
- ✅ Album library with demo content
- ✅ "Search" button functional

**That's it!** SonicSwarm is now running.

---

## Detailed Setup

### Prerequisites Installation

#### Windows

1. **Install Node.js:**
   - Download from https://nodejs.org (LTS version)
   - Run installer, accept defaults
   - Verify: `node --version` & `npm --version`

2. **Install Git (Optional but recommended):**
   - Download from https://git-scm.com
   - Run installer, use defaults

#### macOS

```bash
# Using Homebrew (https://brew.sh)
brew install node@18
brew install git
```

#### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

---

### Configuration

#### 1. Create `.env` File

```bash
cp config/.env.example .env
```

Edit `.env` for your setup:

```bash
# Backend port
PORT=9191

# Frontend dev server (change if port 3000 is in use)
REACT_APP_API_URL=http://localhost:9191

# Environment
NODE_ENV=development

# Logging
LOG_LEVEL=info
```

#### 2. Database Setup (Automatic)

Database initializes automatically on first run:
- Location: `./data/sonicswarm.db` (SQLite)
- Schema: Created automatically
- No manual setup needed

To seed with sample data:

```bash
node backend/seed-db.js
```

---

### Running SonicSwarm

#### Option A: Backend Only

```bash
npm start
```

Perfect for:
- Testing P2P engine
- Integrating with external UI
- Server-only deployment

Access API at: `http://localhost:9191`

#### Option B: Backend + Frontend Dev Server

Terminal 1:
```bash
npm start
```

Terminal 2:
```bash
npm run frontend
```

Perfect for:
- Development & debugging
- UI/UX iteration
- Hot reloading changes

Access UI at: `http://localhost:3000`

#### Option C: Full Electron Desktop App

```bash
npm run electron:dev
```

Perfect for:
- Desktop distribution
- Single-click launch
- Native window controls

---

### Troubleshooting

#### "Port 3000 already in use"

```bash
# Kill process using port 3000
# macOS/Linux:
lsof -ti:3000 | xargs kill -9

# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

Or change port:
```bash
PORT=3001 npm run frontend
```

#### "Cannot find module 'webtorrent'"

```bash
rm -rf node_modules package-lock.json
npm install
```

#### "Backend not connecting"

Check:
1. Backend running on correct port (9191)
2. Frontend API URL correct in `.env`
3. No firewall blocking connections
4. Browser console for error messages

#### Database Locked

```bash
# Close all instances
# Remove lock files
rm -f ./data/sonicswarm.db-shm
rm -f ./data/sonicswarm.db-wal

# Restart
npm start
```

---

## Production Deployment

### Self-Hosted VPS

#### Step 1: Server Setup (Ubuntu 22.04)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Git
sudo apt-get install -y git

# Clone repository
git clone https://github.com/yourusername/sonicswarm.git
cd sonicswarm

# Install dependencies
npm install --production
cd frontend && npm run build && cd ..
```

#### Step 2: Run as Service

Create `/etc/systemd/system/sonicswarm.service`:

```ini
[Unit]
Description=SonicSwarm P2P Music Streaming
After=network.target

[Service]
Type=simple
User=sonicswarm
WorkingDirectory=/home/sonicswarm/sonicswarm
ExecStart=/usr/bin/node backend/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sonicswarm
sudo systemctl start sonicswarm

# Check status
sudo systemctl status sonicswarm
```

#### Step 3: Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Backend API
    location /api {
        proxy_pass http://localhost:9191;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

Restart Nginx:
```bash
sudo systemctl restart nginx
```

---

### Docker Deployment

#### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy backend
COPY backend ./backend
COPY package.json .
RUN npm install --production

# Copy frontend build
COPY frontend/build ./frontend/build

# Expose port
EXPOSE 9191

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "require('http').get('http://localhost:9191/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start
CMD ["node", "backend/server.js"]
```

Build & Run:

```bash
docker build -t sonicswarm .
docker run -p 9191:9191 -v sonicswarm_data:/app/data sonicswarm
```

---

### Windows Installer (NSIS)

Build executable:

```bash
npm run build:installer
```

Creates `SonicSwarm-Setup-0.1.0.exe` in `dist/` folder.

Users can:
1. Download installer
2. Double-click to install
3. Click "Launch" to start
4. Browser opens automatically

---

## Development Workflow

### 1. Backend Development

```bash
# Start with auto-reload
npm run dev

# Make changes to backend/server.js
# Server restarts automatically
```

### 2. Frontend Development

```bash
# Terminal 1: Backend
npm start

# Terminal 2: Frontend with hot reload
npm run frontend

# Edit frontend/src/ files
# Changes appear instantly
```

### 3. Testing API

```bash
# Test resolve endpoint
curl -X POST http://localhost:9191/api/resolve \
  -H "Content-Type: application/json" \
  -d '{"artist":"The Beatles","track":"Let It Be"}'

# Test health
curl http://localhost:9191/api/health
```

---

## Next Steps

1. **Search Implementation** → Add real torrent tracker queries
2. **User Accounts** → Optional authentication layer
3. **Mobile App** → React Native version
4. **Federated Nodes** → P2P resolver network
5. **Community Hosting** → Let users run their own nodes

See `IMPLEMENTATION_GUIDE.md` for detailed roadmap.

---

## Getting Help

- **Issues:** Check `backend/server.js` or `frontend/src/` for error logs
- **API Docs:** POST /api/resolve, GET /api/search, etc.
- **Community:** (Community/Discord links when ready)

---

**Welcome to user-owned music. Happy streaming!** 🎵
