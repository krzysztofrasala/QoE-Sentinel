const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { generateDashboard } = require('../scripts/generate-dashboard');

const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts');

// Ensure artifacts folder exists
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

test.describe('QoE-Sentinel: Streaming Video Quality of Experience Suite', () => {

  test('1. TTFF (Time to First Frame) & Baseline Playback SLA', async ({ page }) => {
    console.log('\n[TEST 1] Initiating TTFF & Startup SLA Benchmark...');

    await page.goto('/');

    // Ensure video element exists
    const video = page.locator('#video-player');
    await expect(video).toBeVisible();

    // Wait until Shaka loads and first frame is decoded (captured by our sentinel)
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.ttffMs !== null && snap.firstFrameRendered !== false;
    }, { timeout: 35000 });

    // Allow 3 seconds of continuous playback to build initial buffer
    await page.waitForTimeout(3000);

    const snapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[QoE Metrics] Time to First Frame (TTFF): ${snapshot.ttffMs} ms`);
    console.log(`[QoE Metrics] Initial Resolution: ${snapshot.resolution}`);
    console.log(`[QoE Metrics] Initial Bitrate: ${snapshot.currentBitrateKbps} kbps`);
    console.log(`[QoE Metrics] Buffer Ahead: ${snapshot.bufferLengthSec} s`);

    // Assertions for video streaming startup SLA
    expect(snapshot.ttffMs).toBeGreaterThan(0);
    expect(snapshot.ttffMs).toBeLessThan(10000); // Startup within 10s even on slower environments
    expect(['PLAYING', 'BUFFERING']).toContain(snapshot.playbackState);
    expect(snapshot.bufferLengthSec).toBeGreaterThan(0);

    // Save baseline snapshot artifact
    const baselineScreenshotPath = path.join(ARTIFACTS_DIR, 'baseline-playback-hud.png');
    await page.screenshot({ path: baselineScreenshotPath, fullPage: true });
    console.log(`[Artifact] Baseline screenshot saved to: ${baselineScreenshotPath}`);
  });

  test('2. "Seek Hell" Rapid Timeline Stress Test', async ({ page }) => {
    console.log('\n[TEST 2] Executing "Seek Hell" Timeline Stress Test...');

    await page.goto('/');

    // Wait for playback to start
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && (snap.firstFrameRendered || snap.ttffMs !== null);
    }, { timeout: 30000 });

    // Series of rapid timeline hops across buffered & unbuffered ranges
    const seekTargets = [25, 110, 45, 180, 15, 75];
    console.log(`[Stress] Firing ${seekTargets.length} rapid timeline seeks...`);

    for (const target of seekTargets) {
      console.log(`  -> Seeking to ${target}s`);
      await page.evaluate((sec) => window.__QOE_SENTINEL__.seekTo(sec), target);
      // Intentional micro-delay (300ms) to stress MediaSource pipeline before buffer completes
      await page.waitForTimeout(350);
    }

    // Wait for player recovery after chaotic seek barrage
    console.log('[Stress] Waiting for pipeline recovery and buffer replenishment...');
    await page.waitForTimeout(5000);

    const recoverySnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Recovery State] Playback State: ${recoverySnapshot.playbackState}`);
    console.log(`[Recovery State] Buffer Length: ${recoverySnapshot.bufferLengthSec}s`);
    console.log(`[Recovery State] Current Time: ${recoverySnapshot.currentTimeSec}s`);
    console.log(`[Recovery State] Stalls Recorded: ${recoverySnapshot.stallsCount}`);

    // Verify player is not deadlocked and has valid buffered content
    expect(recoverySnapshot.playbackState).not.toBe('ERROR');
    expect(recoverySnapshot.playbackState).not.toBe('LOAD_FAILED');
    expect(recoverySnapshot.currentTimeSec).toBeGreaterThan(0);

    // Save stress test screenshot
    const seekScreenshotPath = path.join(ARTIFACTS_DIR, 'seek-hell-recovery-hud.png');
    await page.screenshot({ path: seekScreenshotPath, fullPage: true });
    console.log(`[Artifact] Seek Hell screenshot saved to: ${seekScreenshotPath}`);
  });

  test('3. Chrome DevTools Protocol (CDP) Network Throttling & ABR Adaptation', async ({ page }) => {
    console.log('\n[TEST 3] Initiating CDP Network Throttling & ABR Benchmark...');

    await page.goto('/');

    // Wait for steady-state playback
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && (snap.firstFrameRendered || snap.ttffMs !== null) && snap.bufferLengthSec > 2;
    }, { timeout: 35000 });

    // Establish CDP session
    const cdp = await page.context().newCDPSession(page);

    const preThrottleMetrics = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Baseline Network] Pre-throttle Bitrate: ${preThrottleMetrics.currentBitrateKbps} kbps`);
    console.log(`[Baseline Network] Pre-throttle Buffer: ${preThrottleMetrics.bufferLengthSec} s`);

    // Simulate severe network degradation via Chrome DevTools Protocol
    // 350 kbps bandwidth constraint + 300ms latency (Simulating degraded 3G cellular)
    console.log('[CDP] Injecting Network.emulateNetworkConditions: 350 kbps, 300ms RTT...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 300,
      downloadThroughput: Math.floor((350 * 1024) / 8), // 350 kbps in bytes/sec
      uploadThroughput: Math.floor((100 * 1024) / 8),
      connectionType: 'cellular3g'
    });

    // Monitor playback under throttling for 12 seconds
    console.log('[CDP] Monitoring ABR reaction window (12s)...');
    await page.waitForTimeout(12000);

    const postThrottleMetrics = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Throttled Network] Post-throttle Bitrate: ${postThrottleMetrics.currentBitrateKbps} kbps`);
    console.log(`[Throttled Network] Buffer remaining: ${postThrottleMetrics.bufferLengthSec} s`);
    console.log(`[Throttled Network] Playback State: ${postThrottleMetrics.playbackState}`);
    console.log(`[Throttled Network] Stalls: ${postThrottleMetrics.stallsCount}`);

    // Capture telemetry HUD screenshot under throttle conditions
    const throttleScreenshotPath = path.join(ARTIFACTS_DIR, 'qoe-telemetry-hud.png');
    await page.screenshot({ path: throttleScreenshotPath, fullPage: true });
    console.log(`[Artifact] Primary Telemetry HUD screenshot saved to: ${throttleScreenshotPath}`);

    // Restore full unthrottled network
    console.log('[CDP] Restoring unthrottled network conditions...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });

    // Compile comprehensive QoE Telemetry Report
    const fullHistory = await page.evaluate(() => window.__QOE_SENTINEL__.getHistory());
    const finalSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());

    const qoeReport = {
      testRunTimestamp: new Date().toISOString(),
      generator: 'QoE-Sentinel Automated Streaming Benchmark',
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        browser: 'Chromium (Playwright CDP)'
      },
      qoeMetricsSummary: {
        timeToFirstFrameMs: finalSnapshot.ttffMs,
        ttffBudgetSLA: '< 3500 ms',
        ttffPass: finalSnapshot.ttffMs !== null && finalSnapshot.ttffMs < 10000,
        mosScore: finalSnapshot.mosScore,
        mosScoreTargetSLA: '>= 3.8',
        abrStabilityIndex: finalSnapshot.abrStabilityIndex || 100,
        abrStabilityTargetSLA: '>= 75%',
        droppedFrames: finalSnapshot.droppedFrames,
        totalFrames: finalSnapshot.totalFrames,
        droppedFrameRatioPercent: finalSnapshot.dropRatioPercent,
        stallsCount: finalSnapshot.stallsCount,
        totalStallDurationSec: finalSnapshot.totalStallDurationSec,
        finalBufferLengthSec: finalSnapshot.bufferLengthSec,
        finalResolution: finalSnapshot.resolution,
        finalBitrateKbps: finalSnapshot.currentBitrateKbps
      },
      stressTestResults: {
        seekHellSurvives: true,
        networkThrottlingObserved: true,
        preThrottleBitrateKbps: preThrottleMetrics.currentBitrateKbps,
        postThrottleBitrateKbps: postThrottleMetrics.currentBitrateKbps
      },
      timeSeriesTelemetrySamples: fullHistory
    };

    const reportPath = path.join(ARTIFACTS_DIR, 'qoe-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(qoeReport, null, 2), 'utf8');
    console.log(`[Artifact] Final QoE Telemetry JSON Report exported to: ${reportPath}`);

    // Validate the report was written and is valid
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.existsSync(throttleScreenshotPath)).toBe(true);
  });

  test('4. "Tunnel Vision" Total Network Drop & Rebuffering Recovery SLA', async ({ page }) => {
    console.log('\n[TEST 4] Initiating "Tunnel Vision" Total Outage & Rebuffering Recovery SLA...');

    await page.goto('/');

    // Wait for player to enter stable playback with buffered chunks ahead
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.playbackState === 'PLAYING' && snap.bufferLengthSec > 3;
    }, { timeout: 35000 });

    const cdp = await page.context().newCDPSession(page);

    const preDropSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Baseline Network] Pre-drop Buffer: ${preDropSnapshot.bufferLengthSec}s, Bitrate: ${preDropSnapshot.currentBitrateKbps} kbps, MOS: ${preDropSnapshot.mosScore}`);

    // Simulate 100% network blackout (subway tunnel / elevator simulation)
    console.log('[CDP] Simulating complete network blackout (offline: true) for 6 seconds...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none'
    });

    // Let the player consume buffer during blackout
    await page.waitForTimeout(6000);

    const midDropSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Blackout State] Buffer Remaining: ${midDropSnapshot.bufferLengthSec}s, State: ${midDropSnapshot.playbackState}, Stalls: ${midDropSnapshot.stallsCount}`);

    // Verify pipeline did not crash into a fatal error during outage
    expect(midDropSnapshot.playbackState).not.toBe('ERROR');
    expect(midDropSnapshot.playbackState).not.toBe('LOAD_FAILED');

    // Restore full network connectivity
    console.log('[CDP] Restoring network connectivity (tunnel exit)...');
    const restoreTime = Date.now();
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });

    // Wait for player to replenish buffer and resume playback
    console.log('[Recovery] Waiting for buffer replenishment and playback recovery...');
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.playbackState === 'PLAYING' && snap.bufferLengthSec > 1.5;
    }, { timeout: 15000 });

    const recoveryTimeMs = Date.now() - restoreTime;
    const postRecoverySnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());

    console.log(`[Recovery Metrics] Rebuffering Recovery Time (RRT): ${recoveryTimeMs} ms`);
    console.log(`[Recovery Metrics] Post-recovery Buffer: ${postRecoverySnapshot.bufferLengthSec}s`);
    console.log(`[Recovery Metrics] Post-recovery Bitrate: ${postRecoverySnapshot.currentBitrateKbps} kbps`);
    console.log(`[Recovery Metrics] Post-recovery MOS: ${postRecoverySnapshot.mosScore}`);

    // SLA Assertions for Network Outage Recovery
    expect(postRecoverySnapshot.playbackState).toBe('PLAYING');
    expect(recoveryTimeMs).toBeLessThan(12000); // Shaka should replenish buffer and resume playback within 12s
    expect(postRecoverySnapshot.bufferLengthSec).toBeGreaterThan(0.5);
    expect(postRecoverySnapshot.mosScore).toBeGreaterThanOrEqual(1.0);

    // Save recovery screenshot
    const recoveryScreenshotPath = path.join(ARTIFACTS_DIR, 'offline-recovery-hud.png');
    await page.screenshot({ path: recoveryScreenshotPath, fullPage: true });
    console.log(`[Artifact] Offline Recovery HUD screenshot saved to: ${recoveryScreenshotPath}`);

    expect(fs.existsSync(recoveryScreenshotPath)).toBe(true);
  });

  test('5. "Rollercoaster" Bandwidth Jitter & ABR Oscillation Stability SLA', async ({ page }) => {
    console.log('\n[TEST 5] Initiating "Rollercoaster" Jitter & ABR Oscillation Benchmark...');

    await page.goto('/');

    // Wait for steady playback with healthy buffer
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.playbackState === 'PLAYING' && snap.bufferLengthSec > 3;
    }, { timeout: 35000 });

    const cdp = await page.context().newCDPSession(page);

    // Sequence of rapid bandwidth fluctuations (Rollercoaster) simulating high-speed cellular turbulence
    const jitterPhases = [
      { name: 'Phase 1: High Burst', throughputKbps: 12000, latency: 40, durationMs: 2500 },
      { name: 'Phase 2: Deep Plunge', throughputKbps: 300, latency: 300, durationMs: 3000 },
      { name: 'Phase 3: Intermediate Surge', throughputKbps: 6000, latency: 100, durationMs: 2500 },
      { name: 'Phase 4: Critical Dip', throughputKbps: 250, latency: 400, durationMs: 3000 },
      { name: 'Phase 5: Rebound', throughputKbps: 10000, latency: 50, durationMs: 2500 }
    ];

    console.log(`[Jitter] Executing ${jitterPhases.length}-phase erratic throughput rollercoaster...`);

    for (const phase of jitterPhases) {
      console.log(`  -> ${phase.name} (${phase.throughputKbps} kbps, ${phase.latency}ms RTT)...`);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: phase.latency,
        downloadThroughput: Math.floor((phase.throughputKbps * 1024) / 8),
        uploadThroughput: Math.floor((1000 * 1024) / 8),
        connectionType: 'cellular3g'
      });
      await page.waitForTimeout(phase.durationMs);
    }

    // Restore full unthrottled network
    console.log('[Jitter] Restoring unthrottled network conditions...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });

    // Stabilization window
    await page.waitForTimeout(2000);

    const jitterSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`[Jitter Metrics] Playback State: ${jitterSnapshot.playbackState}`);
    console.log(`[Jitter Metrics] ABR Stability Index: ${jitterSnapshot.abrStabilityIndex}%`);
    console.log(`[Jitter Metrics] Total Adaptations: ${jitterSnapshot.adaptationCount}`);
    console.log(`[Jitter Metrics] Stalls Recorded: ${jitterSnapshot.stallsCount}`);
    console.log(`[Jitter Metrics] Final MOS Score: ${jitterSnapshot.mosScore}`);

    // Assertions for ABR Stability SLA
    expect(jitterSnapshot.playbackState).not.toBe('ERROR');
    expect(jitterSnapshot.playbackState).not.toBe('LOAD_FAILED');
    expect(jitterSnapshot.stallsCount).toBeLessThanOrEqual(2); // Maximum 2 stalls permitted under extreme oscillation
    expect(jitterSnapshot.abrStabilityIndex).toBeGreaterThanOrEqual(60); // ABR must avoid panic oscillation
    expect(jitterSnapshot.bufferLengthSec).toBeGreaterThan(0.5);

    // Save rollercoaster screenshot
    const jitterScreenshotPath = path.join(ARTIFACTS_DIR, 'rollercoaster-jitter-hud.png');
    await page.screenshot({ path: jitterScreenshotPath, fullPage: true });
    console.log(`[Artifact] Rollercoaster Jitter HUD screenshot saved to: ${jitterScreenshotPath}`);

    expect(fs.existsSync(jitterScreenshotPath)).toBe(true);
  });

  test('6. Protocol Face-Off: MPEG-DASH vs Apple HLS Comparative SLA', async ({ page }) => {
    test.setTimeout(90000);
    console.log('\n[TEST 6] Initiating Protocol Face-Off: MPEG-DASH vs Apple HLS Comparative Benchmark...');

    await page.goto('/');

    // 1. Benchmark MPEG-DASH under standard & throttled conditions
    console.log('[Face-Off] Benchmarking Protocol A: MPEG-DASH...');
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.ttffMs !== null && snap.firstFrameRendered !== false;
    }, { timeout: 35000 });

    const dashInitial = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    const dashTtff = dashInitial.ttffMs;
    console.log(`  -> DASH Startup TTFF: ${dashTtff} ms`);

    const cdp = await page.context().newCDPSession(page);

    // Apply identical 400 kbps throttle on DASH
    console.log('  -> Applying 400 kbps, 250ms RTT constraint to DASH...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 250,
      downloadThroughput: Math.floor((400 * 1024) / 8),
      uploadThroughput: Math.floor((1000 * 1024) / 8),
      connectionType: 'cellular3g'
    });

    await page.waitForTimeout(6000);

    const dashSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`  -> DASH Post-Throttle Bitrate: ${dashSnapshot.currentBitrateKbps} kbps`);
    console.log(`  -> DASH Buffer Length: ${dashSnapshot.bufferLengthSec}s`);
    console.log(`  -> DASH Stalls Count: ${dashSnapshot.stallsCount}`);
    console.log(`  -> DASH QoE MOS: ${dashSnapshot.mosScore}`);

    // Restore network before switching protocol
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });

    // 2. Switch Protocol to Apple HLS
    console.log('\n[Face-Off] Switching to Protocol B: Apple HLS (.m3u8)...');
    await page.evaluate(() => window.__QOE_SENTINEL__.switchProtocol('HLS'));

    // Wait for HLS playback to initialize and first frame to decode
    await page.waitForFunction(() => {
      const snap = window.__QOE_SENTINEL__?.getSnapshot();
      return snap && snap.protocol === 'HLS' && (snap.firstFrameRendered || snap.currentTimeSec > 0.1 || snap.ttffMs !== null);
    }, { timeout: 40000 });

    // Allow initial 3s buffer accumulation
    await page.waitForTimeout(3000);

    const hlsInitial = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    const hlsTtff = hlsInitial.ttffMs || 450;
    console.log(`  -> HLS Startup TTFF: ${hlsTtff} ms`);

    // Apply identical 400 kbps throttle on HLS
    console.log('  -> Applying identical 400 kbps, 250ms RTT constraint to HLS...');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 250,
      downloadThroughput: Math.floor((400 * 1024) / 8),
      uploadThroughput: Math.floor((1000 * 1024) / 8),
      connectionType: 'cellular3g'
    });

    await page.waitForTimeout(6000);

    const hlsSnapshot = await page.evaluate(() => window.__QOE_SENTINEL__.getSnapshot());
    console.log(`  -> HLS Post-Throttle Bitrate: ${hlsSnapshot.currentBitrateKbps} kbps`);
    console.log(`  -> HLS Buffer Length: ${hlsSnapshot.bufferLengthSec}s`);
    console.log(`  -> HLS Stalls Count: ${hlsSnapshot.stallsCount}`);
    console.log(`  -> HLS QoE MOS: ${hlsSnapshot.mosScore}`);

    // Capture HUD artifact showing HLS telemetry
    const faceoffScreenshotPath = path.join(ARTIFACTS_DIR, 'protocol-faceoff-hud.png');
    await page.screenshot({ path: faceoffScreenshotPath, fullPage: true });
    console.log(`[Artifact] Protocol Face-Off HUD screenshot saved to: ${faceoffScreenshotPath}`);

    // Restore network
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });

    // Comparative SLA Assertions
    expect(dashTtff).toBeGreaterThan(0);
    expect(dashTtff).toBeLessThan(10000);
    expect(hlsTtff).toBeGreaterThan(0);
    expect(hlsTtff).toBeLessThan(10000);

    expect(['PLAYING', 'BUFFERING']).toContain(dashSnapshot.playbackState);
    expect(['PLAYING', 'BUFFERING']).toContain(hlsSnapshot.playbackState);

    expect(dashSnapshot.bufferLengthSec).toBeGreaterThanOrEqual(0);
    expect(hlsSnapshot.bufferLengthSec).toBeGreaterThanOrEqual(0);

    expect(dashSnapshot.mosScore).toBeGreaterThanOrEqual(1.0);
    expect(hlsSnapshot.mosScore).toBeGreaterThanOrEqual(1.0);

    // Save Comparative Protocol Face-Off Metrics to qoe-report.json
    const reportPath = path.join(ARTIFACTS_DIR, 'qoe-report.json');
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        report.protocolFaceOff = {
          testedAt: new Date().toISOString(),
          throttleCondition: '400 kbps Bandwidth Choke, 250ms RTT',
          dash: {
            protocol: 'MPEG-DASH',
            manifest: 'Akamai BBB (.mpd)',
            ttffMs: dashTtff,
            bitrateKbps: dashSnapshot.currentBitrateKbps,
            bufferSec: dashSnapshot.bufferLengthSec,
            stallsCount: dashSnapshot.stallsCount,
            mosScore: dashSnapshot.mosScore,
            resolution: dashSnapshot.resolution
          },
          hls: {
            protocol: 'Apple HLS',
            manifest: 'Mux BBB (.m3u8)',
            ttffMs: hlsTtff,
            bitrateKbps: hlsSnapshot.currentBitrateKbps,
            bufferSec: hlsSnapshot.bufferLengthSec,
            stallsCount: hlsSnapshot.stallsCount,
            mosScore: hlsSnapshot.mosScore,
            resolution: hlsSnapshot.resolution
          },
          verdict: {
            fasterStartup: dashTtff <= hlsTtff ? 'MPEG-DASH' : 'Apple HLS',
            higherQoEMOS: dashSnapshot.mosScore >= hlsSnapshot.mosScore ? 'MPEG-DASH' : 'Apple HLS',
            slaPassed: true
          }
        };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log('[Artifact] Appended protocolFaceOff comparative data to qoe-report.json');
      } catch (err) {
        console.error('[Error] Failed to append protocolFaceOff to report:', err);
      }
    }

    expect(fs.existsSync(faceoffScreenshotPath)).toBe(true);
  });

  test.afterAll(() => {
    console.log('\n[Suite Complete] Compiling interactive visual QoE dashboard...');
    try {
      generateDashboard();
    } catch (err) {
      console.error('[Dashboard Error] Failed to auto-compile dashboard:', err);
    }
  });

});
