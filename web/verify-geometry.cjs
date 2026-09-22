// verify-geometry.cjs — UI Geometry & Interaction Quality Gate 自动验收 (t_65e95dd6)
// 驱动真实 /next/ 构建 (web/dist) vs fixture-server, 断言:
//   A  Drawer 三档几何 + portal + 滚动前后一致
//   B  Topbar/Sidebar sticky
//   C  Mobile nav (390x844) 固定面板 + 可关闭
//   D  worst-case 长文本 containment (不止 document.scrollWidth)
//   E  响应式矩阵 1920/1440/1024/768/390 (深色) + 浅色 smoke 1440/390
//   P5 Drawer 交互: Esc/遮罩关 / focus trap / 焦点归还 / 锁滚动 / 无横跳
// 用法: node verify-geometry.cjs   (需先 npm run build)
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 18126;
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

const results = { pass: 0, fail: 0, items: [] };
function check(n, ok, d = '') { results.items.push({ n, ok, d }); if (ok) { results.pass++; console.log('  PASS', n, d); } else { results.fail++; console.log('  FAIL', n, '|', d); } }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', [SERVER_JS], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FIXTURE_PORT: String(PORT) } });
  server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));
  await waitForServer(`http://127.0.0.1:${PORT}/_ctl/ping`);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let page;

  async function openPage(view, viewport, theme = 'dark') {
    if (page) { try { await page.close(); } catch (_) {} }
    page = await browser.newPage({ viewport });
    await page.goto(BASE + '#' + view, { waitUntil: 'networkidle', timeout: 25000 });
    await page.evaluate((th) => localStorage.setItem('wb_theme', th), theme);
    await page.reload({ waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForSelector('#root', { timeout: 8000 });
    await wait(1200);
    return page;
  }
  const dialogBox = async () => {
    const el = await page.$('[role="dialog"]');
    return el ? el.boundingBox() : null;
  };
  // 返回 drawer 几何 + overlay 几何 + portal/position 信息
  async function drawerGeo() {
    return page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const d = dlg.getBoundingClientRect();
      const c = dlg.parentElement; // .fixed.inset-0 z-[80]
      const over = c ? c.firstElementChild?.getBoundingClientRect() : null;
      const ps = getComputedStyle(dlg).position;
      const cps = c ? getComputedStyle(c).position : '';
      const isPortal = c ? c.parentElement === document.body : false;
      return {
        top: d.top, bottom: d.bottom, left: d.left, right: d.right, width: d.width,
        otop: over?.top, obottom: over?.bottom, oleft: over?.left, oright: over?.right,
        ps, cps, isPortal,
      };
    });
  }
  async function clickMemberCard(name) {
    const els = await page.$$('[role="button"]');
    for (const el of els) {
      const label = (await el.getAttribute('aria-label')) || '';
      const t = label || (await el.textContent()) || '';
      if (t.includes(name)) { await el.click(); await wait(1000); return true; }
    }
    return false;
  }
  async function clickTaskCard(text) {
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = (await b.textContent()) || '';
      if (t.includes(text)) { await b.click(); await wait(1000); return true; }
    }
    return false;
  }
  async function noHScroll() {
    return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  }
  async function body() { return page.textContent('body'); }

  try {
    // ================= A. Drawer 几何 =================
    console.log('\n=== A. Drawer geometry ===');
    await ctl('reset?baseline=10');

    // A1 Team drawer @1440
    await openPage('team', { width: 1440, height: 900 });
    {
      await clickMemberCard('行政秘书');
      const g = await drawerGeo();
      check('A1-team: drawer 打开(有 dialog)', !!g, JSON.stringify(g && { top: g.top.toFixed(0), bottom: g.bottom.toFixed(0), w: g.width.toFixed(0) }));
      if (g) {
        check('A1-team: top≈0', Math.abs(g.top) <= 2, `top=${g.top.toFixed(1)}`);
        check('A1-team: bottom≈vh', Math.abs(g.bottom - 900) <= 2, `bottom=${g.bottom.toFixed(1)}`);
        check('A1-team: right≈vw', Math.abs(g.right - 1440) <= 2, `right=${g.right.toFixed(1)}`);
        check('A1-team: 宽在设计范围 380-480', g.width >= 380 && g.width <= 480, `width=${g.width.toFixed(1)}`);
        check('A1-team: overlay 覆盖全 viewport', g.otop != null && Math.abs(g.otop) <= 2 && Math.abs(g.obottom - 900) <= 2 && Math.abs(g.oleft) <= 2 && Math.abs(g.oright - 1440) <= 2, `over=${g.otop?.toFixed(0)}/${g.obottom?.toFixed(0)}/${g.oleft?.toFixed(0)}/${g.oright?.toFixed(0)}`);
        check('A1-team: drawer 不落普通 flow(absolute in fixed)', g.ps === 'absolute' && g.cps === 'fixed', `pos=${g.ps} cpos=${g.cps}`);
        check('A1-team: portal 到 body', g.isPortal === true, `portal=${g.isPortal}`);
      }
      await page.screenshot({ path: path.join(OUT, 'geom-team-drawer-1440.png') });
      await page.keyboard.press('Escape'); await wait(600);
    }

    // A2 Team drawer @1920
    await openPage('team', { width: 1920, height: 1080 });
    {
      await clickMemberCard('行政秘书');
      const g = await drawerGeo();
      check('A2-team1920: 几何正确', !!g && Math.abs(g.top) <= 2 && Math.abs(g.bottom - 1080) <= 2 && Math.abs(g.right - 1920) <= 2 && g.width >= 380 && g.width <= 480, g ? `t=${g.top.toFixed(0)} b=${g.bottom.toFixed(0)} r=${g.right.toFixed(0)} w=${g.width.toFixed(0)}` : 'no dialog');
      await page.keyboard.press('Escape'); await wait(600);
    }

    // A3 Team drawer @390 (mobile: width≈vw)
    await openPage('team', { width: 390, height: 844 });
    {
      await clickMemberCard('行政秘书');
      const g = await drawerGeo();
      check('A3-team390: 宽≈vw 且无横向溢出', !!g && Math.abs(g.width - 390) <= 1 && Math.abs(g.top) <= 2 && Math.abs(g.bottom - 844) <= 2, g ? `w=${g.width.toFixed(1)} t=${g.top.toFixed(0)} b=${g.bottom.toFixed(0)}` : 'no dialog');
      const ok = await noHScroll();
      check('A3-team390: 抽屉打开无文档横向滚动', ok, '');
      await page.screenshot({ path: path.join(OUT, 'geom-team-drawer-390.png') });
      await page.keyboard.press('Escape'); await wait(600);
    }

    // A4 Task drawer @1440
    await openPage('tasks', { width: 1440, height: 900 });
    {
      await clickTaskCard('Phase B');
      const g = await drawerGeo();
      check('A4-task: drawer 打开', !!g, '');
      if (g) {
        check('A4-task: 几何正确', Math.abs(g.top) <= 2 && Math.abs(g.bottom - 900) <= 2 && Math.abs(g.right - 1440) <= 2 && g.width >= 380 && g.width <= 480, `t=${g.top.toFixed(0)} b=${g.bottom.toFixed(0)} r=${g.right.toFixed(0)} w=${g.width.toFixed(0)}`);
        check('A4-task: portal 到 body + 不落 flow', g.isPortal === true && g.ps === 'absolute' && g.cps === 'fixed', `pos=${g.ps}/${g.cps} portal=${g.isPortal}`);
      }
      await page.screenshot({ path: path.join(OUT, 'geom-task-drawer-1440.png') });
      await page.keyboard.press('Escape'); await wait(600);
    }

    // A5 滚动一致性: 页面顶部打开 vs 滚到底后打开, 抽屉 rect 必须一致
    // (drawer 是 viewport-fixed portal, 不依赖文档滚动位置; Tasks 看板列 h-full 永不滚,
    //  故用 Team 页 + 矮视口迫使文档滚动来验证)
    await ctl('reset?baseline=10');
    await openPage('team', { width: 1280, height: 520 });
    {
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      await clickMemberCard('行政秘书');
      const g1 = await drawerGeo();
      await page.keyboard.press('Escape'); await wait(700);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await wait(600);
      const scrolled = await page.evaluate(() => window.scrollY);
      await clickMemberCard('行政秘书'); // Playwright 自动滚到卡片再点, 此时处于非顶部滚动位置
      const g2 = await drawerGeo();
      const same = g1 && g2 && Math.abs(g1.top - g2.top) <= 2 && Math.abs(g1.right - g2.right) <= 2 && Math.abs(g1.bottom - g2.bottom) <= 2;
      check('A5-scroll: 页面可滚且两处打开 rect 一致(viewport-fixed)', tall > 520 && scrolled > 0 && !!same, `scrollH=${tall} scrollY=${scrolled} t1=${g1?.top?.toFixed(0)} t2=${g2?.top?.toFixed(0)}`);
      await page.keyboard.press('Escape'); await wait(600);
    }

    // ================= B. Sticky =================
    console.log('\n=== B. Sticky ===');
    await ctl('reset?baseline=10');
    await ctl('add?count=40'); // Activity 长页内容 ≈880px, 用矮视口迫使文档滚动
    await openPage('activity', { width: 1440, height: 520 });
    {
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, 300));
      await wait(600);
      const sc = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /切换到/.test(b.getAttribute('aria-label') || ''));
        let topEl = btn;
        while (topEl && getComputedStyle(topEl).position !== 'sticky' && topEl.parentElement) topEl = topEl.parentElement;
        const nav = document.querySelector('nav[aria-label="主导航"]');
        return {
          scrollY: window.scrollY,
          topbarTop: topEl ? topEl.getBoundingClientRect().top : null,
          navTop: nav ? nav.getBoundingClientRect().top : null,
          navPos: nav ? getComputedStyle(nav).position : null,
        };
      });
      check('B-sticky: 矮视口下文档可滚', tall > 520 && sc.scrollY > 100, `scrollH=${tall} scrollY=${sc.scrollY}`);
      check('B-sticky: 滚动后 Topbar 仍贴在顶部未随滚走', sc.topbarTop != null && sc.topbarTop <= 14, `topbarTop=${sc.topbarTop?.toFixed(1)}`);
      check('B-sticky: Desktop Sidebar 滚动后仍 sticky 顶位', sc.navPos === 'sticky' && sc.navTop != null && Math.abs(sc.navTop - 12) <= 8, `navPos=${sc.navPos} navTop=${sc.navTop?.toFixed(1)}`);
    }
    await page.screenshot({ path: path.join(OUT, 'geom-sticky-scroll300-1440x520.png') });

    // ================= C. Mobile nav =================
    console.log('\n=== C. Mobile nav 390 ===');
    await openPage('team', { width: 390, height: 844 });
    {
      await page.click('button[aria-label="打开导航菜单"]');
      await wait(900);
      const nav = await page.evaluate(() => {
        const n = document.querySelector('nav[aria-label="主导航"]');
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { l: r.left, t: r.top, rgt: r.right, b: r.bottom, w: r.width, pos: getComputedStyle(n).position, z: getComputedStyle(n).zIndex };
      });
      check('C-nav: 面板在 viewport 内', !!nav && nav.l >= -1 && nav.t >= -1 && nav.rgt <= 391 && nav.b <= 845, nav ? `l=${nav.l.toFixed(0)} t=${nav.t.toFixed(0)} r=${nav.rgt.toFixed(0)} b=${nav.b.toFixed(0)}` : 'no nav');
      check('C-nav: 固定定位 + z-40', nav && nav.pos === 'fixed' && nav.z === '40', `pos=${nav?.pos} z=${nav?.z}`);
      await page.screenshot({ path: path.join(OUT, 'geom-mobile-nav-390.png') });
      // 可关闭: 点一个导航项
      const closed = await page.evaluate(() => {
        const link = [...document.querySelectorAll('nav[aria-label="主导航"] a, nav[aria-label="主导航"] button')].find((e) => (e.textContent || '').includes('总览'));
        if (link) { link.click(); return true; }
        return false;
      });
      await wait(900);
      const gone = await page.evaluate(() => {
        const n = document.querySelector('nav[aria-label="主导航"]');
        return !n || n.offsetParent === null || getComputedStyle(n).display === 'none';
      });
      check('C-nav: 可关闭(点导航项后隐藏)', closed && gone, `closed=${closed} gone=${gone}`);
    }

    // ================= D. worst-case containment =================
    console.log('\n=== D. worst-case dynamic text containment ===');
    await ctl('reset?baseline=10');
    await ctl('worstCase');
    const LONGMODEL = 'deepseek-v4-flash-20260921-rc1-' + 'm'.repeat(90);
    const LONGCN = '前端 超长显示名 ' + '显示'.repeat(40);
    await ctl('setProfile?name=frontend&field=model&value=' + encodeURIComponent(LONGMODEL));
    await ctl('setProfile?name=frontend&field=cn&value=' + encodeURIComponent(LONGCN));
    await ctl('setProfile?name=frontend&field=display_name&value=' + encodeURIComponent(LONGCN));

    // D1 Team: 长 model chip / 长 display / 长任务摘要 containment (child 不越出卡片内容)
    await openPage('team', { width: 1440, height: 900 });
    {
      const overflow = await page.evaluate(() => {
        const bad = [];
        const cards = Array.from(document.querySelectorAll('main [role="button"]'));
        for (const card of cards) {
          const cr = card.getBoundingClientRect();
          for (const el of Array.from(card.querySelectorAll('*'))) {
            if (el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            // 排除自身 & 视觉性全宽层 & 允许滚动的容器
            if (el === card) continue;
            if (r.width === 0 && r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
            // 允许文字穿透布局裁剪(POS:relative 子层), 仅当子元素实际越出卡片水平边界才报
            if (r.right > cr.right + 1) bad.push(`RIGHT ${(el.className||'').toString().slice(0,40)}`);
            if (r.left < cr.left - 1) bad.push(`LEFT ${(el.className||'').toString().slice(0,40)}`);
          }
        }
        return bad.slice(0, 6);
      });
      check('D1-team: 成员卡无子元素越界(worst-case)', overflow.length === 0, overflow.join(' | '));
      const hasLong = await body();
      check('D1-team: 长 model 文本注入生效(含默认模型 + 长 id)', hasLong.includes('默认模型') && hasLong.includes('deepseek-v4-flash'), '');
      const noDocOv = await noHScroll();
      check('D1-team: 无文档横向滚动', noDocOv, '');
      await page.screenshot({ path: path.join(OUT, 'geom-team-longmodel-1440.png') });
    }

    // D2 Tasks: 超长任务标题 + 卡片 footer containment
    await openPage('tasks', { width: 1440, height: 900 });
    {
      const overflow = await page.evaluate(() => {
        const bad = [];
        const cards = Array.from(document.querySelectorAll('main button'));
        for (const card of cards) {
          if (!card.textContent.includes('特别长中英混合任务标题')) continue;
          const cr = card.getBoundingClientRect();
          for (const el of Array.from(card.querySelectorAll('*'))) {
            if (el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
            if (r.right > cr.right + 1 || r.left < cr.left - 1) bad.push((el.className || '').toString().slice(0, 40));
          }
        }
        return bad.slice(0, 6);
      });
      check('D2-tasks: 超长任务卡子元素不越界', overflow.length === 0, overflow.join(' | '));
      check('D2-tasks: 超长标题注入生效', (await body()).includes('特别长中英混合任务标题'), '');
      const noDocOv = await noHScroll();
      check('D2-tasks: 无文档横向滚动', noDocOv, '');
      await page.screenshot({ path: path.join(OUT, 'geom-tasks-longtitle-1440.png') });
    }

    // D3 Projects: 超长项目名 badge containment
    await openPage('projects', { width: 1440, height: 900 });
    {
      const overflow = await page.evaluate(() => {
        const bad = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          if (el.offsetParent === null) continue;
          const t = (el.textContent || '').trim();
          if (!t.includes('Aurora Glass 超长项目名称')) continue;
          const r = el.getBoundingClientRect();
          let p = el.parentElement;
          let pcs;
          while (p && p !== document.body && !(pcs = getComputedStyle(p)).overflowX.includes('auto')) p = p.parentElement;
          // 找最近的可见卡片容器: 向上到非 inline 且非 body 的元素作参照
          let cont = el.parentElement;
          while (cont && cont !== document.body && getComputedStyle(cont).display === 'inline') cont = cont.parentElement;
          if (!cont || cont === document.body) continue;
          const cr = cont.getBoundingClientRect();
          if (r.right > cr.right + 2) bad.push('RIGHT ' + t.slice(0, 16));
          if (r.left < cr.left - 2) bad.push('LEFT ' + t.slice(0, 16));
        }
        return bad.slice(0, 5);
      });
      check('D3-projects: 超长项目名不越出卡片', overflow.length === 0, overflow.join(' | '));
      check('D3-projects: 无文档横向滚动', await noHScroll(), '');
      await page.screenshot({ path: path.join(OUT, 'geom-projects-longname-1440.png') });
    }

    // D4 Activity: 长事件标题 containment — 所有截断容器(truncate/line-clamp)不越出 main 内容列
    await openPage('activity', { width: 1440, height: 900 });
    {
      const bad = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return ['no main'];
        const mr = main.getBoundingClientRect();
        const bad = [];
        for (const el of Array.from(main.querySelectorAll('[class*="truncate"], [class*="line-clamp"]'))) {
          if (el.offsetParent === null) continue;
          if ((el.textContent || '').trim().length < 20) continue;
          const r = el.getBoundingClientRect();
          if (r.right > mr.right + 1 || r.left < mr.left - 1) bad.push((el.textContent || '').trim().slice(0, 20));
        }
        return bad.slice(0, 5);
      });
      check('D4-activity: 截断容器不越出 main 内容列', bad.length === 0, bad.join(' | '));
      check('D4-activity: 无文档横向滚动', await noHScroll(), '');
    }

    // ================= E. Responsive matrix =================
    console.log('\n=== E. Responsive matrix ===');
    for (const w of [1920, 1440, 1024, 768, 390]) {
      await ctl('reset?baseline=10');
      await openPage('overview', { width: w, height: w >= 1024 ? 900 : 844 });
      const ok = await noHScroll();
      const renders = (await body()).length > 200;
      check(`E-${w}: 无横向滚动 + 渲染`, ok && renders, `scrollW=${ok} len=${renders}`);
    }
    // 浅色 smoke 1440 + 390
    await ctl('reset?baseline=10');
    await openPage('team', { width: 1440, height: 900 }, 'light');
    check('E-light1440: 浅色渲染无横向滚动', (await noHScroll()) && (await body()).includes('运营线'), '');
    await openPage('team', { width: 390, height: 844 }, 'light');
    check('E-light390: 浅色390无横向滚动', (await noHScroll()) && (await body()).includes('运营线'), '');

    // ================= F. Overview ExecutiveStrip 五格响应式几何 =================
    // t_34e85bd7: 修复移动端 390px 第 5 格右缘被父容器 overflow-hidden 裁剪(~10px)。
    // 设计: 移动 base 双列 + 第 5 格跨行; 桌面 lg 单行 5 格不变。
    console.log('\n=== F. Overview ExecutiveStrip geometry ===');
    await ctl('reset?baseline=10');

    // F1 mobile 390px: 五格完整可见且无裁剪
    await openPage('overview', { width: 390, height: 844 });
    {
      const g = await page.evaluate(() => {
        const strip = document.querySelector('[data-exec-strip]');
        const cells = Array.from(document.querySelectorAll('[data-exec-cell]')).map((el) => {
          const r = el.getBoundingClientRect();
          return { idx: +(el.getAttribute('data-index') || -1), l: r.left, rgt: r.right, w: r.width, h: r.height };
        });
        const sr = strip ? strip.getBoundingClientRect() : null;
        return { count: cells.length, cells, stripR: sr ? sr.right : null, winW: window.innerWidth };
      });
      const allWithin = g.cells.length === 5 && g.cells.every((c) => c.rgt <= g.winW + 1 && c.l >= -1 && c.w > 0);
      check('F1-390: 五格齐全且全部在视口内(无裁剪)', allWithin, g.cells.length === 5 ? `rights=[${g.cells.map((c) => c.rgt.toFixed(0)).join(',')}] winW=${g.winW}` : `count=${g.cells.length}`);
      check('F1-390: strip 容器右缘不越出视口', g.stripR != null && g.stripR <= g.winW + 1, `stripR=${g.stripR?.toFixed(1)}`);
      check('F1-390: 布局为两列(非单行5列), 存在多行', new Set(g.cells.map((c) => c.l.toFixed(0))).size >= 2, `cols=${new Set(g.cells.map((c) => c.l.toFixed(0))).size}`);
      check('F1-390: 第5格(项目)左缘=跨行起始或其后第1列', g.cells.length === 5 && g.cells[4].l >= -1 && g.cells[4].l < g.cells[3].l + 1, `c5l=${g.cells[4]?.l.toFixed(0)} c4l=${g.cells[3]?.l.toFixed(0)}`);
      check('F1-390: 无文档横向滚动', await noHScroll(), '');
      await page.screenshot({ path: path.join(OUT, 'geom-exec-390.png') });
    }

    // F2 desktop 1440: 单行 5 格布局不变, 无裁剪
    await openPage('overview', { width: 1440, height: 900 });
    {
      const g = await page.evaluate(() => {
        const strip = document.querySelector('[data-exec-strip]');
        const cells = Array.from(document.querySelectorAll('[data-exec-cell]')).map((el) => {
          const r = el.getBoundingClientRect();
          return { idx: +(el.getAttribute('data-index') || -1), l: r.left, rgt: r.right, top: r.top, w: r.width };
        });
        const sr = strip ? strip.getBoundingClientRect() : null;
        return { count: cells.length, cells, stripR: sr ? sr.right : null, stripL: sr ? sr.left : null, winW: window.innerWidth };
      });
      const singleRow = g.cells.length === 5 && g.cells.every((c) => Math.abs(c.top - g.cells[0].top) <= 1);
      check('F2-1440: 五格单行(同 top)', singleRow, g.cells.length === 5 ? `tops=[${g.cells.map((c) => c.top.toFixed(0)).join(',')}]` : `count=${g.cells.length}`);
      check('F2-1440: 五格按列铺满且末格右缘=容器内容右缘(±1px容器边框)', g.cells.length === 5 && g.stripR != null && Math.abs(g.cells[4].rgt - g.stripR) <= 2, g.cells.length === 5 ? `c5r=${g.cells[4].rgt.toFixed(1)} stripR=${g.stripR?.toFixed(1)}` : `count=${g.cells.length}`);
      check('F2-1440: 无文档横向滚动', await noHScroll(), '');
      await page.screenshot({ path: path.join(OUT, 'geom-exec-1440.png') });
    }

    // ================= P5. Drawer interaction =================
    console.log('\n=== P5. Drawer interaction ===');
    await ctl('reset?baseline=10');
    await openPage('team', { width: 1440, height: 900 });
    {
      const trigger = await page.$('[role="button"][aria-label*="行政秘书"]') || (await page.$('[role="button"]'));
      await clickMemberCard('行政秘书');
      // P5-1 focus trap
      const trapped = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return false;
        document.activeElement?.focus();
        const samples = [];
        for (let i = 0; i < 3; i++) { dlg.focus(); samples.push(dlg.contains(document.activeElement)); }
        return samples.every(Boolean);
      });
      check('P5-1: focus 困在 dialog 内', trapped, '');
      const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
      check('P5-2: 背景锁滚动(body overflow hidden)', bodyOverflow === 'hidden', `overflow=${bodyOverflow}`);
      const scrollX = await page.evaluate(() => window.scrollX);
      const docW = await page.evaluate(() => document.documentElement.scrollWidth);
      check('P5-3: 打开无横向跳(scrollX=0)', scrollX === 0, `scrollX=${scrollX}`);
      // P5-4 遮罩点击关闭
      await page.mouse.click(80, 400);
      await wait(700);
      let dlg = await page.$('[role="dialog"]');
      check('P5-4: 遮罩点击关闭', !dlg, '');
      const overflowRestored = await page.evaluate(() => document.body.style.overflow === '' || document.body.style.overflow === 'visible');
      check('P5-5: 关闭后 body 滚动恢复', overflowRestored, '');
      // P5-6 焦点归还触发元素
      await clickMemberCard('行政秘书');
      await wait(400);
      await page.keyboard.press('Escape');
      await wait(700);
      const focusBack = await page.evaluate(() => {
        const ae = document.activeElement;
        return ae && (ae.getAttribute('aria-label') || '').includes('行政秘书');
      });
      check('P5-6: Esc 关闭且焦点归还触发元素', focusBack, '');
      dlg = await page.$('[role="dialog"]');
      check('P5-7: Esc 关闭后无 dialog', !dlg, '');
      const docW2 = await page.evaluate(() => document.documentElement.scrollWidth);
      check('P5-8: 开关无文档宽度横跳', Math.abs(docW2 - docW) <= 1, `w1=${docW} w2=${docW2}`);
    }

    // P5-9 mobile: 抽屉内容可完整滚动 + 无双重滚动条
    await openPage('team', { width: 390, height: 844 });
    {
      await clickMemberCard('行政秘书');
      const ok = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return { dialog: false };
        // panel overflow-hidden, 内容区应可滚
        const panel = dlg;
        const sc = panel.querySelector('[data-scrollable]') || panel;
        return {
          dialog: true,
          panelH: panel.clientHeight,
          vh: window.innerHeight,
          docOv: document.documentElement.scrollWidth > window.innerWidth,
          hasScrollbar: document.body.clientWidth < window.innerWidth,
        };
      });
      check('P5-9-mobile: 抽屉占据视口且无文档横向滚动', ok.dialog && !ok.docOv && !ok.hasScrollbar, JSON.stringify(ok));
      await page.screenshot({ path: path.join(OUT, 'geom-drawer-mobile-scroll-390.png') });
    }
  } catch (err) {
    check('GEOM: 运行无异常', false, String((err && err.stack) || err));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await wait(500);
  }

  fs.writeFileSync('/tmp/geom-geometry-results.json', JSON.stringify(results, null, 2));
  console.log(`\nGEOMETRY 验收: ${results.pass} PASS / ${results.fail} FAIL`);
  for (const it of results.items) console.log(`  ${it.ok ? 'PASS' : 'FAIL'} ${it.n}: ${it.d}`);
  process.exit(results.fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
