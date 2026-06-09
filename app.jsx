/**
 * SonicSwarm Main Application
 * Full-featured P2P music streaming interface
 */

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Search, Music, Disc, Radio, Sliders, HardDrive, Users, Zap, AlertCircle, Loader, Volume2, Clock, Clipboard, ChevronDown, ChevronUp, Square, Compass, PlusCircle, CheckCircle, X, Trash2 } from 'lucide-react';
import { useSonicSwarm } from './SonicSwarmContext';
import './App.css';

// ─────────────────────────────────────────────────────────
// DEMO LIBRARY (fallback when user library is empty)
// ─────────────────────────────────────────────────────────

const DEMO_LIBRARY = [
  {
    id: 'album-1',
    title: 'Midnight Dreams',
    artist: 'Synthetic Minds',
    year: 2023,
    tracks: [
      { id: 't1', title: 'Awakening', duration: '3:42' },
      { id: 't2', title: 'Binary Sunset', duration: '4:15' },
      { id: 't3', title: 'Quantum Loop', duration: '2:58' },
      { id: 't4', title: 'Infinite Echo', duration: '5:12' }
    ]
  },
  {
    id: 'album-2',
    title: 'Neural Networks',
    artist: 'Cyber Collective',
    year: 2023,
    tracks: [
      { id: 't5', title: 'Connection', duration: '4:00' },
      { id: 't6', title: 'Signal', duration: '3:30' },
      { id: 't7', title: 'Resonance', duration: '4:45' }
    ]
  }
];

// ─────────────────────────────────────────────────────────
// DISCOVER CATALOG VIEW (Global MusicBrainz search wall)
// ─────────────────────────────────────────────────────────

function DiscoverCatalogView({ onSelectAlbum, onAddToLibrary, isInLibrary, searchQuery, setSearchQuery, searchResults, searchLoading, searchError, handleSearch }) {

  // Clean "Start Screen" if the user hasn't searched yet
  if (!searchQuery && searchResults.length === 0) {
    return (
      <div className="discover-view">
        <div className="discover-hero">
          <h2>🌐 The Global P2P Catalog</h2>
          <p>Search any artist, album, or track. SonicSwarm dynamically aggregates decentralized swarm streams on demand.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="discover-view">
      <h2 className="view-title">Search Results for "{searchQuery}"</h2>

      {searchLoading && (
        <div className="loading">
          <Loader size={24} className="spinning" />
          <span>Searching global metadata index...</span>
        </div>
      )}

      {searchError && (
        <div className="error-badge" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <span>{searchError}</span>
        </div>
      )}

      {!searchLoading && searchResults.length === 0 && searchQuery && (
        <div className="empty">
          <AlertCircle size={16} />
          <span>No catalog matches found.</span>
        </div>
      )}

      <div className="album-grid">
        {searchResults.map((result, idx) => (
          <div key={idx} className="album-card" onClick={() => onSelectAlbum(result)}>
            <div className="album-art">
              {result.coverUrl ? (
                <img src={result.coverUrl} alt={result.title} />
              ) : (
                <Disc size={64} />
              )}
            </div>
            <h3>{result.title}</h3>
            <p>{result.artist}</p>
            {result.year && <span className="year">{result.year}</span>}
            <button
              className={`library-add-btn${isInLibrary?.(result.id) ? ' in-library' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!isInLibrary?.(result.id)) onAddToLibrary(result);
              }}
              title={isInLibrary?.(result.id) ? 'Already in Library' : 'Add to Library'}
              disabled={isInLibrary?.(result.id)}
            >
              {isInLibrary?.(result.id)
                ? <><CheckCircle size={14} /> In Library</>
                : <><PlusCircle size={14} /> Add</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SOURCE PICKER DRAWER (Stremio/Torrentio Style)
// ─────────────────────────────────────────────────────────

function SourcePickerDrawer({ track, album, inspectingTrackId, setInspectingTrackId, handlePlaySource }) {
  const { fetchSources, currentSources, sourcesLoading } = useSonicSwarm();

  const isInspecting = inspectingTrackId === track.id;

  // Auto-trigger the scraper when the drawer opens
  useEffect(() => {
    if (isInspecting) {
      fetchSources(album.artist, album.title, track.title, album.id);
    }
  }, [isInspecting, album, track, fetchSources]);

  if (!isInspecting) return null;

  return (
    <div className="source-selector-drawer">
      <div className="drawer-header">
        <Radio size={14} className="pulse-icon" />
        <span>Aggregated Swarm Streams</span>
        <button
          className="close-drawer-btn"
          onClick={(e) => {
            e.stopPropagation();
            setInspectingTrackId(null);
          }}
        >
          ✕
        </button>
      </div>

      {sourcesLoading ? (
        <div className="drawer-loading">
          <Loader size={16} className="spinning" />
          <span>Scraping distributed swarms...</span>
        </div>
      ) : currentSources.length === 0 ? (
        <div className="drawer-empty">
          <AlertCircle size={14} />
          <span>No direct source matches found. Try modifying metadata keywords.</span>
        </div>
      ) : (
        <div className="source-list">
          {currentSources.map((source, sIdx) => (
            <div
              key={sIdx}
              className="source-option-card"
              onClick={(e) => {
                e.stopPropagation();
                handlePlaySource(source);
              }}
            >
              <div className="source-badge-group">
                <span className={`badge type-badge ${source.type}`}>
                  {source.type === 'album_pack' ? '📦 Album Pack' : '🎵 Single Track'}
                </span>
                <span className="badge quality-badge">{source.quality}</span>
              </div>

              <div className="source-details">
                <p className="source-title">{source.fileName}</p>
                <span className="source-provider">via {source.source}</span>
              </div>

              <div className="source-stats">
                <Users size={14} />
                <span className="seeders-count">{source.seeders} seeds</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN APP COMPONENT
// ─────────────────────────────────────────────────────────

export default function App() {
  const sonicSwarm = useSonicSwarm();

  // UI State
  const [view, setView] = useState('library'); // 'library', 'search', 'album'
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [magnetPasteMessage, setMagnetPasteMessage] = useState('');
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(true); // Mini-player expanded/minimized

  // Playback State
  const [currentAlbum, setCurrentAlbum] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Torrent Resolution
  const [currentTorrentData, setCurrentTorrentData] = useState(null);
  const [torrentLoading, setTorrentLoading] = useState(false);
  const [torrentError, setTorrentError] = useState(null);

  // Source Picker (Stremio-style)
  const [inspectingTrackId, setInspectingTrackId] = useState(null);

  // Sticky source preferences for auto-advance (quality, infoHash, source)
  const [activeSourcePreferences, setActiveSourcePreferences] = useState({
    infoHash: null,
    quality: null,
    sourceName: null
  });

  // Audio Element
  const audioRef = useRef(null);
  const magnetInputRef = useRef(null);

  // Ref to suppress the torrent-resolution effect during same-torrent skips
  const isIntraTorrentSkip = useRef(false);

  // Calculate the active stream URL in the render pass so it stays in sync
  const currentStreamUrl = sonicSwarm.getFileStreamUrl(sonicSwarm.currentAudioIndex || 0);

  // ─────────────────────────────────────────────────────────
  // MAGNET PASTE HANDLER
  // ─────────────────────────────────────────────────────────

  /**
   * Handle pasting a magnet link directly
   * Creates a temporary album from the torrent contents if no album is loaded
   */
  const handleMagnetPaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();

      // Check if it's a valid magnet link
      if (!clipboardText.includes('magnet:?')) {
        setMagnetPasteMessage('❌ No magnet link in clipboard');
        setTimeout(() => setMagnetPasteMessage(''), 3000);
        return;
      }

      setMagnetPasteMessage('⏳ Connecting to P2P swarm...');
      setTorrentLoading(true);
      setTorrentError(null);
      setView('album');

      // Start streaming — backend returns file list + audioIndex
      const streamData = await sonicSwarm.startStream(clipboardText, null);

      // Build a temporary album from the torrent's audio files
      const audioExts = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus'];
      const audioTracks = (streamData.files || [])
        .map((name, i) => ({ name, index: i }))
        .filter(f => audioExts.some(ext => f.name.toLowerCase().endsWith(ext)))
        .map(f => ({
          id: `magnet-${f.index}`,
          title: f.name.replace(/\.(mp3|flac|m4a|ogg|wav|aac|opus)$/i, ''),
          duration: '0:00',
          _fileIndex: f.index
        }));

      const tempAlbum = {
        id: 'magnet-' + Date.now(),
        title: streamData.torrent || 'External Torrent',
        artist: 'P2P Network',
        year: new Date().getFullYear(),
        tracks: audioTracks.length > 0 ? audioTracks : [{
          id: 'mt-default',
          title: 'Streaming from Magnet',
          duration: '0:00',
          _fileIndex: streamData.audioIndex || 0
        }]
      };

      setCurrentAlbum(tempAlbum);
      setCurrentTrackIndex(0);
      setCurrentTorrentData({
        torrents: [{ seeders: streamData.peerCount || 0, quality: 'P2P', source: 'Magnet Link' }]
      });
      setTorrentLoading(false);
      setIsPlaying(true);
      setInspectingTrackId(null);

      // Let the audio stream change effect handle playback via oncanplay
      setMagnetPasteMessage('✅ Connected — buffering...');
    } catch (err) {
      console.error('Magnet paste failed:', err);
      setMagnetPasteMessage('❌ ' + (err.message || 'Failed to connect'));
      setTimeout(() => setMagnetPasteMessage(''), 5000);
      setTorrentLoading(false);
      setTorrentError(err.message || 'Failed to connect to swarm');
    }
  };

  // ─────────────────────────────────────────────────────────
  // SOURCE PICKER LOGIC (Stremio/Torrentio Pattern)
  // ─────────────────────────────────────────────────────────

  /**
   * Handles Stremio-style track inspection and scraping
   */
  const handleTrackClick = async (track, album) => {
    // Toggle the source drawer — SourcePickerDrawer auto-fetches via useEffect
    setInspectingTrackId(inspectingTrackId === track.id ? null : track.id);
  };

  /**
   * Fires off the actual P2P streaming pipeline with targetTrackTitle targeting
   */
  const handlePlaySource = async (source, track, trackIndex) => {
    try {
      // Extract infoHash from magnet to track multi-file album torrents
      const match = source.magnet.match(/btih:([a-zA-Z0-9]+)/);
      const infoHash = match ? match[1].toLowerCase() : null;

      // Save the sticky preference profile for auto-advance
      setActiveSourcePreferences({
        infoHash,
        quality: source.quality,
        sourceName: source.source
      });

      // 1. Tell backend to download the torrent and find the exact file index for this track title
      await sonicSwarm.startStream(source.magnet, track.title);

      // 2. Align our local track view state to the row index that was clicked
      setCurrentTrackIndex(trackIndex);

      // 3. Force audio state alive — the stream change effect handles oncanplay
      setIsPlaying(true);
      setInspectingTrackId(null);

    } catch (err) {
      console.error("Failed to boot up audio swarm stream:", err);
    }
  };

  // ─────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────

  /**
   * Auto-fetch discovery data when user navigates to Discover tab
   */
  useEffect(() => {
    if (view === 'discover' && sonicSwarm.discoveryData.albums.length === 0 && sonicSwarm.discoveryData.singles.length === 0) {
      sonicSwarm.fetchDiscovery();
    }
  }, [view, sonicSwarm.fetchDiscovery]);

  /**
 * When stream changes, wire up the audio element and wait for
 * the browser to receive the first chunk before calling .play()
 */
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    if (sonicSwarm.currentStreamId) {
      // Wire oncanplay to fire only once per stream change
      const onCanPlay = () => {
        if (isPlaying) {
          audio.play().catch(e => console.warn('Playback deferred:', e.message));
        }
        audio.removeEventListener('canplay', onCanPlay);
      };
      audio.addEventListener('canplay', onCanPlay);

      audio.load();

      return () => {
        audio.removeEventListener('canplay', onCanPlay);
      };
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [sonicSwarm.currentStreamId, sonicSwarm.currentAudioIndex, isPlaying]);

  /**
   * When track changes, resolve torrent magnets.
   * Does NOT auto-stream — user clicks play or picks a source.
   */
  useEffect(() => {
    if (!currentAlbum) return;

    const track = currentAlbum.tracks[currentTrackIndex];
    if (!track) return;

    // Skip resolution when jumping within the same multi-track torrent
    if (isIntraTorrentSkip.current) {
      isIntraTorrentSkip.current = false;
      return;
    }

    // Skip resolution for magnet-pasted albums (they already have a stream)
    if (track._fileIndex !== undefined && sonicSwarm.currentStreamId) return;

    setTorrentLoading(true);
    setTorrentError(null);
    setCurrentTorrentData(null);

    const resolveTorrent = async () => {
      try {
        const data = await sonicSwarm.resolveTorrent(
          currentAlbum.artist,
          track.title,
          currentAlbum.title,
          currentAlbum.id   // iTunes ID — enables ⚡ fast-path index lookup
        );

        setCurrentTorrentData(data);

        if (!data.torrents || data.torrents.length === 0) {
          setTorrentError('⚠️ No torrents found. Paste a magnet link or try different search terms.');
        }
      } catch (error) {
        console.error('Torrent resolution failed:', error);
        setTorrentError(error.message || 'Failed to find torrents. Try pasting a magnet link.');
      } finally {
        setTorrentLoading(false);
      }
    };

    resolveTorrent();
  }, [currentAlbum, currentTrackIndex, sonicSwarm]);

  /**
   * Handle audio playback events
   */
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const current = audioRef.current.currentTime;
      const duration = audioRef.current.duration;

      setCurrentTime(current);
      if (duration > 0) {
        setPlaybackProgress((current / duration) * 100);
      }
    }
  };

  /**
   * handleEnded — Auto-advance to next track when current finishes.
   * Delegates to executeTrackChange for the shared skip/advance logic.
   */
  const handleEnded = async () => {
    if (!currentAlbum || currentTrackIndex >= currentAlbum.tracks.length - 1) {
      setIsPlaying(false);
      sonicSwarm.setStreamStatus('idle');
      return;
    }

    const nextIndex = currentTrackIndex + 1;
    executeTrackChange(nextIndex);
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;

    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = percentage * audioRef.current.duration;
    }
  };

  // ─────────────────────────────────────────────────────────
  // PLAYBACK CONTROLS
  // ─────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        console.error('Playback failed:', err);
        setTorrentError('Failed to play audio');
      });
    }

    setIsPlaying(!isPlaying);
  };

  /**
   * handleStop — Kill all audio, purge stream state, clear Now Playing.
   * Returns the user to the library view with everything reset.
   */
  const handleStop = () => {
    // Kill audio hardware immediately
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    // Wipe all playback state
    setIsPlaying(false);
    setPlaybackProgress(0);
    setCurrentTime(0);
    setCurrentAlbum(null);
    setCurrentTrackIndex(0);
    setCurrentTorrentData(null);
    setTorrentError(null);
    setInspectingTrackId(null);
    setActiveSourcePreferences({ infoHash: null, quality: null, sourceName: null });

    // Purge backend stream context
    sonicSwarm.resetPlayback();
  };

  /**
   * executeTrackChange — Shared logic for auto-advance AND manual skips.
   * Strategy 1: Jump within the SAME multi-track torrent (no new connections).
   * Strategy 2: Fetch & rank fresh sources, then start a new stream.
   */
  const executeTrackChange = async (index) => {
    if (!currentAlbum) return;

    const track = currentAlbum.tracks[index];
    if (!track) return;

    // Pause current playback — DO NOT remove src or call load(), React handles remount
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setCurrentTrackIndex(index);
    setPlaybackProgress(0);
    sonicSwarm.setStreamStatus('resolving');

    try {
      // ── Strategy 1: Jump within the SAME multi-track torrent ──
      if (activeSourcePreferences.infoHash && sonicSwarm.currentTorrentFiles?.length > 0) {
        // Smarter matching: strip special characters to find the right track
        const cleanTrackTitle = track.title.toLowerCase().replace(/[^a-z0-9]/g, '');

        const fileMatchIndex = sonicSwarm.currentTorrentFiles.findIndex(fileName => {
          const cleanFileName = fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanFileName.includes(cleanTrackTitle);
        });

        if (fileMatchIndex !== -1) {
          console.log(`[SKIP] Found "${track.title}" in active torrent at file index: ${fileMatchIndex}`);

          // Signal the torrent-resolution effect to skip (same torrent, no new fetch needed)
          isIntraTorrentSkip.current = true;

          // State-only approach: React remounts <audio key={streamId-audioIndex}>
          // and the useEffect handles canplay → play() lifecycle
          sonicSwarm.setCurrentAudioIndex(fileMatchIndex);
          sonicSwarm.setStreamStatus('streaming');
          setIsPlaying(true);
          return;
        }
      }

      // ── Strategy 2: Not in current torrent — fetch new sources ──
      console.log(`[SKIP] Searching new swarms for: ${track.title}`);
      sonicSwarm.resetPlayback(); // Purge old torrent context before fetching

      const response = await fetch('http://localhost:9191/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: currentAlbum.artist,
          album: currentAlbum.title,
          track: track.title
        })
      }).then(res => res.json());

      const sources = response.sources || [];
      if (sources.length === 0) {
        throw new Error("No sources found for this track.");
      }

      // Rank by quality preference first, then by seeders
      const sortedSources = [...sources].sort((a, b) => {
        const aQualityMatch = a.quality === activeSourcePreferences.quality ? 1 : 0;
        const bQualityMatch = b.quality === activeSourcePreferences.quality ? 1 : 0;
        if (aQualityMatch !== bQualityMatch) return bQualityMatch - aQualityMatch;
        return (b.seeders || 0) - (a.seeders || 0);
      });

      const bestSource = sortedSources[0];
      console.log(`[SKIP] Engaging swarm: ${bestSource.fileName}`);

      // Update sticky preferences
      const match = bestSource.magnet?.match(/btih:([a-zA-Z0-9]+)/);
      setActiveSourcePreferences({
        infoHash: match ? match[1].toLowerCase() : null,
        quality: bestSource.quality,
        sourceName: bestSource.source
      });

      // Pass track.title so backend resolves the correct internal file index
      await sonicSwarm.startStream(bestSource.magnet, track.title);
      setIsPlaying(true);

    } catch (error) {
      console.error('[SKIP] Failed:', error.message);
      sonicSwarm.setStreamStatus('error');
    }
  };

  /**
   * handleSkip — Triggered by Next/Prev buttons.
   */
  const handleSkip = (direction) => {
    if (!currentAlbum) return;

    let nextIndex = direction === 'next'
      ? currentTrackIndex + 1
      : currentTrackIndex - 1;

    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= currentAlbum.tracks.length) return;

    executeTrackChange(nextIndex);
  };

  const handleSelectTrack = (index) => {
    setCurrentTrackIndex(index);
    setPlaybackProgress(0);

    // Only sync if we KNOW the exact torrent file index (magnet-pasted albums).
    // Never guess — let the scraper/backend dictate the correct index.
    const track = currentAlbum.tracks[index];
    if (track && track._fileIndex !== undefined) {
      sonicSwarm.setCurrentAudioIndex(track._fileIndex);
    }
  };

  // ─────────────────────────────────────────────────────────
  // ALBUM & LIBRARY NAVIGATION
  // ─────────────────────────────────────────────────────────

  const handlePlayAlbum = async (album) => {
    // If the album has no tracks (e.g. from iTunes search), fetch them on-demand
    if (!album.tracks || album.tracks.length === 0) {
      try {
        const response = await fetch(`http://localhost:9191/api/album/${album.id}/tracks`);
        const data = await response.json();
        if (data.tracks && data.tracks.length > 0) {
          // Map track format to what the UI expects
          album = {
            ...album,
            tracks: data.tracks.map(t => ({
              id: String(t.id),
              title: t.title,
              duration: t.duration_formatted || formatTime(t.duration),
              _fileIndex: undefined  // Will be resolved by torrent scraper
            }))
          };
        } else {
          // Fallback: generate placeholder tracks from track_count
          const count = album.track_count || album.trackCount || 5;
          album = {
            ...album,
            tracks: Array.from({ length: count }, (_, i) => ({
              id: `${album.id}-t${i + 1}`,
              title: `Track ${i + 1}`,
              duration: '0:00',
              _fileIndex: undefined
            }))
          };
        }
      } catch (err) {
        console.error('Failed to fetch album tracks:', err);
        const count = album.track_count || album.trackCount || 5;
        album = {
          ...album,
          tracks: Array.from({ length: count }, (_, i) => ({
            id: `${album.id}-t${i + 1}`,
            title: `Track ${i + 1}`,
            duration: '0:00',
            _fileIndex: undefined
          }))
        };
      }
    }

    // Force standardization: find the image whatever the API called it,
    // and assign it to BOTH keys so the UI can't miss it.
    const resolvedArt = album.artworkUrl600 || album.artworkUrl100 || album.artworkUrl || album.coverUrl || album.cover || album.cover_url;

    setCurrentAlbum({
      ...album,
      artworkUrl: resolvedArt,
      coverUrl: resolvedArt
    });
    setCurrentTrackIndex(0);
    setIsPlaying(false);
    setView('album');
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    await sonicSwarm.searchAlbums(searchQuery);
    setView('search');
  };

  // ─────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const parseDuration = (durationStr) => {
    const parts = durationStr.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  };

  // ─────────────────────────────────────────────────────────
  // RENDER VIEWS
  // ─────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img
            src="/sonicswarm_logo.png"
            alt="SonicSwarm Logo"
            className="brand-logo-img"
          />
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-button ${view === 'discover' ? 'active' : ''}`}
            onClick={() => setView('discover')}
          >
            <Compass size={18} />
            <span>Discover</span>
          </button>
          <button
            className={`nav-button ${view === 'library' ? 'active' : ''}`}
            onClick={() => setView('library')}
          >
            <Music size={18} />
            <span>Library</span>
          </button>
          <button
            className={`nav-button ${view === 'search' ? 'active' : ''}`}
            onClick={() => setView('search')}
          >
            <Search size={18} />
            <span>Search</span>
          </button>
        </nav>



        <div className="sidebar-footer">
          <div className="stats">
            <div className="stat">
              <HardDrive size={14} />
              <span>{sonicSwarm.swarmStats.activeTorrents} active</span>
            </div>
            <div className="stat">
              <Users size={14} />
              <span>{sonicSwarm.swarmStats.totalPeers} peers</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {/* HEADER */}
        <header className="header">
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search albums, artists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" title="Search">
              <Search size={18} />
            </button>
            <button
              type="button"
              className="magnet-paste-btn"
              onClick={handleMagnetPaste}
              title="Paste magnet link from clipboard"
            >
              <Clipboard size={18} />
            </button>
          </form>

          {magnetPasteMessage && (
            <div className="magnet-paste-message">
              {magnetPasteMessage}
            </div>
          )}

          <div className="header-stats">
            <span className="stat-item">
              {sonicSwarm.swarmStats.totalPeers} peers
            </span>
            <span className="stat-item">
              ↓ {sonicSwarm.swarmStats.totalDownloadSpeed} MB/s
            </span>
            <img
              src="/small_logo.png"
              alt="SonicSwarm Symbol"
              className="header-avatar-symbol"
            />
          </div>
        </header>

        {/* CONTENT AREA */}
        <div className="content">
          {/* Discover View — iTunes-powered popular charts */}
          {view === 'discover' && (
            <div className="discover-view">
              {sonicSwarm.discoveryLoading ? (
                <div className="loading">
                  <Loader size={24} className="spinning" />
                  <span>Loading popular charts...</span>
                </div>
              ) : sonicSwarm.discoveryError ? (
                <div className="error-badge" style={{ margin: '32px auto', width: 'fit-content' }}>
                  <AlertCircle size={16} />
                  <span>{sonicSwarm.discoveryError}</span>
                </div>
              ) : (
                <>
                  {/* Popular Albums Section */}
                  <section className="discover-section">
                    <h2 className="discover-section-title">
                      <Disc size={20} />
                      Popular Albums
                    </h2>
                    <div className="discover-album-grid">
                      {sonicSwarm.discoveryData.albums.map((album) => (
                        <div
                          key={album.id}
                          className="discover-album-card"
                          onClick={() => {
                            handlePlayAlbum(album);
                          }}
                        >
                          <div className="discover-album-art">
                            {album.cover ? (
                              <img src={album.cover} alt={album.title} loading="lazy" />
                            ) : (
                              <Disc size={64} />
                            )}
                          </div>
                          <div className="discover-album-info">
                            <h3 className="discover-album-title" title={album.title}>
                              {album.title}
                            </h3>
                            <p className="discover-album-artist" title={album.artist}>
                              {album.artist}
                            </p>
                            {album.year && (
                              <span className="discover-album-year">{album.year}</span>
                            )}
                          </div>
                          <button
                            className={`library-add-btn${sonicSwarm.isInLibrary(album.id) ? ' in-library' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!sonicSwarm.isInLibrary(album.id)) sonicSwarm.addToLibrary(album);
                            }}
                            title={sonicSwarm.isInLibrary(album.id) ? 'Already in Library' : 'Add to Library'}
                            disabled={sonicSwarm.isInLibrary(album.id)}
                          >
                            {sonicSwarm.isInLibrary(album.id)
                              ? <><CheckCircle size={16} /> In Library</>
                              : <><PlusCircle size={16} /> Add</>}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Popular Singles Section */}
                  <section className="discover-section">
                    <h2 className="discover-section-title">
                      <Radio size={20} />
                      Popular Singles
                    </h2>
                    <div className="discover-singles-grid">
                      {sonicSwarm.discoveryData.singles.map((single) => (
                        <div
                          key={single.id}
                          className="discover-single-card"
                          onClick={() => {
                            // Build a one-track "album" so handlePlayAlbum works
                            const singleAlbum = {
                              id: single.id,
                              title: single.title,
                              artist: single.artist,
                              coverUrl: single.cover,
                              artworkUrl: single.cover,
                              year: null,
                              tracks: [{
                                id: `${single.id}-t1`,
                                title: single.title,
                                duration: '0:00'
                              }]
                            };
                            handlePlayAlbum(singleAlbum);
                          }}
                        >
                          <div className="discover-single-art">
                            {single.cover ? (
                              <img src={single.cover} alt={single.title} loading="lazy" />
                            ) : (
                              <Music size={48} />
                            )}
                          </div>
                          <div className="discover-single-info">
                            <h4 className="discover-single-title" title={single.title}>
                              {single.title}
                            </h4>
                            <p className="discover-single-artist" title={single.artist}>
                              {single.artist}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}

          {/* Library View */}
          {view === 'library' && (
            <div className="library-view">
              <h2>Your Library</h2>

              {sonicSwarm.libraryLoading && (
                <div className="loading">
                  <Loader size={24} className="spinning" />
                  <span>Loading library...</span>
                </div>
              )}

              {!sonicSwarm.libraryLoading && Array.isArray(sonicSwarm.libraryAlbums) && sonicSwarm.libraryAlbums.length === 0 && (
                <div className="library-empty-state">
                  <Music size={48} />
                  <h3>Your library is empty</h3>
                  <p>Browse Discover or search for albums and hit <strong>Add</strong> to save them here.</p>
                </div>
              )}

              <div className="album-grid">
                {Array.isArray(sonicSwarm.libraryAlbums) && sonicSwarm.libraryAlbums.map(album => (
                  <div
                    key={album.id}
                    className="album-card library-card"
                    onClick={() => handlePlayAlbum(album)}
                  >
                    <button
                      className="library-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        sonicSwarm.removeFromLibrary(album.id);
                      }}
                      title="Remove from Library"
                    >
                      <X size={14} />
                    </button>
                    <div className="album-art">
                      {album.cover_url || album.coverUrl || album.cover ? (
                        <img src={album.cover_url || album.coverUrl || album.cover} alt={album.title} />
                      ) : (
                        <Disc size={64} />
                      )}
                    </div>
                    <h3>{album.title}</h3>
                    <p>{album.artist}</p>
                    {album.year && <span className="year">{album.year}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          {view === 'search' && (
            <DiscoverCatalogView
              onSelectAlbum={(album) => handlePlayAlbum(album)}
              onAddToLibrary={(album) => sonicSwarm.addToLibrary(album)}
              isInLibrary={sonicSwarm.isInLibrary}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchResults={sonicSwarm.searchResults}
              searchLoading={sonicSwarm.searchLoading}
              searchError={sonicSwarm.searchError}
              handleSearch={handleSearch}
            />
          )}

          {/* Album View */}
          {view === 'album' && currentAlbum && (
            <div className="album-view">
              <div className="album-header">
                <button className="back-button" onClick={() => setView('library')}>
                  ← Back to Library
                </button>

                <div
                  className="album-hero"
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '24px',
                    marginBottom: '32px',
                    height: '200px'
                  }}
                >
                  <div
                    className="album-cover"
                    style={{
                      width: '200px',
                      height: '200px',
                      minWidth: '200px',
                      maxWidth: '200px',
                      minHeight: '200px',
                      maxHeight: '200px',
                      flexShrink: 0,
                      flexGrow: 0,
                      borderRadius: '12px',
                      overflow: 'hidden',
                      background: 'linear-gradient(135deg, #6366f1 0%, #0ea5e9 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {currentAlbum.artworkUrl ? (
                      <img
                        src={currentAlbum.artworkUrl}
                        alt={currentAlbum.title}
                        style={{
                          width: '200px',
                          height: '200px',
                          objectFit: 'cover',
                          borderRadius: '12px',
                          display: 'block',
                          flexShrink: 0
                        }}
                      />
                    ) : (
                      <Disc size={128} />
                    )}
                  </div>

                  <div className="album-info">
                    <h1>{currentAlbum.title}</h1>
                    <p className="artist">{currentAlbum.artist}</p>
                    <p className="year">{currentAlbum.year}</p>

                    <button
                      className={`library-add-btn album-add-btn${sonicSwarm.isInLibrary(currentAlbum?.id) ? ' in-library' : ''}`}
                      onClick={() => { if (!sonicSwarm.isInLibrary(currentAlbum?.id)) sonicSwarm.addToLibrary(currentAlbum); }}
                      title={sonicSwarm.isInLibrary(currentAlbum?.id) ? 'Already in Library' : 'Add to Library'}
                      disabled={sonicSwarm.isInLibrary(currentAlbum?.id)}
                    >
                      {sonicSwarm.isInLibrary(currentAlbum?.id)
                        ? <><CheckCircle size={16} /> In Library</>
                        : <><PlusCircle size={16} /> Add to Library</>}
                    </button>

                    <div className="status-badges">
                      {torrentLoading ? (
                        <div className="loading-badge">
                          <Loader size={16} className="spinning" />
                          <span>Finding torrents on P2P network...</span>
                        </div>
                      ) : torrentError ? (
                        <div className="error-badge">
                          <AlertCircle size={16} />
                          <span>{torrentError}</span>
                        </div>
                      ) : currentTorrentData?.torrents?.length > 0 ? (
                        <div className="success-badge">
                          <Zap size={16} />
                          <span>
                            {currentTorrentData.torrents.length} torrent
                            {currentTorrentData.torrents.length !== 1 ? 's' : ''} found •{' '}
                            {currentTorrentData.torrents[0].seeders} seeders
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tracklist */}
              <div className="tracklist">
                <div className="tracklist-header">
                  <span>#</span>
                  <span>Title</span>
                  <span>Status</span>
                  <span>Duration</span>
                </div>

                <div className="tracklist-items">
                  {currentAlbum.tracks.map((track, index) => {
                    const isActive = index === currentTrackIndex;
                    const isInspecting = inspectingTrackId === track.id;

                    return (
                      <div key={track.id} className="track-row-group">
                        {/* Main Track Item Row */}
                        <div
                          className={`track-item ${isActive ? 'active' : ''} ${isInspecting ? 'active-inspecting' : ''}`}
                          onClick={() => { handleTrackClick(track, currentAlbum); handleSelectTrack(index); }}
                        >
                          <span className="track-number">
                            {isActive && isPlaying ? (
                              <span className="playing">▶</span>
                            ) : (
                              index + 1
                            )}
                          </span>
                          <span className="track-title">{track.title}</span>
                          <span className="track-status">
                            {torrentLoading && isActive ? (
                              <Loader size={14} className="spinning" />
                            ) : sonicSwarm.streamStatus === 'resolving' && isActive ? (
                              <span className="badge resolving">Resolving...</span>
                            ) : (currentTorrentData?.torrents?.length > 0 && isActive) ? (
                              <span className="badge streaming">
                                {sonicSwarm.streamStatus === 'streaming' ? 'Streaming' : 'Ready'}
                              </span>
                            ) : isActive && torrentError ? (
                              <span className="badge error">Error</span>
                            ) : (
                              <span className="badge idle">Queue</span>
                            )}
                          </span>
                          <span className="track-duration">{track.duration}</span>
                        </div>

                        {/* STREMIO-STYLE SOURCE DRAWER */}
                        <SourcePickerDrawer
                          track={track}
                          album={currentAlbum}
                          inspectingTrackId={inspectingTrackId}
                          setInspectingTrackId={setInspectingTrackId}
                          handlePlaySource={(source) => handlePlaySource(source, track, index)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* PLAYER BAR — in-flow flex child, NEVER overlaps content */}
        {currentAlbum && (
          <div className="player-bar">
            {/* Left: artwork + track info */}
            <div className="player-left">
              <div className="player-art">
                {currentAlbum.artworkUrl ? (
                  <img src={currentAlbum.artworkUrl} alt="" />
                ) : (
                  <Music size={20} />
                )}
              </div>
              <div className="player-track-info">
                <span className="player-track-title">
                  {currentAlbum.tracks[currentTrackIndex]?.title}
                </span>
                <span className="player-artist">{currentAlbum.artist}</span>
              </div>
            </div>

            {/* Center: transport controls */}
            <div className="player-center">
              <button
                className="player-btn"
                onClick={() => handleSkip('prev')}
                disabled={currentTrackIndex === 0}
                title="Previous"
              >
                <SkipBack size={18} />
              </button>
              <button className="player-btn play-pause" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <button
                className="player-btn stop-btn"
                onClick={handleStop}
                title="Stop playback"
              >
                <Square size={20} />
              </button>
              <button
                className="player-btn"
                onClick={() => handleSkip('next')}
                disabled={currentTrackIndex >= currentAlbum.tracks.length - 1}
                title="Next"
              >
                <SkipForward size={18} />
              </button>
            </div>

            {/* Right: swarm stats */}
            <div className="player-right">
              <span className="player-stat">
                <Users size={12} /> {sonicSwarm.swarmStats.totalPeers} peers
              </span>
              <span className="player-stat">
                ↓ {sonicSwarm.swarmStats.totalDownloadSpeed} MB/s
              </span>
              <span className="player-stat">
                {sonicSwarm.streamStatus === 'streaming' ? '●' : '○'}&nbsp;
                {Math.round(playbackProgress)}% buffered
              </span>
            </div>

            {/* Seek bar — absolutely positioned at the very bottom of the bar */}
            <div className="player-progress" onClick={handleSeek} title="Seek">
              <div className="player-progress-fill" style={{ width: `${playbackProgress}%` }} />
            </div>
          </div>
        )}
      </main>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        src={sonicSwarm.currentStreamId ? sonicSwarm.getFileStreamUrl(sonicSwarm.currentAudioIndex || 0) : ""}
        crossOrigin="anonymous"
        key={`${sonicSwarm.currentStreamId}-${sonicSwarm.currentAudioIndex}`}
      />
    </div>
  );
}