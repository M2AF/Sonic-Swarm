/**
 * SonicSwarm Frontend App
 * Single-page P2P music streaming interface
 */

const API = '';

// ─── STATE ───
const state = {
  view: 'library',        // 'library' | 'search' | 'album'
  albums: [],
  currentAlbum: null,
  currentTrackIndex: 0,
  isPlaying: false,
  currentStreamId: null,
  currentMagnet: null,
  torrentResolving: false,
  torrentData: null,
  torrentError: null,
  swarmStats: { totalPeers: 0, totalSeeds: 0, totalDownloadSpeed: '0', swarms: [] },
  serverOnline: false,
  searchResults: [],
  searchLoading: false,
};

const audio = document.getElementById('audioPlayer');
let statsPollInterval = null;
let healthPollInterval = null;

// ─── DOM REFS ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const contentArea = $('#contentArea');
const playerBar = $('#playerBar');
const playBtn = $('#playBtn');
const prevBtn = $('#prevBtn');
const nextBtn = $('#nextBtn');
const progressBar = $('#progressBar');
const progressFill = $('#progressFill');
const currentTimeEl = $('#currentTime');
const totalTimeEl = $('#totalTime');
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const pasteMagnetBtn = $('#pasteMagnetBtn');
const statusBadge = $('#statusBadge');
const statusFill = $('#statusFill');

// ─── API HELPERS ───
async function api(path, options = {}) {
  const url = API + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── INIT ───
async function init() {
  setupNav();
  setupPlayerControls();
  setupSearch();
  setupMagnetPaste();
  await checkHealth();
  await loadLibrary();
  startHealthPolling();
  startStatsPolling();
}

// ─── NAVIGATION ───
function setupNav() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      state.view = view;
      if (view === 'library') loadLibrary();
      if (view === 'search') showSearchView();
    });
  });
}

// ─── HEALTH ───
async function checkHealth() {
  try {
    const data = await api('/api/health');
    state.serverOnline = data.status === 'online';
    updateServerStatus(true);
  } catch {
    state.serverOnline = false;
    updateServerStatus(false);
  }
}

function updateServerStatus(online) {
  if (online) {
    statusBadge.textContent = '🟢 Online';
    statusBadge.style.color = 'var(--success)';
    statusFill.classList.add('online');
  } else {
    statusBadge.textContent = '🔴 Offline';
    statusBadge.style.color = 'var(--danger)';
    statusFill.classList.remove('online');
  }
}

function startHealthPolling() {
  if (healthPollInterval) clearInterval(healthPollInterval);
  healthPollInterval = setInterval(checkHealth, 10000);
}

// ─── STATS POLLING ───
async function pollSwarmStats() {
  try {
    const data = await api('/api/swarm-stats');
    state.swarmStats = data;
    updateStatsDisplay();
  } catch {
    // Server may be down
  }
}

function startStatsPolling() {
  if (statsPollInterval) clearInterval(statsPollInterval);
  statsPollInterval = setInterval(pollSwarmStats, 1500);
  pollSwarmStats();
}

function updateStatsDisplay() {
  const s = state.swarmStats;
  $('#peerCount').textContent = s.totalPeers || 0;
  $('#dlSpeed').textContent = (s.totalDownloadSpeed || '0') + ' KB/s';
  $('#swarmPeers').textContent = s.totalPeers || 0;
  $('#swarmDl').textContent = (s.totalDownloadSpeed || '0') + ' KB/s';
  const swarm = s.swarms?.[0];
  if (swarm) {
    $('#swarmProgress').textContent = swarm.progress || '0%';
  }
}

// ─── DISCOVER / HOME PAGE ───
async function loadLibrary() {
  try {
    contentArea.innerHTML = `
      <div class="discover-view">
        <h2 class="view-title">Discover Music</h2>
        <div class="discover-grid" id="discoverGrid">
          <div class="empty-state"><span class="spinner" style="width:32px;height:32px;border-width:3px;"></span><p>Loading trending music...</p></div>
        </div>
      </div>
    `;

    const data = await api('/api/discover');
    state.albums = data.results || [];
    renderDiscoverGrid();
  } catch (err) {
    console.error('Failed to load discover:', err);
    // Fallback to library
    try {
      const libData = await api('/api/library');
      state.albums = libData.albums || [];
      renderDiscoverGrid();
    } catch {
      contentArea.innerHTML = `<div class="empty-state"><span class="icon">💿</span><p>Could not load music. Is the server running?</p></div>`;
    }
  }
}

function renderDiscoverGrid() {
  if (state.albums.length === 0) {
    contentArea.innerHTML = `<h2 class="view-title">Discover Music</h2><div class="empty-state"><span class="icon">💿</span><p>No music found. Search for something!</p></div>`;
    return;
  }

  const gridHtml = state.albums.map(album => `
    <div class="album-card" data-album-id="${escHtml(album.id)}" data-album-json='${escHtml(JSON.stringify(album))}'>
      <div class="album-art">
        ${album.coverUrl
      ? `<img src="${escHtml(album.coverUrl)}" alt="${escHtml(album.title)}" loading="lazy" onerror="this.parentElement.innerHTML='💿'" />`
      : '💿'}
      </div>
      <h3>${escHtml(album.title)}</h3>
      <p>${escHtml(album.artist)}</p>
      ${album.year ? `<span class="album-year">${album.year}</span>` : ''}
    </div>
  `).join('');

  contentArea.innerHTML = `
    <div class="discover-view">
      <h2 class="view-title">Discover Music</h2>
      <div class="discover-grid">${gridHtml}</div>
    </div>
  `;

  // Click handlers
  $$('.album-card').forEach(card => {
    card.addEventListener('click', async () => {
      const json = card.dataset.albumJson;
      if (!json) return;
      const album = JSON.parse(json);
      await openDiscoveredAlbum(album);
    });
  });
}

async function openDiscoveredAlbum(album) {
  state.view = 'album';
  state.currentAlbum = null;
  state.currentTrackIndex = 0;
  state.torrentData = null;
  state.torrentError = null;
  state.torrentResolving = true;

  // Show loading
  contentArea.innerHTML = `
    <div class="album-detail">
      <button class="back-btn" id="backToLibrary">← Back to Discover</button>
      <div class="album-hero">
        <div class="album-art-large">
          ${album.coverUrl ? `<img src="${escHtml(album.coverUrl)}" alt="${escHtml(album.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:16px;" />` : '💿'}
        </div>
        <div class="album-meta">
          <span class="label">Album</span>
          <h2>${escHtml(album.title)}</h2>
          <p class="artist-name">${escHtml(album.artist)}</p>
          <div id="torrentStatus">
            <span class="torrent-badge loading"><span class="spinner"></span> Loading tracklist & searching torrents...</span>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#backToLibrary')?.addEventListener('click', () => {
    state.view = 'library';
    $$('.nav-btn')[0].classList.add('active');
    $$('.nav-btn')[1].classList.remove('active');
    loadLibrary();
    stopPlayback();
  });

  playerBar.style.display = 'flex';
  updatePlayButton();

  try {
    // 1. Fetch tracklist from MusicBrainz
    const trackData = await api(`/api/album/${album.id}/tracks`);
    const tracks = (trackData.tracks || []).map(t => ({
      id: t.id,
      title: t.title,
      duration: t.duration || 200
    }));

    // If no tracks, create placeholders
    const finalTracks = tracks.length > 0 ? tracks : Array.from({ length: album.trackCount || 8 }, (_, i) => ({
      id: `st-${i}`,
      title: `Track ${i + 1}`,
      duration: 200
    }));

    // 2. Build the full album object
    const fullAlbum = {
      id: album.id,
      title: album.title,
      artist: album.artist,
      year: album.year,
      coverUrl: album.coverUrl,
      tracks: finalTracks
    };

    state.currentAlbum = fullAlbum;
    state.torrentResolving = false;
    renderAlbumView();

    // 3. Auto-resolve the first track
    await resolveAndPlayTrack(0);
  } catch (err) {
    state.torrentResolving = false;
    state.torrentError = err.message;
    updateTorrentStatus();
  }
}

// ─── ALBUM VIEW ───
async function openAlbum(album) {
  state.view = 'album';
  state.currentAlbum = album;
  state.currentTrackIndex = 0;
  state.torrentData = null;
  state.torrentError = null;
  state.torrentResolving = false;

  renderAlbumView();

  // Auto-resolve first track's torrent
  if (album.tracks && album.tracks.length > 0) {
    await resolveAndPlayTrack(0);
  }
}

function renderAlbumView() {
  const album = state.currentAlbum;
  if (!album) return;

  contentArea.innerHTML = `
    <div class="album-detail">
      <button class="back-btn" id="backToLibrary">← Back to Library</button>
      <div class="album-hero">
        <div class="album-art-large">💿</div>
        <div class="album-meta">
          <h2>${escHtml(album.title)}</h2>
          <p class="artist-name">${escHtml(album.artist)}</p>
          <div id="torrentStatus"></div>
        </div>
      </div>
      <div class="tracklist">
        <div class="track-header">
          <span>#</span><span>Title</span><span>Status</span><span>Duration</span>
        </div>
        ${album.tracks.map((track, i) => `
          <div class="track-row ${i === state.currentTrackIndex ? 'active' : ''}" data-track-index="${i}">
            <span class="track-num">${i + 1}</span>
            <span class="track-title-cell">${escHtml(track.title)}</span>
            <span class="track-status-cell" id="trackStatus${i}">
              ${i === state.currentTrackIndex && state.torrentResolving ? '<span class="status-tag resolving"><span class="spinner"></span> Resolving</span>' :
      i === state.currentTrackIndex && state.currentStreamId ? '<span class="status-tag streaming">Streaming</span>' :
        i === state.currentTrackIndex && state.torrentData?.torrents?.length > 0 ? '<span class="status-tag ready">Ready</span>' :
          i === state.currentTrackIndex && state.torrentError ? '<span class="status-tag error" title="' + escHtml(state.torrentError) + '">⚠</span>' :
            '<span class="status-tag queued">Queued</span>'}
            </span>
            <span class="track-duration">${formatDuration(track.duration || 0)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Back button
  $('#backToLibrary')?.addEventListener('click', () => {
    state.view = 'library';
    $$('.nav-btn')[0].classList.add('active');
    $$('.nav-btn')[1].classList.remove('active');
    loadLibrary();
    stopPlayback();
  });

  // Track click handlers
  $$('.track-row').forEach(row => {
    row.addEventListener('click', async () => {
      const idx = parseInt(row.dataset.trackIndex);
      if (idx !== state.currentTrackIndex) {
        state.currentTrackIndex = idx;
        state.torrentResolving = false;
        renderAlbumView();

        // For magnet-pasted albums, just switch the file index
        // (all tracks are in the same torrent)
        if (state.currentStreamId && state.currentAlbum?.tracks?.[idx]?._fileIndex !== undefined) {
          switchToFileIndex(idx);
        } else {
          // Normal library album — resolve torrent and play
          state.torrentData = null;
          state.torrentError = null;
          state.torrentResolving = true;
          renderAlbumView();
          await resolveAndPlayTrack(idx);
        }
      }
    });
  });

  updatePlayerDisplay();
  playerBar.style.display = 'flex';
}

function updateTorrentStatus() {
  const el = $('#torrentStatus');
  if (!el) return;

  if (state.torrentResolving) {
    el.innerHTML = '<span class="torrent-badge loading"><span class="spinner"></span> Finding torrents on P2P network...</span>';
  } else if (state.torrentError) {
    el.innerHTML = `<span class="torrent-badge error">⚠ ${escHtml(state.torrentError)}</span>`;
  } else if (state.torrentData?.torrents?.length > 0) {
    const t = state.torrentData.torrents[0];
    el.innerHTML = `<span class="torrent-badge success">⚡ ${t.seeders} seeders • ${t.quality || 'MP3'} • ${t.source || 'P2P'}</span>`;
  }
}

async function resolveAndPlayTrack(trackIndex) {
  const album = state.currentAlbum;
  if (!album) return;

  const track = album.tracks[trackIndex];
  if (!track) return;

  state.torrentResolving = true;
  state.torrentError = null;
  state.torrentData = null;
  updateTorrentStatus();

  try {
    const data = await api('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({
        artist: album.artist,
        track: track.title,
        album: album.title
      })
    });

    state.torrentData = data;
    state.torrentResolving = false;

    if (data.torrents && data.torrents.length > 0) {
      const magnet = data.torrents[0].magnet;
      state.currentMagnet = magnet;
      await startStreaming(magnet, album.title, track.title);

      // Pre-buffer next tracks
      prebufferNextTracks(trackIndex);
    } else {
      state.torrentError = 'No seeders found. Try pasting a magnet link for this album (click 🧲).';
    }
  } catch (err) {
    state.torrentResolving = false;
    state.torrentError = err.message;
  }

  updateTorrentStatus();
  renderAlbumView();
}

async function startStreaming(magnet, albumTitle, trackTitle) {
  try {
    const data = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ magnet, targetTrackTitle: trackTitle || '' })
    });

    state.currentStreamId = data.streamId;

    // Use the audioIndex from the backend to pick the right file
    const targetIndex = data.audioIndex !== undefined ? data.audioIndex : 0;
    const audioUrl = `/api/torrent/${data.streamId}/file/${targetIndex}`;

    // CRITICAL: Wait for the browser to receive the first chunk of data
    // before calling .play(). HTML5 <audio> needs to negotiate the HTTP Range
    // request with the torrent-stream backend first.
    audio.src = audioUrl;

    audio.oncanplay = () => {
      audio.play().catch(e => {
        console.warn('Playback prevented (autoplay policy):', e.message);
        state.isPlaying = false;
      });
      state.isPlaying = true;
      audio.oncanplay = null;
      updatePlayButton();
    };

    audio.onerror = () => {
      // Already handled by the global error listener
      audio.oncanplay = null;
    };

    audio.load();

    updatePlayerDisplay();
    renderAlbumView();
  } catch (err) {
    state.torrentError = 'Failed to start stream: ' + err.message;
    state.torrentResolving = false;
    updateTorrentStatus();
  }
}

async function prebufferNextTracks(currentIdx) {
  const album = state.currentAlbum;
  if (!album) return;

  const nextTracks = album.tracks.slice(currentIdx + 1, currentIdx + 3);
  if (nextTracks.length === 0) return;

  const magnets = [];
  for (const track of nextTracks) {
    try {
      const data = await api('/api/resolve', {
        method: 'POST',
        body: JSON.stringify({
          artist: album.artist,
          track: track.title,
          album: album.title
        })
      });
      if (data.torrents?.[0]?.magnet) {
        magnets.push(data.torrents[0].magnet);
      }
    } catch { /* skip failed resolutions */ }
  }

  if (magnets.length > 0) {
    try {
      await api('/api/prebuffer', {
        method: 'POST',
        body: JSON.stringify({ magnets })
      });
      console.log(`⏳ Prebuffered ${magnets.length} tracks`);
    } catch { /* prebuffer is best-effort */ }
  }
}

function stopPlayback() {
  audio.pause();
  audio.src = '';
  state.isPlaying = false;
  state.currentStreamId = null;
  state.currentMagnet = null;
  state.currentAlbum = null;
  playerBar.style.display = 'none';
  updatePlayButton();
}

// ─── PLAYER CONTROLS ───
function setupPlayerControls() {
  playBtn.addEventListener('click', togglePlay);
  prevBtn.addEventListener('click', prevTrack);
  nextBtn.addEventListener('click', nextTrack);
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('ended', onTrackEnded);
  audio.addEventListener('loadedmetadata', () => {
    totalTimeEl.textContent = formatDuration(audio.duration || 0);
  });
  audio.addEventListener('play', () => { state.isPlaying = true; updatePlayButton(); });
  audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayButton(); });
  audio.addEventListener('error', async () => {
    // If the torrent is still downloading metadata, retry after a delay
    if (state.currentStreamId && audio.src && audio.src.includes('/api/torrent/')) {
      console.log('Audio error - torrent may still be fetching metadata, retrying...');
      state.torrentError = 'Downloading torrent metadata from peers...';
      updateTorrentStatus();

      // Retry up to 5 times with 2 second delays
      for (let retry = 0; retry < 5; retry++) {
        await new Promise(r => setTimeout(r, 2000));
        const currentSrc = audio.src;
        audio.src = '';
        audio.src = currentSrc;
        audio.load();
        try {
          await audio.play();
          state.torrentError = null;
          updateTorrentStatus();
          return; // Success!
        } catch (e) {
          console.log(`Retry ${retry + 1}/5 failed: ${e.message}`);
        }
      }
      state.torrentError = 'No peers found. Try a magnet with more seeders.';
    } else {
      state.torrentError = 'Audio playback error - torrent may not have enough seeders';
    }
    updateTorrentStatus();
  });

  // Progress bar click
  progressBar.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });
}

function togglePlay() {
  if (!state.currentAlbum) return;

  if (state.isPlaying) {
    audio.pause();
  } else {
    // If no stream yet, resolve and play
    if (!state.currentStreamId && state.currentMagnet) {
      const album = state.currentAlbum;
      const track = album?.tracks?.[state.currentTrackIndex];
      startStreaming(state.currentMagnet, album?.title, track?.title).then(() => {
        audio.play().catch(() => { });
      });
    } else if (audio.src) {
      audio.play().catch(err => {
        console.error('Playback failed:', err);
        state.torrentError = 'Cannot play - torrent may still be downloading';
        updateTorrentStatus();
      });
    } else {
      // First time playing - resolve
      resolveAndPlayTrack(state.currentTrackIndex);
    }
  }
}

async function prevTrack() {
  if (!state.currentAlbum) return;
  if (state.currentTrackIndex > 0) {
    state.currentTrackIndex--;
    // For magnet albums, just switch file index (all tracks in same torrent)
    if (state.currentStreamId && state.currentAlbum?.tracks?.[state.currentTrackIndex]?._fileIndex !== undefined) {
      switchToFileIndex(state.currentTrackIndex);
    } else {
      state.torrentData = null;
      state.torrentError = null;
      state.torrentResolving = true;
      renderAlbumView();
      await resolveAndPlayTrack(state.currentTrackIndex);
    }
  }
}

async function nextTrack() {
  if (!state.currentAlbum) return;
  const album = state.currentAlbum;
  if (state.currentTrackIndex < album.tracks.length - 1) {
    state.currentTrackIndex++;
    // For magnet albums, just switch file index
    if (state.currentStreamId && state.currentAlbum?.tracks?.[state.currentTrackIndex]?._fileIndex !== undefined) {
      switchToFileIndex(state.currentTrackIndex);
    } else {
      state.torrentData = null;
      state.torrentError = null;
      state.torrentResolving = true;
      renderAlbumView();
      await resolveAndPlayTrack(state.currentTrackIndex);
    }
  } else {
    stopPlayback();
  }
}

/** Helper: switch audio to a different file index within the same torrent */
function switchToFileIndex(trackIndex) {
  const track = state.currentAlbum.tracks[trackIndex];
  if (!track || track._fileIndex === undefined) return;

  const fileIdx = track._fileIndex;
  const audioUrl = `/api/torrent/${state.currentStreamId}/file/${fileIdx}`;
  audio.src = audioUrl;
  audio.load();
  audio.play().then(() => {
    state.isPlaying = true;
    updatePlayButton();
  }).catch(e => console.warn('Play pending:', e.message));
  updatePlayerDisplay();
  renderAlbumView();
}

function onTrackEnded() {
  nextTrack();
}

function updateProgress() {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = pct + '%';
  currentTimeEl.textContent = formatDuration(audio.currentTime);
}

function updatePlayButton() {
  playBtn.textContent = state.isPlaying ? '⏸' : '▶';
}

function updatePlayerDisplay() {
  const album = state.currentAlbum;
  if (!album) return;

  const track = album.tracks[state.currentTrackIndex];
  $('#playerTitle').textContent = track?.title || '';
  $('#playerArtist').textContent = album.artist || '';
  totalTimeEl.textContent = formatDuration(track?.duration || 0);
  currentTimeEl.textContent = '0:00';
  progressFill.style.width = '0%';

  prevBtn.disabled = state.currentTrackIndex === 0;
  nextBtn.disabled = state.currentTrackIndex >= (album.tracks?.length || 1) - 1;

  playerBar.style.display = 'flex';
  updatePlayButton();
}

// ─── SEARCH ───
function setupSearch() {
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

async function doSearch() {
  const q = searchInput.value.trim();
  if (q.length < 2) return;

  state.view = 'search';
  state.searchLoading = true;
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  $$('.nav-btn')[1].classList.add('active');

  contentArea.innerHTML = `
    <div class="search-results">
      <h2 class="view-title">Searching for "${escHtml(q)}"...</h2>
      <div class="empty-state"><span class="spinner" style="width:32px;height:32px;border-width:3px;"></span></div>
    </div>
  `;

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&type=album`);
    state.searchResults = data.results || [];
    state.searchLoading = false;
    renderSearchResults(q);
  } catch (err) {
    state.searchLoading = false;
    contentArea.innerHTML = `
      <div class="search-results">
        <h2 class="view-title">Search Results</h2>
        <div class="empty-state"><span class="icon">⚠</span><p>Search failed: ${escHtml(err.message)}</p></div>
      </div>
    `;
  }
}

function showSearchView() {
  state.view = 'search';
  contentArea.innerHTML = `
    <div class="search-results">
      <h2 class="view-title">Search Music</h2>
      <div class="empty-state">
        <span class="icon">🔍</span>
        <p>Type an artist or album name above to search the P2P network</p>
        <p style="font-size:13px;color:var(--text-muted)">Searches local database and MusicBrainz</p>
      </div>
    </div>
  `;
}

function renderSearchResults(q) {
  if (state.searchResults.length === 0) {
    contentArea.innerHTML = `
      <div class="search-results">
        <h2 class="view-title">Results for "${escHtml(q)}"</h2>
        <div class="empty-state"><span class="icon">🔍</span><p>No results found. Try a different search.</p></div>
      </div>
    `;
    return;
  }

  window._searchResults = state.searchResults;

  contentArea.innerHTML = `
    <div class="search-results">
      <h2 class="view-title">Results for "${escHtml(q)}"</h2>
      <div class="discover-grid">
        ${state.searchResults.map((r, i) => `
          <div class="album-card" data-result-index="${i}">
            <div class="album-art">
              ${r.coverUrl
      ? `<img src="${escHtml(r.coverUrl)}" alt="${escHtml(r.title)}" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='💿'" />`
      : '💿'}
            </div>
            <h3>${escHtml(r.title)}</h3>
            <p>${escHtml(r.artist)}</p>
            ${r.year ? `<span class="album-year">${r.year}</span>` : ''}
            ${r.source === 'musicbrainz' ? '<span style="font-size:10px;color:var(--accent-light)">🎵 MusicBrainz</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  $$('.album-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.resultIndex);
      const result = window._searchResults[idx];
      if (!result) return;
      // Open as a discovered album (fetches tracklist + resolves torrents)
      openDiscoveredAlbum({
        id: result.id,
        title: result.title,
        artist: result.artist,
        year: result.year,
        coverUrl: result.coverUrl,
        trackCount: result.track_count || 0
      });
    });
  });
}

// ─── MAGNET PASTE ───
function setupMagnetPaste() {
  pasteMagnetBtn.addEventListener('click', handleMagnetPaste);
  pasteMagnetBtn.title = 'Stream from Magnet Link';

  // Also detect magnet links pasted in search
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    if (val.startsWith('magnet:?xt=urn:btih:')) {
      pasteMagnetBtn.style.color = 'var(--accent-light)';
    } else {
      pasteMagnetBtn.style.color = 'var(--text-muted)';
    }
  });
}

async function handleMagnetPaste() {
  let magnet = searchInput.value.trim();

  // If the search bar doesn't have a magnet, try clipboard
  if (!magnet.startsWith('magnet:?xt=urn:btih:')) {
    try {
      magnet = await navigator.clipboard.readText();
    } catch {
      magnet = prompt('Paste your magnet link here:') || '';
    }
  }

  if (!magnet.startsWith('magnet:?xt=urn:btih:')) {
    alert('Please enter a valid magnet link (starts with magnet:?xt=urn:btih:)');
    return;
  }

  state.currentMagnet = magnet;
  state.view = 'album';
  $$('.nav-btn').forEach(b => b.classList.remove('active'));

  // Show loading screen while we connect
  contentArea.innerHTML = `
    <div class="album-detail">
      <button class="back-btn" id="backToLibrary">← Back to Library</button>
      <div class="album-hero">
        <div class="album-art-large">🧲</div>
        <div class="album-meta">
          <h2>Connecting to Swarm...</h2>
          <p class="artist-name">Loading torrent metadata from peers</p>
          <div id="torrentStatus">
            <span class="torrent-badge loading"><span class="spinner"></span> Connecting to swarm...</span>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#backToLibrary')?.addEventListener('click', () => {
    state.view = 'library';
    $$('.nav-btn')[0].classList.add('active');
    $$('.nav-btn')[1].classList.remove('active');
    loadLibrary();
    stopPlayback();
  });

  playerBar.style.display = 'flex';
  $('#playerTitle').textContent = 'Connecting...';
  $('#playerArtist').textContent = 'P2P Network';
  updatePlayButton();

  state.torrentResolving = true;

  try {
    // Start the stream — this returns all file names + the detected audio index
    const data = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ magnet })
    });

    state.currentStreamId = data.streamId;
    state.torrentResolving = false;

    // Filter to audio files only, preserving their original torrent file index
    const audioExts = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus'];
    const audioTracks = [];
    for (let i = 0; i < (data.files || []).length; i++) {
      const name = data.files[i];
      if (audioExts.some(ext => name.toLowerCase().endsWith(ext))) {
        // Strip extension for display title
        let title = name.replace(/\.(mp3|flac|m4a|ogg|wav|aac|opus)$/i, '');
        audioTracks.push({
          id: `file-${i}`,
          title: title,
          duration: 0,
          _fileIndex: i // ORIGINAL index in the full torrent file list
        });
      }
    }

    // Create a temporary album from the torrent contents
    const tempAlbum = {
      id: 'magnet-' + Date.now(),
      title: data.torrent || 'External Torrent Stream',
      artist: 'P2P Network',
      year: new Date().getFullYear(),
      tracks: audioTracks.length > 0 ? audioTracks : [{
        id: 'mt-1',
        title: 'Streaming from Magnet',
        duration: 0,
        _fileIndex: data.audioIndex || 0
      }]
    };

    state.currentAlbum = tempAlbum;
    state.currentTrackIndex = data.audioIndex || 0;
    state.torrentData = {
      torrents: [{ seeders: data.peerCount || 0, quality: 'P2P', source: 'Magnet Link' }]
    };

    // Build the audio URL from the detected or first audio index
    const targetIndex = data.audioIndex !== undefined ? data.audioIndex : 0;
    const audioUrl = `/api/torrent/${data.streamId}/file/${targetIndex}`;
    audio.src = audioUrl;
    audio.load();

    try {
      await audio.play();
      state.isPlaying = true;
      console.log('▶ Playback started:', data.torrent, 'file index:', targetIndex);
    } catch (e) {
      console.warn('Play pending user interaction:', e.message);
      state.isPlaying = false;
    }

    updatePlayButton();
    renderAlbumView();
    updatePlayerDisplay();

  } catch (err) {
    state.torrentResolving = false;
    state.torrentError = err.message;
    console.error('Magnet paste error:', err);
    updateTorrentStatus();

    contentArea.innerHTML = `
      <div class="album-detail">
        <button class="back-btn" id="backToLibrary">← Back to Library</button>
        <div class="album-hero">
          <div class="album-art-large">⚠</div>
          <div class="album-meta">
            <h2>Connection Failed</h2>
            <p class="artist-name">${escHtml(err.message)}</p>
            <div id="torrentStatus">
              <span class="torrent-badge error">⚠ ${escHtml(err.message)}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    $('#backToLibrary')?.addEventListener('click', () => {
      state.view = 'library';
      $$('.nav-btn')[0].classList.add('active');
      loadLibrary();
      stopPlayback();
    });
  }
}

// ─── UTILITIES ───
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── STARTUP ───
document.addEventListener('DOMContentLoaded', init);
