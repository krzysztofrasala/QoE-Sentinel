/**
 * QoE-Sentinel - Real-time HTML5 / DASH Quality of Experience Telemetry Engine
 * Embedded with Google Shaka Player
 */

const DEFAULT_DASH_MANIFEST = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';
const DEFAULT_HLS_MANIFEST = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

class QoETelemetrySentinel {
  constructor() {
    this.videoElement = document.getElementById('video-player');
    this.hudElement = document.getElementById('nerd-hud');
    this.player = null;

    // QoE Telemetry State
    this.state = {
      protocol: 'DASH', // 'DASH' | 'HLS'
      manifestUrl: DEFAULT_DASH_MANIFEST,
      loadStartTime: null,
      ttffMs: null,
      firstFrameRendered: false,
      playbackState: 'INITIALIZING',
      currentBitrateKbps: 0,
      estimatedBandwidthKbps: 0,
      bufferLengthSec: 0,
      droppedFrames: 0,
      totalFrames: 0,
      dropRatioPercent: 0,
      resolution: '0x0',
      stallsCount: 0,
      totalStallDurationMs: 0,
      stallStartTime: null,
      lastStallDurationMs: 0,
      recoveryCount: 0,
      adaptationCount: 0,
      switchHistory: [],
      abrStabilityIndex: 100,
      mosScore: 5.0,
      isUserSeeking: false,
      history: []
    };

    this.timerId = null;
  }

  async init() {
    // Install built-in polyfills to patch any browser quirks
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      console.error('QoE-Sentinel: Browser not supported for Shaka Player');
      this.state.playbackState = 'UNSUPPORTED_BROWSER';
      this.updateUI();
      return;
    }

    this.player = new shaka.Player(this.videoElement);

    // Configure ABR and buffering thresholds for sensitive QoE benchmarking
    this.player.configure({
      streaming: {
        bufferingGoal: 30, // seconds
        rebufferingGoal: 2,
        bufferBehind: 10,
        retryParameters: {
          maxAttempts: 4,
          baseDelay: 1000,
          backoffFactor: 2
        }
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 3000000, // 3 Mbps
        switchInterval: 2 // ABR adaptation evaluation interval (seconds)
      }
    });

    this.attachEventListeners();
    await this.loadStream(this.state.manifestUrl);

    // Start 1Hz Telemetry Loop
    this.timerId = setInterval(() => this.collectTelemetrySample(), 1000);
  }

  attachEventListeners() {
    // Shaka player error handling
    this.player.addEventListener('error', (event) => {
      console.error('Shaka Player Error:', event.detail);
      this.state.playbackState = 'ERROR';
    });

    // Shaka adaptation event
    this.player.addEventListener('adaptation', () => {
      const now = performance.now();
      const tracks = this.player ? this.player.getVariantTracks() : [];
      const activeTrack = tracks.find(t => t.active);
      const newBitrate = activeTrack && activeTrack.videoBandwidth 
        ? Math.round(activeTrack.videoBandwidth / 1000) 
        : this.state.currentBitrateKbps;

      // Filter duplicate micro-events (e.g. audio + video adapting at the same millisecond)
      const lastSwitch = this.state.switchHistory[this.state.switchHistory.length - 1];
      const isDuplicate = lastSwitch && ((now - lastSwitch.time < 1200) || (lastSwitch.bitrate === newBitrate));

      if (!isDuplicate) {
        this.state.adaptationCount++;
        this.state.switchHistory.push({
          time: now,
          bitrate: newBitrate
        });

        if (this.state.switchHistory.length > 30) {
          this.state.switchHistory.shift();
        }
      }

      this.collectTelemetrySample();
      this.state.abrStabilityIndex = this.calculateAbrStabilityIndex();
    });

    // Native video pipeline events for QoE tracking
    this.videoElement.addEventListener('play', () => {
      if (!this.state.isUserSeeking) {
        this.state.playbackState = 'PLAYING';
      }
    });

    this.videoElement.addEventListener('playing', () => {
      this.handlePlaybackResumed();
    });

    this.videoElement.addEventListener('pause', () => {
      if (!this.state.isUserSeeking && this.state.playbackState !== 'BUFFERING') {
        this.state.playbackState = 'PAUSED';
      }
    });

    this.videoElement.addEventListener('seeking', () => {
      this.state.isUserSeeking = true;
      this.state.playbackState = 'SEEKING';
    });

    this.videoElement.addEventListener('seeked', () => {
      this.state.isUserSeeking = false;
      if (!this.videoElement.paused) {
        this.state.playbackState = 'PLAYING';
      }
    });

    this.videoElement.addEventListener('waiting', () => {
      // Rebuffering / Stall event
      if (!this.state.isUserSeeking) {
        this.state.playbackState = 'BUFFERING';
        this.state.stallsCount++;
        this.state.stallStartTime = performance.now();
      }
    });

    // Time to First Frame (TTFF) detection via loadeddata & timeupdate
    const detectFirstFrame = () => {
      if (!this.state.firstFrameRendered && this.state.loadStartTime) {
        const quality = this.videoElement.getVideoPlaybackQuality 
          ? this.videoElement.getVideoPlaybackQuality() 
          : null;
        
        // Frame rendered if totalVideoFrames > 0 or currentTime progressed
        if ((quality && quality.totalVideoFrames > 0) || this.videoElement.currentTime > 0.05) {
          const now = performance.now();
          this.state.ttffMs = Math.round(now - this.state.loadStartTime);
          this.state.firstFrameRendered = true;
          console.log(`[QoE-Sentinel] TTFF captured: ${this.state.ttffMs} ms`);
        }
      }
    };

    this.videoElement.addEventListener('loadeddata', detectFirstFrame);
    this.videoElement.addEventListener('timeupdate', detectFirstFrame);
  }

  handlePlaybackResumed() {
    this.state.playbackState = 'PLAYING';
    if (this.state.stallStartTime) {
      const stallDuration = performance.now() - this.state.stallStartTime;
      this.state.totalStallDurationMs += stallDuration;
      this.state.lastStallDurationMs = Math.round(stallDuration);
      this.state.recoveryCount++;
      this.state.stallStartTime = null;
    }
  }

  async switchProtocol(protocol) {
    const target = (protocol || '').toUpperCase();
    if (target !== 'DASH' && target !== 'HLS') {
      console.warn(`[QoE-Sentinel] Unsupported protocol: ${protocol}`);
      return;
    }
    const manifestUrl = target === 'HLS' ? DEFAULT_HLS_MANIFEST : DEFAULT_DASH_MANIFEST;
    console.log(`[QoE-Sentinel] Switching protocol to ${target}: ${manifestUrl}`);
    this.state.protocol = target;

    // Reset performance metrics for the fresh stream evaluation
    this.state.stallsCount = 0;
    this.state.totalStallDurationMs = 0;
    this.state.stallStartTime = null;
    this.state.lastStallDurationMs = 0;
    this.state.recoveryCount = 0;
    this.state.adaptationCount = 0;
    this.state.switchHistory = [];
    this.state.abrStabilityIndex = 100;
    this.state.mosScore = 5.0;
    this.state.history = [];
    this.state.droppedFrames = 0;
    this.state.totalFrames = 0;
    this.state.dropRatioPercent = 0;

    await this.loadStream(manifestUrl);
    this.updateProtocolUI();
  }

  updateProtocolUI() {
    const isHls = this.state.protocol === 'HLS';
    const headerProtocol = document.getElementById('header-stream-protocol');
    if (headerProtocol) {
      headerProtocol.textContent = isHls ? 'HLS / ABR Active' : 'DASH / ABR Active';
    }

    const streamLabel = document.getElementById('stream-label');
    if (streamLabel) {
      streamLabel.textContent = isHls 
        ? 'Stream: Apple HLS Multi-bitrate (Mux BBB)' 
        : 'Stream: Akamai BBB DASH Multi-bitrate';
    }

    const btnDash = document.getElementById('btn-proto-dash');
    const btnHls = document.getElementById('btn-proto-hls');
    if (btnDash && btnHls) {
      if (isHls) {
        btnDash.classList.remove('active', 'btn-primary');
        btnHls.classList.add('active', 'btn-primary');
      } else {
        btnHls.classList.remove('active', 'btn-primary');
        btnDash.classList.add('active', 'btn-primary');
      }
    }
  }

  async loadStream(manifestUrl) {
    this.state.manifestUrl = manifestUrl;
    if (manifestUrl && manifestUrl.includes('.m3u8')) {
      this.state.protocol = 'HLS';
    } else {
      this.state.protocol = 'DASH';
    }
    this.state.loadStartTime = performance.now();
    this.state.firstFrameRendered = false;
    this.state.ttffMs = null;
    this.state.playbackState = 'LOADING';
    this.updateUI();
    this.updateProtocolUI();

    try {
      await this.player.load(manifestUrl);
      console.log(`[QoE-Sentinel] ${this.state.protocol} Manifest loaded successfully`);
      
      // Auto-play unmuted (or muted if browser policy requires)
      try {
        await this.videoElement.play();
      } catch (err) {
        console.warn('[QoE-Sentinel] Autoplay blocked, muting video for autonomous playback:', err);
        this.videoElement.muted = true;
        await this.videoElement.play();
      }
    } catch (error) {
      console.error('[QoE-Sentinel] Error loading manifest:', error);
      this.state.playbackState = 'LOAD_FAILED';
    }
  }

  calculateBufferAhead() {
    if (!this.videoElement || this.videoElement.buffered.length === 0) {
      return 0;
    }
    const currentTime = this.videoElement.currentTime;
    const buffered = this.videoElement.buffered;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
        return Math.max(0, buffered.end(i) - currentTime);
      }
    }
    return 0;
  }

  collectTelemetrySample() {
    if (!this.player || !this.videoElement) return;

    // Buffer length
    const bufferSec = this.calculateBufferAhead();
    this.state.bufferLengthSec = parseFloat(bufferSec.toFixed(2));

    // Shaka stats
    const stats = this.player.getStats();
    if (stats) {
      // Estimated bandwidth from ABR
      if (stats.estimatedBandwidth) {
        this.state.estimatedBandwidthKbps = Math.round(stats.estimatedBandwidth / 1000);
      }
      
      // Video variant bitrate
      if (stats.streamBandwidth) {
        this.state.currentBitrateKbps = Math.round(stats.streamBandwidth / 1000);
      }
    }

    // Active variant lookup
    const tracks = this.player.getVariantTracks();
    const activeTrack = tracks.find(t => t.active);
    if (activeTrack) {
      if (activeTrack.videoBandwidth) {
        this.state.currentBitrateKbps = Math.round(activeTrack.videoBandwidth / 1000);
      }
      if (activeTrack.width && activeTrack.height) {
        this.state.resolution = `${activeTrack.width}x${activeTrack.height}`;
      }
    } else if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
      this.state.resolution = `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`;
    }

    // Frame quality
    if (this.videoElement.getVideoPlaybackQuality) {
      const q = this.videoElement.getVideoPlaybackQuality();
      this.state.droppedFrames = q.droppedVideoFrames;
      this.state.totalFrames = q.totalVideoFrames;
      this.state.dropRatioPercent = q.totalVideoFrames > 0
        ? parseFloat(((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2))
        : 0;
    }

    // Calculate ITU-T P.1203 inspired MOS QoE Score
    this.state.mosScore = this.calculateMosScore();

    // Record historical snapshot for time-series / reporting
    const snapshot = this.getSnapshot();
    this.state.history.push({
      timestamp: Date.now(),
      ...snapshot
    });

    // Keep last 120 samples
    if (this.state.history.length > 120) {
      this.state.history.shift();
    }

    this.updateUI();
  }

  calculateMosScore() {
    if (!this.state.firstFrameRendered && this.state.ttffMs === null) {
      return 5.0;
    }

    // 1. Base video quality from bitrate (logarithmic saturation model)
    // 4000 kbps -> ~4.85, 2000 kbps -> ~4.5, 1000 kbps -> ~4.0, 500 kbps -> ~3.3, 200 kbps -> ~2.4
    const bitrate = Math.max(100, this.state.currentBitrateKbps || 800);
    let baseScore = 1.0 + 3.85 * (1 - Math.exp(-bitrate / 1100));

    // 2. Startup delay penalty (TTFF)
    // SLA target: < 3500 ms. If <= 2500ms, 0 penalty. Above that, gradual penalty up to 0.8
    let ttffPenalty = 0;
    if (this.state.ttffMs && this.state.ttffMs > 2500) {
      ttffPenalty = Math.min(0.8, ((this.state.ttffMs - 2500) / 4000) * 0.8);
    }

    // 3. Rebuffering / Stall Penalty (ITU-T P.1203 heavily penalizes stalls)
    const stallSec = this.state.totalStallDurationMs / 1000;
    const stallPenalty = Math.min(3.0, (this.state.stallsCount * 0.45) + (stallSec * 0.25));

    // 4. Adaptation oscillation penalty
    const adaptationPenalty = Math.min(0.4, (this.state.adaptationCount || 0) * 0.04);

    // 5. Dropped frames penalty
    const dropPenalty = Math.min(0.5, (this.state.dropRatioPercent || 0) * 0.1);

    const mos = baseScore - ttffPenalty - stallPenalty - adaptationPenalty - dropPenalty;
    return parseFloat(Math.max(1.0, Math.min(5.0, mos)).toFixed(2));
  }

  calculateAbrStabilityIndex() {
    if (!this.state.switchHistory || this.state.switchHistory.length <= 1) {
      return 100;
    }

    let penalty = 0;
    const history = this.state.switchHistory;
    const now = performance.now();

    // Look at switches in the last 30 seconds
    const recentSwitches = history.filter(s => (now - s.time) < 30000);

    for (let i = 1; i < recentSwitches.length; i++) {
      const deltaSec = (recentSwitches[i].time - recentSwitches[i - 1].time) / 1000;
      if (deltaSec < 2.0) {
        // Severe panic oscillation (< 2s between variant shifts)
        penalty += 10;
      } else if (deltaSec < 3.5) {
        // Rapid switch
        penalty += 4;
      }
    }

    // Direct flip-flop penalty (A -> B -> A)
    for (let i = 2; i < recentSwitches.length; i++) {
      if (recentSwitches[i].bitrate === recentSwitches[i - 2].bitrate) {
        penalty += 6;
      }
    }

    // Cap stability between 0% and 100%
    return Math.max(0, Math.min(100, 100 - penalty));
  }

  getSnapshot() {
    return {
      protocol: this.state.protocol,
      manifestUrl: this.state.manifestUrl,
      playbackState: this.state.playbackState,
      firstFrameRendered: this.state.firstFrameRendered,
      ttffMs: this.state.ttffMs,
      currentBitrateKbps: this.state.currentBitrateKbps,
      estimatedBandwidthKbps: this.state.estimatedBandwidthKbps,
      bufferLengthSec: this.state.bufferLengthSec,
      droppedFrames: this.state.droppedFrames,
      totalFrames: this.state.totalFrames,
      dropRatioPercent: this.state.dropRatioPercent,
      resolution: this.state.resolution,
      stallsCount: this.state.stallsCount,
      totalStallDurationSec: parseFloat((this.state.totalStallDurationMs / 1000).toFixed(2)),
      lastStallDurationMs: this.state.lastStallDurationMs,
      recoveryCount: this.state.recoveryCount,
      adaptationCount: this.state.adaptationCount,
      abrStabilityIndex: this.state.abrStabilityIndex,
      mosScore: this.state.mosScore,
      currentTimeSec: parseFloat(this.videoElement.currentTime.toFixed(2)),
      durationSec: parseFloat((this.videoElement.duration || 0).toFixed(2))
    };
  }

  updateUI() {
    const s = this.getSnapshot();

    // Update HUD rows
    const updateEl = (id, text, className) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = text;
        if (className !== undefined) el.className = `hud-val ${className}`;
      }
    };

    const mos = s.mosScore;
    const mosClass = mos >= 4.0 ? 'good' : (mos >= 3.0 ? 'warn' : 'crit');

    const stab = s.abrStabilityIndex;
    const stabClass = stab >= 75 ? 'good' : (stab >= 50 ? 'warn' : 'crit');

    updateEl('hud-state', s.playbackState, s.playbackState === 'PLAYING' ? 'good' : (s.playbackState === 'BUFFERING' ? 'crit' : 'warn'));
    updateEl('hud-mos', `${mos.toFixed(2)} / 5.0`, mosClass);
    updateEl('hud-stability', `${stab}% (${stab >= 75 ? 'Stable' : (stab >= 50 ? 'Jitter' : 'Oscillating')})`, stabClass);
    updateEl('hud-ttff', s.ttffMs ? `${s.ttffMs} ms` : 'Measuring...', s.ttffMs && s.ttffMs < 3000 ? 'good' : 'highlight');
    updateEl('hud-bitrate', `${s.currentBitrateKbps.toLocaleString()} kbps`, 'highlight');
    updateEl('hud-bandwidth', `${(s.estimatedBandwidthKbps / 1000).toFixed(2)} Mbps`);
    updateEl('hud-buffer', `${s.bufferLengthSec.toFixed(1)} s`, s.bufferLengthSec > 10 ? 'good' : (s.bufferLengthSec > 3 ? 'warn' : 'crit'));
    updateEl('hud-resolution', s.resolution);
    updateEl('hud-dropped', `${s.droppedFrames} / ${s.totalFrames} (${s.dropRatioPercent}%)`, s.dropRatioPercent < 1 ? 'good' : 'warn');
    updateEl('hud-stalls', `${s.stallsCount} (${s.totalStallDurationSec}s)`, s.stallsCount === 0 ? 'good' : 'crit');

    // Buffer visual bar (max 30s target)
    const bar = document.getElementById('hud-buffer-fill');
    if (bar) {
      const pct = Math.min(100, Math.round((s.bufferLengthSec / 30) * 100));
      bar.style.width = `${pct}%`;
      if (s.bufferLengthSec > 12) {
        bar.style.background = 'linear-gradient(90deg, #00e676, #00d2ff)';
      } else if (s.bufferLengthSec > 4) {
        bar.style.background = 'linear-gradient(90deg, #ffab00, #ffd600)';
      } else {
        bar.style.background = '#ff1744';
      }
    }

    // Top Header & KPI Cards
    const cardTtff = document.getElementById('card-ttff');
    if (cardTtff) cardTtff.textContent = s.ttffMs ? `${s.ttffMs} ms` : '--';

    const cardBitrate = document.getElementById('card-bitrate');
    if (cardBitrate) cardBitrate.textContent = `${s.currentBitrateKbps} kbps`;

    const cardBuffer = document.getElementById('card-buffer');
    if (cardBuffer) cardBuffer.textContent = `${s.bufferLengthSec.toFixed(1)}s`;

    const cardDropped = document.getElementById('card-dropped');
    if (cardDropped) cardDropped.textContent = `${s.dropRatioPercent}%`;

    const cardMos = document.getElementById('card-mos');
    if (cardMos) {
      cardMos.textContent = `${mos.toFixed(2)}`;
      cardMos.className = `kpi-card-value ${mosClass}`;
    }
  }

  toggleHud() {
    if (this.hudElement) {
      this.hudElement.classList.toggle('hidden');
    }
  }

  async seek(targetSeconds) {
    if (!this.videoElement) return;
    const duration = this.videoElement.duration || 600;
    const clamped = Math.max(0, Math.min(duration - 5, targetSeconds));
    console.log(`[QoE-Sentinel] Seeking to: ${clamped}s`);
    this.videoElement.currentTime = clamped;
  }
}

// Global Sentinel instance initialized on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.sentinel = new QoETelemetrySentinel();
  window.sentinel.init();

  // Expose global interface for Playwright automation & inspection
  window.__QOE_SENTINEL__ = {
    getSnapshot: () => window.sentinel.getSnapshot(),
    getHistory: () => window.sentinel.state.history,
    seekTo: (sec) => window.sentinel.seek(sec),
    toggleHud: () => window.sentinel.toggleHud(),
    loadStream: (url) => window.sentinel.loadStream(url),
    switchProtocol: (proto) => window.sentinel.switchProtocol(proto),
    player: () => window.sentinel.player,
    video: () => window.sentinel.videoElement
  };

  // Setup UI controls
  const toggleBtn = document.getElementById('btn-toggle-hud');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => window.sentinel.toggleHud());
  }

  const closeHudBtn = document.getElementById('hud-close-btn');
  if (closeHudBtn) {
    closeHudBtn.addEventListener('click', () => window.sentinel.toggleHud());
  }

  const seekTestBtn = document.getElementById('btn-seek-test');
  if (seekTestBtn) {
    seekTestBtn.addEventListener('click', () => {
      const randomTime = Math.floor(Math.random() * 200) + 10;
      window.sentinel.seek(randomTime);
    });
  }

  // Protocol switcher buttons
  const btnDash = document.getElementById('btn-proto-dash');
  if (btnDash) {
    btnDash.addEventListener('click', () => window.sentinel.switchProtocol('DASH'));
  }

  const btnHls = document.getElementById('btn-proto-hls');
  if (btnHls) {
    btnHls.addEventListener('click', () => window.sentinel.switchProtocol('HLS'));
  }

  // Keyboard shortcut 'S' for HUD
  window.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') {
      window.sentinel.toggleHud();
    }
  });
});
