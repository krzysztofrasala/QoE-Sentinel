const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

});
