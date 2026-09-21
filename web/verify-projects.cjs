// B12 项目页验收 — 驱动真实 /next/ 构建 vs fixture-server (18123), 断言 §2 钩子
// 场景: error/empty/notasks/alldone/mixed + 跳转过滤 + light/390/reduced-motion
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 18123;
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

  async function openProjects(viewport, theme = 'dark', reduced = false) {
    page = await browser.newPage({ viewport });
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE + '#projects', { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate((th) => localStorage.setItem('wb_theme', th), theme);
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('#root', { timeout: 8000 });
    await wait(2500);
    return page;
  }
  const body = async (p) => p.textContent('body');
  const formulaTitles = async (p) => p.$$eval('main [title]', (els) => els.map((e) => e.getAttribute('title') || '').join(' | '));

  try {
    // ===== scenario: error (projects_ok=false) =====
    console.log('\n=== scenario error (projects_ok=false) ===');
    await ctl('projScenario?name=error');
    page = await openProjects({ width: 1440, height: 900 });
    let t = await body(page);
    check('error: 显「项目数据源不可用」', t.includes('项目数据源不可用'), (t.match(/项目数据源.{0,24}/) || ['missing'])[0]);
    check('error: 携带错误信息「数据库连接失败」', t.includes('数据库连接失败'), 'detail');
    check('error: 不伪装成「暂无项目」', !t.includes('暂无项目'), 'no empty-state lie');
    await page.screenshot({ path: `${OUT}/b12-projects-error-dark-1440.png` });
    await page.close();

    // ===== scenario: empty =====
    console.log('\n=== scenario empty ===');
    await ctl('projScenario?name=empty');
    page = await openProjects({ width: 1440, height: 900 });
    t = await body(page);
    check('empty: 显「暂无项目」', t.includes('暂无项目'), 'empty state');
    await page.screenshot({ path: `${OUT}/b12-projects-empty-dark-1440.png` });
    await page.close();

    // ===== scenario: notasks =====
    console.log('\n=== scenario notasks ===');
    await ctl('projScenario?name=notasks');
    page = await openProjects({ width: 1440, height: 900 });
    t = await body(page);
    check('notasks: 显「暂无任务」', t.includes('暂无任务'), 'no-task label');
    check('notasks: 无「共 N 个任务」徽章', !/共 \d+ 个任务/.test(t), 'no total badge');
    await page.screenshot({ path: `${OUT}/b12-projects-notasks-dark-1440.png` });
    await page.close();

    // ===== scenario: alldone =====
    console.log('\n=== scenario alldone ===');
    await ctl('projScenario?name=alldone');
    page = await openProjects({ width: 1440, height: 900 });
    t = await body(page);
    check('alldone: 显「关联任务已全部完成」', t.includes('关联任务已全部完成'), 'all-done label');
    check('alldone: 显「历史归档 1 项」', t.includes('历史归档 1 项'), 'archived note');
    let ta = await formulaTitles(page);
    check('alldone: 公式 title = 完成 2 / 未归档 2', ta.includes('完成 2 / 未归档 2'), ta.slice(0, 140));
    check('alldone: 页面不出现「100%」', !t.includes('100%'), 'no fake 100%');
    await page.screenshot({ path: `${OUT}/b12-projects-alldone-dark-1440.png` });
    await page.close();

    // ===== scenario: mixed =====
    console.log('\n=== scenario mixed ===');
    await ctl('projScenario?name=mixed');
    page = await openProjects({ width: 1440, height: 900 });
    t = await body(page);
    for (const [label, expect] of [['待办', 1], ['就绪', 1], ['进行中', 1], ['阻塞', 1], ['完成', 2]]) {
      check(`mixed: 徽章「${label} ${expect}」`, t.includes(`${label} ${expect}`), `badge ${label}`);
    }
    check('mixed: 无「归档」徽章', !t.includes('归档 1'), 'no archived badge');
    check('mixed: 进度文案「当前任务: 2/6 已完成」', t.includes('当前任务: 2/6 已完成'), 'progress text');
    ta = await formulaTitles(page);
    check('mixed: 公式 title = 完成 2 / 未归档 6', ta.includes('完成 2 / 未归档 6'), ta.slice(0, 140));
    check('mixed: 阻塞徽章出现', t.includes('阻塞 1'), 'blocked badge');
    await page.screenshot({ path: `${OUT}/b12-projects-mixed-dark-1440.png` });
    await page.close();

    // ===== scenario: jump → #tasks?project 过滤 =====
    console.log('\n=== scenario jump ===');
    await ctl('projScenario?name=mixed');
    page = await openProjects({ width: 1440, height: 900 });
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent && x.textContent.includes('查看本项目任务'));
      if (!b) return false; b.click(); return true;
    });
    check('jump: 找到「查看本项目任务」按钮', clicked);
    await wait(1800);
    const hash = await page.evaluate(() => location.hash);
    check('jump: hash 变为 tasks?project=proj_gamma', hash.includes('tasks') && hash.includes('project=proj_gamma'), 'hash=' + hash);
    t = await body(page);
    check('jump: 任务页显示 Gamma 运行任务', t.includes('进行中: Gamma 运行'), 'proj running');
    check('jump: 显示 Gamma 待办/就绪', t.includes('待办: Gamma 待办') && t.includes('就绪: Gamma 就绪'), 'proj todo/ready');
    check('jump: 排除已完成(当前工作不含 done)', !t.includes('完成: Gamma 任务一'), 'done excluded in active');
    await page.screenshot({ path: `${OUT}/b12-projects-jump-filter-dark-1440.png` });
    await page.close();

    // ===== light theme desktop 1440 (mixed) =====
    console.log('\n=== light theme 1440 (mixed) ===');
    await ctl('projScenario?name=mixed');
    page = await openProjects({ width: 1440, height: 900 }, 'light');
    t = await body(page);
    check('light: 项目卡片渲染 Gamma', t.includes('Gamma') && t.includes('多状态混合'), 'light renders');
    await page.screenshot({ path: `${OUT}/b12-projects-light-1440.png` });
    await page.close();

    // ===== mobile 390px (mixed) =====
    console.log('\n=== mobile 390px (mixed) ===');
    await ctl('projScenario?name=mixed');
    page = await openProjects({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('mobile: 无横向溢出(390px)', !overflow, overflow ? 'overflow' : 'ok');
    t = await body(page);
    check('mobile: 卡片渲染 Gamma', t.includes('Gamma'), 'mobile renders');
    const btnH = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent && x.textContent.includes('查看本项目任务'));
      return b ? b.getBoundingClientRect().height : 0;
    });
    check('mobile: 查看按钮触达高度≥44px', btnH >= 44, `h=${Math.round(btnH)}`);
    await page.screenshot({ path: `${OUT}/b12-projects-dark-390.png` });
    await page.close();

    // ===== reduced-motion =====
    console.log('\n=== reduced-motion ===');
    await ctl('projScenario?name=mixed');
    page = await openProjects({ width: 1440, height: 900 }, 'dark', true);
    t = await body(page);
    check('reduced-motion: 项目页正常渲染', t.includes('Gamma'), 'renders under reduce');
    await page.screenshot({ path: `${OUT}/b12-projects-reduced-motion.png` });
    await page.close();
  } catch (err) {
    console.error('TEST ERROR:', err.message);
    console.error((err.stack || '').split('\n').slice(0, 6).join('\n'));
  } finally {
    await browser.close();
    setTimeout(() => { try { server.kill('SIGTERM'); } catch (_) { } }, 500);
  }
  fs.writeFileSync('/tmp/b12-projects-results.json', JSON.stringify(results, null, 2));
  console.log(`\n=== B12 Projects: ${results.pass} PASS, ${results.fail} FAIL ===`);
  for (const it of results.items) console.log(`  ${it.ok ? 'PASS' : 'FAIL'} ${it.n}: ${it.d}`);
  process.exit(results.fail > 0 ? 1 : 0);
}
main().catch(console.error);
