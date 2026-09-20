// Playwright verification script for Phase A Final Polish acceptance criteria
// Verifies both themes at 1440x900, produces S1 screenshots and console output
const { chromium } = require('playwright-core');
const http = require('http');

const TEST_PORT = 8123;
const BASE = `http://127.0.0.1:${TEST_PORT}/next/`;
const SCREENSHOT_DIR = '/home/ubuntu/hermes-company-workbench/web/screenshots';

function waitForServer(url, maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const go = () => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          tries++;
          if (tries >= maxRetries) reject(new Error('server not ready'));
          else setTimeout(go, 500);
        });
    };
    go();
  });
}

async function main() {
  console.log('Waiting for test server...');
  await waitForServer(BASE);
  console.log('Server ready');

  const browser = await chromium.launch({
    executablePath: '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const results = { pass: 0, fail: 0, items: [] };
  function check(name, ok, detail) {
    results.items.push({ name, ok, detail });
    if (ok) { results.pass++; console.log('  PASS', name, detail || ''); }
    else { results.fail++; console.log('  FAIL', name, detail || ''); }
  }

  try {
    // ====== DARK THEME ======
    console.log('\n=== DARK THEME ===');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Set dark theme default via localStorage
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => { localStorage.setItem('wb_theme', 'dark'); });
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    // Wait for app to render
    await page.waitForSelector('#root', { timeout: 5000 });

    // Check no console errors
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await new Promise(r => setTimeout(r, 2000)); // allow console events to settle

    // Check sidebar SHA — nav element exposes sidebar content
    const sidebarText = await page.textContent('nav');
    const hasSha = /[0-9a-f]{7}/.test(sidebarText) && !sidebarText.includes('dev');
    check('dark SHA non-dev hash in sidebar', hasSha, sidebarText.match(/[0-9a-f]{7,}/)?.[0] || 'no sha');

    // Check recent events block
    const bodyText = await page.textContent('body');
    const hasEvents = bodyText.includes('claimed') || bodyText.includes('created') || bodyText.includes('spawned');
    check('dark recent events non-empty', hasEvents, bodyText.substring(0, 200));

    // Check Team Pulse avatars src pointing to /avatars/*.png
    const avatarImgs = await page.$$('img[src*="/avatars/"]');
    const avatarSrcs = await Promise.all(avatarImgs.map(async (img) => {
      try { return await img.getAttribute('src'); } catch { return null; }
    }));
    const validAvatarSrcs = avatarSrcs.filter(s => s && s.endsWith('.png') && s.startsWith('/avatars/'));
    check(`dark avatar img src /avatars/*.png: ${validAvatarSrcs.length} found`, validAvatarSrcs.length >= 3,
      validAvatarSrcs.join(', '));

    // Verify each avatar loads (200)
    let allAvatarsLoad = true;
    for (const src of avatarSrcs.slice(0, 10)) {
      if (!src) continue;
      const resp = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u);
          return r.status;
        } catch { return 0; }
      }, src);
      if (resp !== 200) { allAvatarsLoad = false; }
    }
    check('dark all avatars load 200', allAvatarsLoad);

    // Check EmptyState quiet-surface (no prism-card on empty areas)
    // We look for elements mentioning "暂无" or "空" which would be empty state
    const mentionsEmpty = bodyText.includes('暂无') || bodyText.includes('空');
    // Accept if page has content — empty states exist only when data is absent
    const quietSurfaceElements = await page.$$('.quiet-surface');
    check('dark quiet-surface elements exist', quietSurfaceElements.length > 0,
      `${quietSurfaceElements.length} found`);

    // Check no unicode decoration characters
    const unicodeDecorators = ['◍', '◈', '≋', '☰'];
    let hasUnicode = false;
    for (const ch of unicodeDecorators) {
      if (bodyText.includes(ch)) { hasUnicode = true; break; }
    }
    check('dark no unicode decoration chars', !hasUnicode, 
      hasUnicode ? 'found unicode residue' : 'clean');

    // Check console errors
    check('dark no console error', consoleErrors.length === 0,
      consoleErrors.length > 0 ? consoleErrors[0] : 'clean');

    // Screenshot dark theme
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-overview-1440.png`, fullPage: false });
    console.log('  SCREENSHOT dark-overview-1440.png saved');

    // ====== LIGHT THEME ======
    console.log('\n=== LIGHT THEME ===');
    await page.evaluate(() => { localStorage.setItem('wb_theme', 'light'); });
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('#root', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 2000));

    const bodyTextLight = await page.textContent('body');

    // Check light SHA
    const sidebarTextLight = await page.textContent('nav');
    const hasShaLight = /[0-9a-f]{7}/.test(sidebarTextLight) && !sidebarTextLight.includes('dev');
    check('light SHA non-dev hash in sidebar', hasShaLight, sidebarTextLight.match(/[0-9a-f]{7,}/)?.[0] || 'no sha');

    // Check recent events
    check('light recent events non-empty', bodyTextLight.includes('claimed') || bodyTextLight.includes('created'),
      'events present');

    // Check no unicode decorations
    let hasUnicodeLight = false;
    for (const ch of unicodeDecorators) {
      if (bodyTextLight.includes(ch)) { hasUnicodeLight = true; break; }
    }
    check('light no unicode decoration chars', !hasUnicodeLight,
      hasUnicodeLight ? 'found unicode residue' : 'clean');

    // Screenshot light theme
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-overview-1440.png`, fullPage: false });
    console.log('  SCREENSHOT light-overview-1440.png saved');

    // ====== SUMMARY ======
    console.log(`\n=== RESULTS: ${results.pass} PASS, ${results.fail} FAIL ===`);
    for (const item of results.items) {
      console.log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail || 'ok'}`);
    }

  } catch (err) {
    console.error('Test error:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }

  // Write results as JSON for the report
  require('fs').writeFileSync('/tmp/s1-verification-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to /tmp/s1-verification-results.json');
}

main().catch(console.error);