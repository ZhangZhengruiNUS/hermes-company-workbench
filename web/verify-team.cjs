// B14 团队页验收 — 驱动真实 /next/ 构建 vs fixture-server (18125), 断言 spec §4 钩子
// 场景: 双线分组/secretary首位/摘要三态/头像404回退/三tab只读抽屉/soul 500错误态/组织切换/移动端/reduced-motion
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 18125;
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

  async function openTeam(viewport, theme = 'dark', reduced = false) {
    page = await browser.newPage({ viewport });
    page.on('request', (req) => { const u = req.url(); if (u.includes('/api/v1/profiles/')) profUrls.push(u); });
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE + '#team', { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate((th) => localStorage.setItem('wb_theme', th), theme);
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('#root', { timeout: 8000 });
    await wait(2500);
    return page;
  }
  const body = async (p) => p.textContent('body');
  const closePage = async () => { try { await page.close(); } catch (_) {} profUrls = []; };
  let profUrls = [];
  async function clickText(p, text, scope = 'body') {
    const els = await p.$$(`${scope} button, ${scope} [role="button"], ${scope} .pill, ${scope} [role="tab"]`);
    for (const el of els) {
      const t = (await el.textContent()) || '';
      if (t.includes(text)) { await el.click(); await wait(900); return true; }
    }
    return false;
  }

  try {
    // ===== scenario 1: 双线分组 + 组内计数 + secretary 运营线首位 =====
    console.log('\n=== scenario grouping (baseline) ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 });
    {
      const t = await body(page);
      check('B14-group: 显「运营线 · 2 岗」', t.includes('运营线 · 2 岗'), 'ops line');
      check('B14-group: 显「研发线 · 4 岗」', t.includes('研发线 · 4 岗'), 'rd line');
      // 组内 secretary 首位: 运营线内 secretary 卡在 pm 前
      const order = await page.$$eval('[role="button"]', (els) => els.map((e) => e.getAttribute('aria-label') || ''));
      const secIdx = order.findIndex((l) => l && l.includes('行政秘书'));
      const pmIdx = order.findIndex((l) => l && l.includes('项目经理'));
      check('B14-group: secretary 在运营线首位(先于 pm)', secIdx !== -1 && (pmIdx === -1 || secIdx < pmIdx), `sec=${secIdx} pm=${pmIdx} order=${order.join('|')}`);
      // 六位成员卡均渲染(2+4)
      const cards = await page.$$('[role="button"]');
      check('B14-group: 渲染 6 张成员卡', cards.length === 6, `cards=${cards.length}`);
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-members-dark-1440.png') });
    await closePage();

    // ===== scenario 2: 摘要三态(running 优先 / 最近 done / 暂无任务记录) + 脚注计数不混算 =====
    console.log('\n=== scenario summary three states ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 });
    {
      const t = await body(page);
      // frontend 有 running 任务 t_alpha → 当前任务 (优先于 done)
      check('B14-sum: frontend 显「当前任务」', t.includes('当前任务: 执行: Phase B 施工'), 'running priority');
      // frontend 脚注: running=1 done=1 → "1 项执行中 · 1 项完成"
      check('B14-sum: frontend 脚注 1 项执行中 · 1 项完成', t.includes('1 项执行中 · 1 项完成'), 'frontend footer');
      // backend 无 running 有 done(t_done2) → 最近任务
      check('B14-sum: backend 显「最近任务」', t.includes('最近任务: 完成: 基建搭建'), 'recent done');
      // secretary 无 running 无 done(scheduled/archived) → 暂无任务记录
      check('B14-sum: secretary 显「暂无任务记录」', t.includes('暂无任务记录'), 'no-task');
      // running 数不含 todo/blocked/triage: frontend 仅 1 running, 不得把 triage/scheduled 混入
      check('B14-sum: running 数=1(不含其它状态)', t.includes('1 项执行中'), 'running count exact');
      // done 不混算 archived: secretary 有 archived 但 done=0, 脚注显 "0 项完成"
      check('B14-sum: secretary done=0(archived 不混算)', t.includes('0 项完成'), 'archived excluded');
      // 默认模型 chip
      check('B14-sum: 显 默认模型 chip', t.includes('默认模型'), 'model chip');
    }
    await closePage();

    // ===== scenario 3: 头像 404 → 首字色块回退 =====
    console.log('\n=== scenario avatar 404 fallback ===');
    await ctl('reset?baseline=10');
    await ctl('avatarMiss?name=frontend&on=1');
    page = await openTeam({ width: 1440, height: 900 });
    {
      await wait(1500); // 等 img onError 触发
      // frontend 卡应出现色块首字 "前"(回退), 而非 <img>; 检测该卡内无 <img> 且有首字
      const hasFallback = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[role="button"]'));
        const fc = cards.find((c) => (c.getAttribute('aria-label') || '').includes('前端 详情'));
        if (!fc) return false;
        const img = fc.querySelector('img');
        const text = fc.textContent || '';
        return (!img) && text.includes('前');
      });
      check('B14-avatar: frontend 卡 404 回退首字色块', hasFallback, 'color-block fallback');
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-avatar-404-dark-1440.png') });
    await closePage();
    await ctl('avatarMiss?name=frontend&on=0');

    // ===== scenario 4: 抽屉三 tab 只读(SOUL sha+正文 / Skills 计数 / 配置脱敏+model) =====
    console.log('\n=== scenario drawer three tabs ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 });
    {
      const opened = await clickText(page, '行政秘书', 'main');
      check('B14-drawer: 点击成员卡打开抽屉', opened, 'open drawer');
      const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 6000 }).catch(() => null);
      check('B14-drawer: 出现对话框', !!dialog, 'dialog present');
      let t = await body(page);
      check('B14-drawer: 标题 实时数据', t.includes('实时数据'), 'drawer title');
      // SOUL tab (默认): sha 前 10 位 + 正文
      await wait(2000);
      t = await body(page);
      check('B14-drawer: SOUL 显 实时读取', t.includes('实时读取'), 'soul meta');
      check('B14-drawer: SOUL 显 sha 前 10 位(mono)', t.includes('abcdef1234'), 'sha10');
      check('B14-drawer: SOUL 正文出现', t.includes('的 SOUL'), 'soul body');
      const soulReq = profUrls.some((u) => u.includes('/profiles/secretary/soul'));
      check('B14-drawer: 请求 GET soul', soulReq, profUrls.join(' | '));
      await page.screenshot({ path: path.join(OUT, 'b14-team-drawer-soul-dark-1440.png') });
      // 切 Skills
      const skillsClicked = await clickText(page, 'Skills', '[role="dialog"]');
      check('B14-drawer: 切 Skills tab', skillsClicked, 'skills tab');
      await wait(2000);
      t = await body(page);
      check('B14-drawer: Skills 计数行 共 4 个 skill', t.includes('共 4 个 skill'), 'skills count');
      check('B14-drawer: Skills 显 已启用/已禁用', t.includes('已启用') && t.includes('已禁用'), 'skill states');
      // 切 配置
      const cfgClicked = await clickText(page, '配置', '[role="dialog"]');
      check('B14-drawer: 切 配置 tab', cfgClicked, 'config tab');
      await page.waitForFunction(() => {
        const tab = [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find((e) => e.textContent.includes('配置'));
        return tab && tab.getAttribute('aria-selected') === 'true';
      }, { timeout: 8000 }).catch(() => {});
      await wait(800);
      t = await body(page);
      check('B14-drawer: 配置 脱敏提示', t.includes('服务端已脱敏'), 'redacted note');
      await page.waitForFunction(() => document.body.textContent.includes('默认模型: gpt-4o'), { timeout: 8000 }).catch(() => {});
      t = await body(page);
      check('B14-drawer: 配置 默认模型', t.includes('默认模型: gpt-4o'), 'config model');
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-drawer-config-dark-1440.png') });
    // Esc 关闭 + 焦点归还
    {
      await page.keyboard.press('Escape');
      await wait(700);
      const dlg = await page.$('[role="dialog"]');
      check('B14-drawer: Esc 关闭抽屉', !dlg, 'esc closed');
    }
    await closePage();

    // ===== scenario 5: soul 接口 500 → 抽屉内错误态非白屏 =====
    console.log('\n=== scenario soul 500 error state ===');
    await ctl('reset?baseline=10');
    await ctl('memberFail?name=secretary&which=soul&on=1');
    page = await openTeam({ width: 1440, height: 900 });
    {
      await clickText(page, '行政秘书', 'main');
      const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 6000 }).catch(() => null);
      await wait(1200);
      const t = await body(page);
      check('B14-soul500: 抽屉仍打开(非白屏)', !!dialog, 'dialog open');
      check('B14-soul500: 显示 加载失败 + 500', t.includes('加载失败') && t.includes('500'), 'error text');
      check('B14-soul500: 无 SOUL 正文占位泄漏', !t.includes('的 SOUL'), 'no fake body');
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-soul-500-dark-1440.png') });
    await closePage();
    await ctl('memberFail?name=secretary&which=soul&on=0');

    // ===== scenario 6: 组织 tab 切换往返不丢成员 tab 状态 =====
    console.log('\n=== scenario org tab round-trip ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 });
    {
      // 先切到组织
      const orgClicked = await clickText(page, '组织', 'main');
      check('B14-org: 切到组织 tab', orgClicked, 'org tab');
      let t = await body(page);
      check('B14-org: 标题 Hermes Company · 6 岗 · 2 部门', t.includes('Hermes Company · 6 岗 · 2 部门'), 'org title');
      check('B14-org: 两线节标题', t.includes('运营线') && t.includes('研发线'), 'org line sections');
      check('B14-org: 成员胶囊(中文+英文名)', t.includes('行政秘书') && t.includes('secretary') && t.includes('前端') && t.includes('frontend'), 'org capsules');
      await page.screenshot({ path: path.join(OUT, 'b14-team-org-dark-1440.png') });
      // 切回成员
      const backClicked = await clickText(page, '成员', 'main');
      check('B14-org: 切回成员 tab', backClicked, 'back to members');
      t = await body(page);
      check('B14-org: 成员状态不丢(仍显 运营线 · 2 岗)', t.includes('运营线 · 2 岗'), 'members state retained');
    }
    await closePage();

    // ===== scenario 7: mobile 390 无横向溢出 + tab/成员卡触控目标 ≥44px =====
    console.log('\n=== scenario mobile 390 ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 390, height: 844 });
    {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check('B14-mobile: 无横向溢出', !overflow, `scrollW=${overflow}`);
      const tabH = await page.evaluate(() => { const b = [...document.querySelectorAll('main [role="tab"]')].find((x) => (x.textContent || '').includes('成员')); return b ? Math.round(b.getBoundingClientRect().height) : 0; });
      check('B14-mobile: 双 tab 触控高度 ≥44px', tabH >= 44, `tabH=${tabH}`);
      const cardH = await page.evaluate(() => { const b = document.querySelector('main [role="button"]'); return b ? Math.round(b.getBoundingClientRect().height) : 0; });
      check('B14-mobile: 成员卡 ≥44px', cardH >= 44, `cardH=${cardH}`);
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-dark-390.png') });
    await closePage();

    // ===== scenario 8: reduced-motion 正常渲染 =====
    console.log('\n=== scenario reduced-motion ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 }, 'dark', true);
    {
      const t = await body(page);
      check('B14-reduced: 正常渲染成员', t.includes('运营线 · 2 岗') && t.includes('研发线 · 4 岗'), 'renders under reduce');
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-reduced-motion.png') });
    await closePage();

    // ===== scenario 9: light 主题 =====
    console.log('\n=== scenario light theme ===');
    await ctl('reset?baseline=10');
    page = await openTeam({ width: 1440, height: 900 }, 'light');
    {
      const t = await body(page);
      check('B14-light: 团队页渲染', t.includes('运营线 · 2 岗') && t.includes('研发线 · 4 岗'), 'renders light');
    }
    await page.screenshot({ path: path.join(OUT, 'b14-team-light-1440.png') });
    await closePage();
  } catch (err) {
    check('B14: 运行无异常', false, String(err && err.stack || err));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await wait(500);
  }

  fs.writeFileSync('/tmp/b14-team-results.json', JSON.stringify(results, null, 2));
  console.log(`\nB14 Team 验收: ${results.pass} PASS / ${results.fail} FAIL`);
  for (const it of results.items) console.log(`  ${it.ok ? 'PASS' : 'FAIL'} ${it.n}: ${it.d}`);
  process.exit(results.fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
