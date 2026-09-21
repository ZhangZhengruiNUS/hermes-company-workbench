// B13 活动页验收 — 驱动真实 /next/ 构建 vs fixture-server (18123), 断言 §3 钩子
// 场景: 初始40/两级加载更多/历史分页/SSE注入/events子源失败stale/空池/mobile/reduced-motion
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 18124;
const BASE = `http://127.0.0.1:${PORT}/next/`;
const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const OUT = '/home/ubuntu/hermes-company-workbench/web/screenshots';
const SERVER_JS = path.join(__dirname, 'fixture-server.cjs');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ctl(q) {
  return new Promise((res, rej) => {
    http.get(`http://127.0.0.1:${PORT}/_ctl/${q}`, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
function waitForServer(url, retries = 40) {
  return new Promise((res, rej) => {
    let n = 0;
    const go = () => {
      http.get(url, (r) => { r.resume(); res(); }).on('error', () => { if (++n >= retries) rej(new Error('server not ready')); else setTimeout(go, 500); });
    };
    go();
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', [SERVER_JS], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FIXTURE_PORT: String(PORT) } });
  server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));
  await waitForServer(`http://127.0.0.1:${PORT}/_ctl/ping`);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = { pass: 0, fail: 0, items: [] };
  const check = (n, ok, d = '') => { results.items.push({ n, ok, d }); if (ok) { results.pass++; console.log('  PASS', n, d); } else { results.fail++; console.log('  FAIL', n, '|', d); } };
  let page;
  let beforeUrls = [];

  async function openActivity(viewport, theme = 'dark', reduced = false) {
    page = await browser.newPage({ viewport });
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/v1/events') && u.includes('before=')) beforeUrls.push(u);
    });
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE + '#activity', { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate((th) => localStorage.setItem('wb_theme', th), theme);
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('#root', { timeout: 8000 });
    await wait(2500);
    return page;
  }
  const body = async (p) => p.textContent('body');
  const eids = async (p) => p.$$eval('[data-eid]', (els) => els.map((e) => Number(e.getAttribute('data-eid'))));
  const btnTexts = async (p) => p.$$eval('main button', (els) => els.map((e) => e.textContent || ''));
  async function clickBtn(p, prefix) {
    const btns = await p.$$('main button');
    for (const b of btns) {
      const t = (await b.textContent()) || '';
      if (t.startsWith(prefix)) { await b.click(); await wait(900); return true; }
    }
    return false;
  }
  const closePage = async () => { try { await page.close(); } catch (_) {} beforeUrls = []; };

  try {
    // ===== scenario 1: 初始 40 → 首屏 15 + 加载更多(25) → 连点两次 40 全显 → 历史按钮 =====
    console.log('\n=== scenario initial-40: two-stage load-more ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 });
    {
      const e = await eids(page);
      check('B13-init: 首屏渲染 15 条', e.length === 15, `rows=${e.length}`);
      check('B13-init: 首条为最新(fixture-event-40)', e[0] === 40, `first=${e[0]}`);
      const bt = await btnTexts(page);
      check('B13-init: 按钮 = 加载更多(25 条)', bt.some((t) => t.includes('加载更多(25 条)')), bt.join('|'));
    }
    await clickBtn(page, '加载更多');
    {
      const e = await eids(page);
      check('B13-click1: 30 条', e.length === 30, `rows=${e.length}`);
      const bt = await btnTexts(page);
      check('B13-click1: 按钮 = 加载更多(10 条)', bt.some((t) => t.includes('加载更多(10 条)')), bt.join('|'));
    }
    await clickBtn(page, '加载更多');
    {
      const e = await eids(page);
      check('B13-click2: 40 条全显', e.length === 40, `rows=${e.length}`);
      const bt = await btnTexts(page);
      check('B13-click2: 按钮 = 加载更早的历史…', bt.some((t) => t.startsWith('加载更早的历史')), bt.join('|'));
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-initial40-dark-1440.png') });
    await closePage();

    // ===== scenario 2: 历史分页 → ?before=<oldest> 被请求, 返回 10 条 has_more=false → 按钮消失 =====
    console.log('\n=== scenario history pagination ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 });
    await clickBtn(page, '加载更多');
    await clickBtn(page, '加载更多');
    await ctl('addOld?count=10'); // 注入 10 条更旧事件(id -1..-10)
    beforeUrls = [];
    const clicked = await clickBtn(page, '加载更早的历史');
    {
      check('B13-hist: 历史按钮可点', clicked, 'click=true');
      const hasBefore = beforeUrls.some((u) => u.includes('before=1'));
      check('B13-hist: ?before=<最旧id=1> 被请求', hasBefore, beforeUrls.join(' | '));
      const e = await eids(page);
      check('B13-hist: 渲染 50 条(40 + 10)', e.length === 50, `rows=${e.length}`);
      const bodyText = await body(page);
      check('B13-hist: 出现旧历史事件 title', bodyText.includes('history--1'), 'history--1');
      const bt = await btnTexts(page);
      check('B13-hist: has_more=false → 按钮消失', bt.every((t) => !t.includes('加载')), bt.join('|'));
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-history-dark-1440.png') });
    await closePage();

    // ===== scenario 3: SSE 注入 3 条 → 列表顶部 3 条, 原 15 条位置不动 =====
    console.log('\n=== scenario SSE injection ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 });
    {
      const e = await eids(page);
      check('B13-sse: 前置首屏 15 条', e.length === 15, `rows=${e.length}`);
    }
    await ctl('add?count=3&kind=created');      // ids 41,42,43
    await ctl('broadcast?type=events');
    await wait(2500);
    {
      const e = await eids(page);
      check('B13-sse: 顶部 3 条 = 41,42,43', e.slice(0, 3).join(',') === '43,42,41', `top=${e.slice(0, 4).join(',')}`);
      check('B13-sse: 总条数 18(15 + 3)', e.length === 18, `rows=${e.length}`);
      check('B13-sse: 原最新 fixture-event-40 仍在(位置4)', e[3] === 40, `idx3=${e[3]}`);
      check('B13-sse: 原最旧已渲染 fixture-event-26 仍在', e.includes(26), 'has 26');
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-sse-dark-1440.png') });
    await closePage();

    // ===== scenario 4: events 子源失败 → 保留旧池 + stale 标注, 无白屏 =====
    console.log('\n=== scenario events source failure (LKG stale) ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 });
    {
      const e = await eids(page);
      check('B13-fail: 前置渲染 15 条', e.length === 15, `rows=${e.length}`);
    }
    await ctl('fail?source=events&on=1');
    await ctl('broadcast?type=events'); // 触发 board refresh → events 子源 503
    await wait(2500);
    {
      const bodyText = await body(page);
      const e = await eids(page);
      check('B13-fail: 保留旧数据(仍 15 条)', e.length === 15, `rows=${e.length}`);
      check('B13-fail: 无白屏(仍有事件标题)', bodyText.includes('fixture-event-40'), 'has event-40');
      check('B13-fail: stale 标注 缓存·刷新失败', bodyText.includes('缓存 · 刷新失败'), 'has stale');
      check('B13-fail: 不误报空池', !bodyText.includes('事件数据不可达'), 'no empty-lie');
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-fail-dark-1440.png') });
    await closePage();
    await ctl('fail?source=events&on=0'); // 复位

    // ===== scenario 5: 空池 → 事件数据不可达 =====
    console.log('\n=== scenario empty pool ===');
    await ctl('reset?baseline=0');
    page = await openActivity({ width: 1440, height: 900 });
    {
      const bodyText = await body(page);
      check('B13-empty: 空池提示 事件数据不可达(API 离线)', bodyText.includes('事件数据不可达(API 离线)'), 'empty msg');
      const e = await eids(page);
      check('B13-empty: 无事件行', e.length === 0, `rows=${e.length}`);
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-empty-dark-1440.png') });
    await closePage();

    // ===== scenario 6: mobile 390 无横向溢出 + 行/按钮触控目标 ≥44px =====
    console.log('\n=== scenario mobile 390 ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 390, height: 844 });
    {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check('B13-mobile: 无横向溢出', !overflow, `scrollW=${overflow}`);
      const rowH = await page.evaluate(() => { const els = document.querySelectorAll('[data-eid]'); return els.length ? Math.round(els[0].getBoundingClientRect().height) : 0; });
      check('B13-mobile: 事件行高度 ≥44px', rowH >= 44, `rowH=${rowH}`);
      const btnH = await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent || '').includes('加载')); return b ? Math.round(b.getBoundingClientRect().height) : 0; });
      check('B13-mobile: 加载按钮 ≥44px', btnH >= 44, `btnH=${btnH}`);
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-dark-390.png') });
    await closePage();

    // ===== scenario 7: reduced-motion 正常渲染 =====
    console.log('\n=== scenario reduced-motion ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 }, 'dark', true);
    {
      const e = await eids(page);
      const bodyText = await body(page);
      check('B13-reduced: 正常渲染 15 条', e.length === 15, `rows=${e.length}`);
      check('B13-reduced: 标题 实时动态 可见', bodyText.includes('实时动态'), 'has title');
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-reduced-motion.png') });
    await closePage();

    // ===== scenario 8: light 主题 =====
    console.log('\n=== scenario light theme ===');
    await ctl('reset?baseline=40');
    page = await openActivity({ width: 1440, height: 900 }, 'light');
    {
      const e = await eids(page);
      check('B13-light: 渲染 15 条', e.length === 15, `rows=${e.length}`);
    }
    await page.screenshot({ path: path.join(OUT, 'b13-activity-light-1440.png') });
    await closePage();
  } catch (err) {
    check('B13: 运行无异常', false, String(err && err.stack || err));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await wait(500);
  }

  fs.writeFileSync('/tmp/b13-activity-results.json', JSON.stringify(results, null, 2));
  console.log(`\nB13 Activity 验收: ${results.pass} PASS / ${results.fail} FAIL`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
