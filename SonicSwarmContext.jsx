/**
 * SonicSwarm API Context
 * Centralized state management for backend communication
 * 
 * Handles:
 * - Torrent resolution
 * - Album search
 * - Streaming control
 * - Swarm statistics
 * - Pre-buffering
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:9191';

const SonicSwarmContext = createContext(null);

export const SonicSwarmProvider = ({ children }) => {
  // API Status
  const [serverConnected, setServerConnected] = useState(false);
  const [serverHealth, setServerHealth] = useState(null);

  // Search & Discovery
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Discovery (iTunes-powered homepage)
  const [discoveryData, setDiscoveryData] = useState({ albums: [], singles: [] });
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState(null);

  // User Library
  const [libraryAlbums, setLibraryAlbums] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState(null);

  // Playback
  const [currentStreamId, setCurrentStreamId] = useState(null);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [currentTorrentName, setCurrentTorrentName] = useState('');
  const [currentMagnet, setCurrentMagnet] = useState(null);
  const [currentTorrentFiles, setCurrentTorrentFiles] = useState([]);
  const [streamStatus, setStreamStatus] = useState('idle');
  const [isAlbumPackStream, setIsAlbumPackStream] = useState(false);

  // Swarm Statistics
  const [swarmStats, setSwarmStats] = useState({
    activeTorrents: 0,
    totalPeers: 0,
    totalSeeds: 0,
    totalDownloadSpeed: '0',
    swarms: []
  });

  // Source Picker (Stremio-style)
  const [currentSources, setCurrentSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  // Torrent Resolution Cache
  const [torrentCache, setTorrentCache] = useState({});

  // Polling intervals
  const statsIntervalRef = useRef(null);
  const healthIntervalRef = useRef(null);

  // ─────────────────────────────────────────────────────────
  // CONNECTION MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Check server health and establish connection
   */
  const checkServerHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/health`);
      if (!response.ok) throw new Error('Server unreachable');

      const data = await response.json();
      setServerHealth(data);
      setServerConnected(true);

      return data;
    } catch (error) {
      console.error('Health check failed:', error);
      setServerConnected(false);
      setServerHealth(null);
      return null;
    }
  }, []);

  /**
 * Initialize server connection and polling
 */
  useEffect(() => {
    // Check health immediately
    checkServerHealth();

    // Check health every 10 seconds
    healthIntervalRef.current = setInterval(() => {
      checkServerHealth();
    }, 10000);

    return () => {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
      }
    };
  }, [checkServerHealth]);

  // NOTE: Auto-fetch useEffects for library + discovery are placed AFTER their
  // useCallback declarations to avoid TDZ (temporal dead zone) crashes.

  /**
   * Poll swarm statistics
   */
  const pollSwarmStats = useCallback(async () => {
    if (!serverConnected) return;

    try {
      const response = await fetch(`${API_BASE}/api/swarm-stats`);
      if (!response.ok) throw new Error('Failed to fetch stats');

      const data = await response.json();
      setSwarmStats(data);
    } catch (error) {
      console.error('Stats poll error:', error);
    }
  }, [serverConnected]);

  /**
   * Start swarm stats polling
   */
  useEffect(() => {
    if (!serverConnected) return;

    // Poll immediately
    pollSwarmStats();

    // Poll every 1 second
    statsIntervalRef.current = setInterval(() => {
      pollSwarmStats();
    }, 1000);

    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [serverConnected, pollSwarmStats]);

  // ─────────────────────────────────────────────────────────
  // SEARCH & DISCOVERY
  // ─────────────────────────────────────────────────────────

  /**
   * Fetch discovery homepage data (popular albums + singles from iTunes charts)
   */
  const fetchDiscovery = useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryError(null);

    try {
      const response = await fetch(`${API_BASE}/api/discover`);
      if (!response.ok) throw new Error('Discovery fetch failed');

      const data = await response.json();
      setDiscoveryData({
        albums: data.albums || [],
        singles: data.singles || []
      });
      return data;
    } catch (error) {
      console.error('Discovery fetch error:', error);
      setDiscoveryError(error.message);
    } finally {
      setDiscoveryLoading(false);
    }
  }, []);

  /**
   * Fetch user's library albums
   */
  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);

    try {
      const response = await fetch(`${API_BASE}/api/library`);
      if (!response.ok) throw new Error('Library fetch failed');

      const data = await response.json();
      setLibraryAlbums(data.albums || []);
      return data;
    } catch (error) {
      console.error('Library fetch error:', error);
      setLibraryError(error.message);
      setLibraryAlbums([]);
      throw error;
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  /**
   * Auto-fetch library when server first connects
   * Declared here (after fetchLibrary) to avoid TDZ crash
   */
  useEffect(() => {
    if (serverConnected && libraryAlbums.length === 0 && !libraryLoading) {
      fetchLibrary();
    }
  }, [serverConnected, libraryAlbums.length, libraryLoading, fetchLibrary]);

  /**
 * Search for albums by query
 */
  const searchAlbums = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&type=album`);
      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setSearchError(error.message);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  /**
   * Add an album to the user's library
   * Accepts any album-shaped object — normalizes to what the backend expects
   */
  const addToLibrary = useCallback(async (album) => {
    if (!album) return;

    // Client-side duplicate guard — instant, no server round-trip needed
    const alreadyAdded = libraryAlbums.some(a => a.id === album.id);
    if (alreadyAdded) return { alreadyInLibrary: true };

    // Optimistic update: add to state immediately so UI responds instantly
    const normalized = {
      id:         album.id,
      title:      album.title,
      artist:     album.artist,
      year:       album.year || null,
      cover_url:  album.cover || album.coverUrl || album.artworkUrl || null,
      track_count: album.trackCount || album.track_count || album.tracks?.length || 0
    };
    setLibraryAlbums(prev => [...prev, normalized]);

    try {
      const response = await fetch(`${API_BASE}/api/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:         album.id,
          title:      album.title,
          artist:     album.artist,
          year:       album.year || null,
          cover:      album.cover || album.coverUrl || album.artworkUrl || null,
          trackCount: album.trackCount || album.track_count || album.tracks?.length || 0
        })
      });

      if (!response.ok) throw new Error('Failed to add to library');

      const data = await response.json();
      return data;
    } catch (error) {
      // Revert optimistic update on failure
      setLibraryAlbums(prev => prev.filter(a => a.id !== album.id));
      console.error('Add to library error:', error);
      return false;
    }
  }, [fetchLibrary, libraryAlbums]);

  /**
   * Remove an album from the user's library
   */
  const removeFromLibrary = useCallback(async (albumId) => {
    if (!albumId) return;

    // Optimistic update: remove from state immediately
    const snapshot = libraryAlbums;
    setLibraryAlbums(prev => prev.filter(a => a.id !== albumId));

    try {
      const response = await fetch(`${API_BASE}/api/library/${encodeURIComponent(albumId)}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to remove from library');

      return true;
    } catch (error) {
      // Revert on failure
      setLibraryAlbums(snapshot);
      console.error('Remove from library error:', error);
      return false;
    }
  }, [libraryAlbums]);

  /**
   * Check if an album ID is already in the library
   */
  const isInLibrary = useCallback((albumId) => {
    return libraryAlbums.some(a => a.id === albumId);
  }, [libraryAlbums]);

  // ─────────────────────────────────────────────────────────
  // STREMIO-STYLE SOURCES SCRAPER
  // ─────────────────────────────────────────────────────────

  /**
   * Fetch metadata + source options for a track (Stremio/Torrentio pattern)
   * Returns album metadata, full tracklist, and prioritized source magnets
   */
  const fetchSources = useCallback(async (artist, album, track, itunesId = null) => {
    if (!serverConnected) {
      throw new Error('Server not connected');
    }

    setSourcesLoading(true);
    setCurrentSources([]);

    try {
      const response = await fetch(`${API_BASE}/api/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, album, track, itunesId })
      });

      if (!response.ok) throw new Error('Failed to fetch sources');

      const data = await response.json();
      setCurrentSources(data.sources || []);
      return data;
    } catch (error) {
      console.error('Sources fetch error:', error);
      setCurrentSources([]);
      throw error;
    } finally {
      setSourcesLoading(false);
    }
  }, [serverConnected]);

  // ─────────────────────────────────────────────────────────
  // TORRENT RESOLUTION
  // ─────────────────────────────────────────────────────────

  /**
   * Resolve a track to torrent magnet links
   * Uses cache to avoid repeated queries
   */
  const resolveTorrent = useCallback(async (artist, track, album = '', itunesId = null) => {
    const cacheKey = `${artist}|${track}|${album}`;

    // Check cache
    if (torrentCache[cacheKey]) {
      console.log('📚 Torrent resolution from cache');
      return torrentCache[cacheKey];
    }

    if (!serverConnected) {
      throw new Error('Server not connected');
    }

    try {
      const response = await fetch(`${API_BASE}/api/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, track, album, itunesId })
      });

      if (!response.ok) throw new Error('Resolution failed');

      const data = await response.json();

      // Cache result
      setTorrentCache(prev => ({
        ...prev,
        [cacheKey]: data
      }));

      return data;
    } catch (error) {
      console.error('Torrent resolution error:', error);
      throw error;
    }
  }, [serverConnected, torrentCache]);

  // ─────────────────────────────────────────────────────────
  // STREAMING CONTROL
  // ─────────────────────────────────────────────────────────

  /**
   * Start streaming a magnet link
   */
  const startStream = useCallback(async (magnet, targetTrackTitle = null, trackNumber = null) => {
    if (!magnet) {
      throw new Error('No magnet URI provided');
    }

    if (!serverConnected) {
      throw new Error('Server not connected');
    }

    try {
      setStreamStatus('connecting');

      const response = await fetch(`${API_BASE}/api/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet, targetTrackTitle, trackNumber })
      });

      if (!response.ok) throw new Error('Stream failed');

      const data = await response.json();

      setCurrentStreamId(data.streamId);
      setCurrentMagnet(magnet);
      setCurrentTorrentFiles(data.files || []);

      // Determine if this torrent is a multi-file album pack
      const audioExtRe = /\.(mp3|flac|wav|m4a|ogg|aac|opus)$/i;
      const audioFileCount = (data.files || []).filter(f => audioExtRe.test(f)).length;
      setIsAlbumPackStream(audioFileCount > 1);

      // If targetTrackTitle is numeric, use it as a direct file index
      if (typeof targetTrackTitle === 'number') {
        setCurrentAudioIndex(targetTrackTitle);
      } else {
        setCurrentAudioIndex(data.audioIndex !== undefined ? data.audioIndex : 0);
      }

      setCurrentTorrentName(data.torrent);
      setStreamStatus('streaming');

      return data;
    } catch (error) {
      console.error('Stream error:', error);
      setStreamStatus('error');
      throw error;
    }
  }, [serverConnected]);

  /**
   * Stop streaming
   */
  const stopStream = useCallback(() => {
    setCurrentStreamId(null);
    setCurrentTorrentName('');
    setStreamStatus('idle');
  }, []);

  // ─────────────────────────────────────────────────────────
  // PRE-BUFFERING
  // ─────────────────────────────────────────────────────────

  /**
   * Pre-buffer upcoming tracks for instant skipping
   */
  const prebufferTracks = useCallback(async (magnets) => {
    if (!Array.isArray(magnets) || magnets.length === 0) {
      return;
    }

    if (!serverConnected) {
      return;
    }

    try {
      const validMagnets = magnets.filter(m => m && typeof m === 'string');

      if (validMagnets.length === 0) {
        return;
      }

      const response = await fetch(`${API_BASE}/api/prebuffer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnets: validMagnets })
      });

      if (!response.ok) throw new Error('Prebuffer failed');

      const data = await response.json();
      console.log(`⏳ Prebuffered ${data.prebuffered.length} tracks`);

      return data;
    } catch (error) {
      console.error('Prebuffer error:', error);
    }
  }, [serverConnected]);

  // ─────────────────────────────────────────────────────────
  // UTILITY METHODS
  // ─────────────────────────────────────────────────────────

  /**
   * Get file streaming URL
   */
  const getFileStreamUrl = useCallback((fileIndex = 0) => {
    if (!currentStreamId) return null;
    return `${API_BASE}/api/torrent/${currentStreamId}/file/${fileIndex}`;
  }, [currentStreamId]);

  /**
 * Clear cache (for manual refresh)
 */
  const clearCache = useCallback(() => {
    setTorrentCache({});
  }, []);

  /**
   * Kill switch — completely purge the current stream state.
   * Prevents zombie loops where a failed stream resurrects the previous one.
   */
  const resetPlayback = useCallback(() => {
    setCurrentStreamId(null);
    setCurrentMagnet(null);
    setCurrentAudioIndex(0);
    setCurrentTorrentName('');
    setCurrentTorrentFiles([]);
    setIsAlbumPackStream(false);
    setStreamStatus('idle');
  }, []);

  // ─────────────────────────────────────────────────────────
  // CONTEXT VALUE
  // ─────────────────────────────────────────────────────────

  const value = {
    // Connection
    serverConnected,
    serverHealth,
    checkServerHealth,

    // Search
    searchResults,
    searchLoading,
    searchError,
    searchAlbums,

    // Discovery
    discoveryData,
    discoveryLoading,
    discoveryError,
    fetchDiscovery,

    // Library
    libraryAlbums,
    libraryLoading,
    libraryError,
    fetchLibrary,
    addToLibrary,
    removeFromLibrary,
    isInLibrary,

    // Sources (Stremio-style)
    fetchSources,
    currentSources,
    sourcesLoading,

    // Streaming
    currentStreamId,
    currentAudioIndex,
    setCurrentAudioIndex,
    currentTorrentName,
    currentMagnet,
    currentTorrentFiles,
    isAlbumPackStream,
    streamStatus,
    setStreamStatus,
    startStream,
    stopStream,
    getFileStreamUrl,
    resetPlayback,

    // Resolution
    resolveTorrent,
    clearCache,

    // Statistics
    swarmStats,
    pollSwarmStats,

    // Pre-buffering
    prebufferTracks
  };

  return (
    <SonicSwarmContext.Provider value={value}>
      {children}
    </SonicSwarmContext.Provider>
  );
};

/**
 * Hook to use SonicSwarm context
 */
export const useSonicSwarm = () => {
  const context = useContext(SonicSwarmContext);
  if (!context) {
    throw new Error('useSonicSwarm must be used within SonicSwarmProvider');
  }
  return context;
};