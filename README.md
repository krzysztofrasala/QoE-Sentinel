# 🎬 QoE-Sentinel: Autonomous Video Streaming QoE Test Framework

[![QoE Benchmark CI](https://github.com/krzysztofrasala/QoE-Sentinel/actions/workflows/qoe-pipeline.yml/badge.svg)](https://github.com/krzysztofrasala/QoE-Sentinel/actions/workflows/qoe-pipeline.yml)
[![Live Dashboard](https://img.shields.io/badge/Live_Dashboard-GitHub_Pages-success?logo=github)](https://krzysztofrasala.github.io/QoE-Sentinel/)
[![Engine](https://img.shields.io/badge/Player-Google%20Shaka%20v4.x-red)](https://github.com/shaka-project/shaka-player)
[![Automation](https://img.shields.io/badge/Automation-Playwright%20%2B%20CDP-blue)](https://playwright.dev/)
[![Protocol](https://img.shields.io/badge/Streaming-MPEG--DASH-orange)](https://dashif.org/)
[![Target](https://img.shields.io/badge/Domain-Netflix%20%2F%20Video%20Platform%20QA-black)](https://netflix.com)

> **Autonomous Quality of Experience (QoE) testing system for HTML5 adaptive video streaming.**  
> Built to evaluate video playback pipelines under real-world stress conditions: startup latency (TTFF), aggressive seeking ("Seek Hell"), and real-time Chrome DevTools Protocol (CDP) network throttling.

---

## 📌 Architecture & Design

```mermaid
flowchart LR
    subgraph Engine ["Playwright Automation Engine"]
        Runner["E2E Test Runner"]
        CDP["CDP Session (Network Throttling)"]
        Reporter["Artifact Exporter"]
    end

    subgraph Runtime ["Browser Runtime (Chromium)"]
        Player["Shaka Player (MPEG-DASH)"]
        Video["HTML5 Video Element"]
        HUD["Stats for Nerds HUD"]
        Telemetry["QoE Sentinel Engine"]
    end

    subgraph Output ["Generated Artifacts"]
        JSON["qoe-report.json"]
        PNG["qoe-telemetry-hud.png"]
    end

    Runner -->|"Launches & Controls"| Player
    CDP -->|"Simulates 350 kbps Choke"| Player
    Player -->|"Feeds MSE Buffers"| Video
    Video -->|"Emits Quality Stats"| Telemetry
    Telemetry -->|"Refreshes (1 Hz)"| HUD
    Telemetry -->|"window.__QOE_SENTINEL__"| Reporter
    Reporter -->|"Writes Metrics"| JSON
    Reporter -->|"Captures Screenshot"| PNG
```

![QoE-Sentinel Telemetry HUD Preview](artifacts/qoe-telemetry-hud.png)

---

## 🎯 Key Capabilities

1. **Google Shaka Player Integration**
   - Industrial-grade multi-bitrate MPEG-DASH playback engine.
   - Configured with proactive ABR adaptation and buffer management thresholds.

2. **Real-time "Stats for Nerds" Telemetry HUD**
   - Translucent glassmorphism overlay displaying live streaming health metrics.
   - Toggleable via UI button or keyboard shortcut (`S`).
   - Programmatic inspection interface via `window.__QOE_SENTINEL__.getSnapshot()`.

3. **Time to First Frame (TTFF) SLA Benchmark**
   - Precision measurement from manifest request start to initial decoded and rendered frame.
   - Enforces SLA performance budgets (< 3,500 ms target).

4. **"Seek Hell" Timeline Stress Testing**
   - Simulates erratic user timeline navigation (back-to-back seeks across buffered and unbuffered chunks).
   - Validates MediaSource pipeline resilience, prevents playback deadlock, and tracks re-buffering recovery.

5. **CDP (Chrome DevTools Protocol) Network Throttling**
   - Injects realistic network degradation (e.g., 350 kbps bandwidth constraint + 300ms RTT latency) directly at the browser transport layer.
   - Observes and evaluates Shaka Player ABR adaptation (downswitching stream variants to maintain playback continuity without terminal stall).

6. **"Tunnel Vision" Total Network Outage & Rebuffering Recovery SLA**
   - Simulates complete connection drops (`offline: true` for 6 seconds) mimicking subways, elevators, or cell handover failures.
   - Verifies player pipeline resilience through media buffer depletion and measures **Rebuffering Recovery Time (RRT)** upon network reconnection.

7. **"Rollercoaster" Bandwidth Jitter & ABR Oscillation Stability SLA**
   - Cycles network throughput across a 5-phase erratic rollercoaster (12 Mbps $\leftrightarrow$ 250 kbps) simulating high-speed cellular turbulence.
   - Evaluates ABR smoothing hysteresis and enforces the **ABR Stability Index** ($\ge 70\%$) to prevent visual oscillation storms.

8. **ITU-T P.1203 Inspired MOS (Mean Opinion Score)**
   - Algorithmic viewer satisfaction model computing a normalized QoE score (1.0 – 5.0).
   - Factors in base video encoding quality, TTFF startup latency penalties, stall frequency/duration weights, and ABR switching instability.

9. **Protocol Face-Off: MPEG-DASH vs Apple HLS Comparative SLA**
   - Head-to-head performance shootout running identical network throttling constraints (400 kbps, 250ms RTT) across both protocols.
   - Evaluates startup latency (TTFF), throttled variant adaptation, buffer retention, and final MOS rating between DASH and HLS.

10. **Multi-Audio Track & Subtitles Switching SLA (Zero Deadlock & A/V Sync Parity)**
   - Dynamic track switching across multi-language audio streams (English, Spanish, German, French, Italian) and WebVTT subtitle tracks (French, Greek, Portuguese).
   - Validates that track switching under traffic does not cause pipeline deadlock, playback freeze, or A/V desynchronization.

11. **Automated Artifacts Generation & Visual Analytics Dashboard**
   - Generates structured, timestamped JSON reports to `/artifacts/qoe-report.json`.
   - Compiles a standalone dark-mode interactive HTML analytics dashboard (`dashboard.html`) powered by Chart.js time-series plots and comparative cards.
   - Captures high-resolution visual screenshots of the telemetry HUD under stress into `/artifacts/`.

12. **Automated Executive PDF QoE Audit Report (`npm run report:pdf`)**
   - Compiles an executive 1-page A4 audit report formatted for streaming engineering management and QA leaders.
   - Includes production deployment SLA verdict, business risk overview, KPI scorecard matrix, dual-protocol shootout, and chaos resilience findings.

---

## 📊 Core QoE Metrics Tracked

| Metric | Description | Target / SLA |
| :--- | :--- | :--- |
| **QoE Score (ITU-T MOS)** | Synthesized viewer experience index (1.0 to 5.0 scale) based on ITU-T P.1203. | `≥ 3.8 / 5.0` |
| **ABR Stability Index** | Resistance against rapid representation flipping and oscillation storms under network jitter. | `≥ 70 %` |
| **TTFF (Time to First Frame)** | Duration in milliseconds between stream initiation and the first rendered frame. | `< 3,500 ms` |
| **Rebuffering Recovery Time (RRT)** | Latency required to replenish buffer and resume smooth playback after an outage. | `< 6,000 ms` |
| **Multi-Track Switching SLA** | Verification of on-the-fly audio language switches and WebVTT subtitle track toggling during active playback. | `≤ 2` micro-stalls, zero deadlock, continuous playhead |
| **Buffer Health (Length)** | Amount of forward-buffered media (in seconds) stored ahead of current playhead. | `> 15.0 s` |
| **Variant Bitrate** | Bitrate of the active video representation chosen by the ABR engine. | Dynamic (e.g. 500 – 4500 kbps) |
| **Dropped Frame Ratio** | Ratio of dropped video frames to total decoded frames (`getVideoPlaybackQuality`). | `< 1.0 %` |
| **Stalls & Rebuffering** | Count of playback interruptions and accumulated freeze time (excluding intentional seeks). | `0 unexpected stalls` |
| **ABR Adaptation Speed** | Time taken by player to downswitch or upswitch representations upon throughput shifts. | `< 15.0 s` |
| **Multi-Protocol SLA** | Comparative parity verification between MPEG-DASH and Apple HLS under bandwidth choke. | Both TTFF `< 10s` & MOS `≥ 1.0` |

---

## 📁 Project Structure

```
QoE-Sentinel/
├── artifacts/                     # Generated test reports & screenshots
│   ├── dashboard.html             # Standalone interactive Chart.js analytics dashboard
│   ├── index.html                 # Direct GitHub Pages entrypoint
│   ├── qoe-executive-summary.pdf  # 1-page A4 corporate executive audit report
│   ├── qoe-report.json            # Machine-readable QoE benchmark metrics
│   ├── protocol-faceoff-hud.png   # DASH vs HLS comparative benchmark HUD
│   ├── qoe-telemetry-hud.png      # High-res screenshot of live Stats for Nerds HUD
│   ├── baseline-playback-hud.png  # Baseline playback verification screenshot
│   ├── seek-hell-recovery-hud.png # Stress test recovery screenshot
│   ├── offline-recovery-hud.png   # Network outage recovery screenshot
│   └── rollercoaster-jitter-hud.png # Bandwidth jitter turbulence screenshot
├── scripts/
│   ├── generate-dashboard.js      # Analytics dashboard HTML generator
│   └── generate-pdf-report.js     # Executive PDF report compiler (A4 print engine)
├── tests/
│   └── qoe-streaming.spec.js      # Playwright E2E QoE 6-test suite
├── index.html                     # HTML5 streaming test stage with Shaka Player
├── player.js                      # QoE telemetry engine & Shaka Player logic
├── styles.css                     # Dark-mode streaming dashboard & HUD styles
├── playwright.config.js           # Playwright & local webServer configuration
├── package.json                   # Dependencies & automated scripts
└── README.md                      # Engineering documentation
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18 or higher (v20+ recommended)
- **npm**: v9 or higher

### 2. Installation
```bash
git clone https://github.com/krzysztofrasala/QoE-Sentinel.git
cd QoE-Sentinel
npm install
```

### 3. Running Automated QoE Tests
Run the full headless suite (automatically compiles `dashboard.html` upon completion):
```bash
npm test
```

Run tests in headed mode to watch the player and HUD in real time:
```bash
npm run test:headed
```

View the generated Playwright HTML execution report:
```bash
npm run test:report
```

### 4. Interactive Visual QoE Dashboard
Open the standalone visual analytics dashboard featuring Chart.js time-series plots, KPI verdict badges, and screenshot lightbox:
```bash
npm run dashboard
```

### 5. Running the Interactive Web Player
Start the local server and open your browser:
```bash
npm start
```
Navigate to: `http://localhost:3000`
- Press **`S`** to toggle the "Stats for Nerds" overlay.
- Click **Trigger Random Seek** to manually test pipeline recovery.

---

## 📈 Sample Generated QoE Report (`/artifacts/qoe-report.json`)

```json
{
  "testRunTimestamp": "2026-09-20T19:05:00.000Z",
  "generator": "QoE-Sentinel Automated Streaming Benchmark",
  "qoeMetricsSummary": {
    "timeToFirstFrameMs": 1420,
    "ttffBudgetSLA": "< 3500 ms",
    "ttffPass": true,
    "mosScore": 4.17,
    "mosScoreTargetSLA": ">= 3.8",
    "abrStabilityIndex": 72,
    "abrStabilityTargetSLA": ">= 70%",
    "droppedFrames": 0,
    "totalFrames": 412,
    "droppedFrameRatioPercent": 0,
    "stallsCount": 0,
    "totalStallDurationSec": 0,
    "finalBufferLengthSec": 24.8,
    "finalResolution": "1280x720",
    "finalBitrateKbps": 2240
  },
  "stressTestResults": {
    "seekHellSurvives": true,
    "networkThrottlingObserved": true,
    "preThrottleBitrateKbps": 2240,
    "postThrottleBitrateKbps": 490
  }
}
```

---

## 🌐 Continuous Integration & Cloud Dashboard (GitHub Actions)

This repository features an automated CI/CD pipeline defined in [`.github/workflows/qoe-pipeline.yml`](.github/workflows/qoe-pipeline.yml):
1. **Automated Headless Benchmarking**: Every pull request or push to `main` spins up a cloud Ubuntu runner with headless Chromium to execute all 4 QoE SLA tests.
2. **Automated Artifact Archival**: Test runs upload raw JSON metrics and full Playwright traces as 14-day persistent build artifacts.
3. **Automated GitHub Pages Deployment**: The compiled standalone analytics dashboard (`dashboard.html`) is deployed to **GitHub Pages**:
   - 🔗 **Live Analytics Dashboard**: [https://krzysztofrasala.github.io/QoE-Sentinel/](https://krzysztofrasala.github.io/QoE-Sentinel/)

---

## 🧪 Netflix QA Engineering Context

In large-scale streaming systems (like Netflix, Prime Video, or YouTube), video playback quality isn't just about UI layout or buttons. It's about **playback continuity**, **audio-video synchronization**, and **client-side QoE telemetry**.

This project demonstrates:
- Deep familiarity with **HTML5 Media Source Extensions (MSE)** and adaptive streaming protocols (**MPEG-DASH / HLS**).
- Direct utilization of **Chrome DevTools Protocol (CDP)** for low-level transport simulation.
- Robust stress testing against pipeline edge cases (**Buffer under-run, Seek churn, Bandwidth collapse**).
- Production-grade observability via **Stats for Nerds HUD** and structured JSON metric pipelines for CI/CD regression tracking.

---

## 📄 License
MIT License. Created for Video Quality of Experience (QoE) test automation portfolio.
