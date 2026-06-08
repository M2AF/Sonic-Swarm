/**
 * SonicSwarm Electron Main Process
 * Manages backend server and window lifecycle
 * 
 * Run: npm run electron:dev
 */

const { app, BrowserWindow, Menu } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

// ─────────────────────────────────────────────────────────
// CREATE WINDOW
// ─────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../frontend/build/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────
// BACKEND SERVER PROCESS
// ─────────────────────────────────────────────────────────

function startBackendServer() {
  console.log('Starting backend server...');

  const serverPath = path.join(__dirname, '../backend/server.js');

  backendProcess = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production'
    }
  });

  backendProcess.on('error', (error) => {
    console.error('Backend error:', error);
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });

  // Give server time to start
  return new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });
}

// ─────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────

app.on('ready', async () => {
  // Start backend server
  await startBackendServer();

  // Create window
  createWindow();

  // Create menu
  createMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ─────────────────────────────────────────────────────────
// APPLICATION MENU
// ─────────────────────────────────────────────────────────

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SonicSwarm',
          click: () => {
            // Show about dialog
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────

process.on('exit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

// Handle signals
process.on('SIGINT', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  app.quit();
});