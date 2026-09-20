const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const cachedChromePath = path.join(
  process.env.HOME || '',
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);

const executablePath = fs.existsSync(cachedChromePath) ? cachedChromePath : undefined;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 75000,
  expect: {
    timeout: 15000
  },
  fullyParallel: false,
  workers: 1, // Run sequentially to avoid network emulation cross-talk
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        executablePath,
        launchOptions: {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        }
      }
    }
  ],
  webServer: {
    command: 'npx serve -l 3000 .',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 30000
  }
});
