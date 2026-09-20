// S1 screenshot capture: 1440x900, dark + light themes of /next/ (production build served via test server)
const { chromium } = require('playwright-core');
const http = require('http');

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}/next/`;
const OUT_DIR = '/home/ubuntu/hermes-company-workbench/web/screenshots';

function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server timeout')), 15000);
    const probe = () => {
      http.get(url, (r) => { clearTimeout(t); r.resume(); resolve(); })
        .on('error', () => setTimeout(probe, 300));
    };
    probe();
  });
}

(async () => {
  await waitForServer(BASE);
  const browser = await chromium.launch({
    executablePath: '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  // ---- DARK ----
  await page.goto(BASE, { waitUntil: 'load', timeout: 20000 });
  await page.evaluate(() => { localStorage.setItem('wb_theme', 'dark'); document.documentElement.classList.add('dark'); });
  await page.reload({ waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(2500);
  const darkAvatarCount = await page.locator('img[src*="/avatars/"]').count();
  await page.screenshot({ path: `${OUT_DIR}/dark-overview-1440.png` });
  console.log(`dark screenshot: ${darkAvatarCount} avatars`);

  // ---- LIGHT ----
  await page.evaluate(() => { localStorage.setItem('wb_theme', 'light'); document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); });
  await page.reload({ waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(2500);
  const lightAvatarCount = await page.locator('img[src*="/avatars/"]').count();
  await page.screenshot({ path: `${OUT_DIR}/light-overview-1440.png` });
  console.log(`light screenshot: ${lightAvatarCount} avatars`);

  console.log('consoleErrors:', consoleErrors.length ? consoleErrors : 'none');
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
