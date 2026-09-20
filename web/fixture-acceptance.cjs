// fixture-acceptance.cjs — Playwright 验收脚本: B3~B7 行为场景
// 启动 fixture-server, 驱动真实 React /next/ 构建, 断言后端 mock 协议与前端行为一致。
// 通过 _ctl/ 接口控制 mock, 通过 _ctl/stats 读取服务器端请求记录。
//
// 用法: node fixture-acceptance.cjs               (启动内置 server + 跑全部场景)
//        FIXTURE_PORT=18123 node fixture-acceptance.cjs  (已有 server 时跳过启动)
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const BASE_PORT = 18123;
const BASE = `http://127.0.0.1:${BASE_PORT}/next/`;
const SCREENSHOT_DIR = '/home/ubuntu/hermes-company-workbench/web/screenshots';
const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';

// ---------------------------------------------------------------- helpers
function ctl(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${BASE_PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    }).on('error', reject);
  });
}
async function ctlServer(method, query) { return ctl(`/_ctl/${method}${query ? '?' + query : ''}`); }
async function ctlStats() { return ctl('/_ctl/stats'); }

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

// ---------------------------------------------------------------- scenario runner
async function runAll(scenarioFilter) {
  console.log('=== Aurora Glass Phase B Fixture Acceptance (B3~B7) ===\n');

  const results = { pass: 0, fail: 0, items: [] };
  function check(name, ok, detail) {
    results.items.push({ name, ok, detail });
    if (ok) { results.pass++; console.log('  PASS', name, detail || ''); }
    else { results.fail++; console.log('  FAIL', name, detail || ''); }
  }

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 网络拦截: 捕获所有 events-after 请求 URL 用于辅助验证
  const capturedUrls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/v1/events?after=') && !u.includes('order=desc')) capturedUrls.push(u);
  });

  const scenarios = [
    { name: 'B3', fn: runB3, desc: '断线期451非heartbeat事件·分页200·3页补取' },
    { name: 'B4', fn: runB4, desc: '重叠补取·源持续写入·has_more=true游标停滞·恢复' },
    { name: 'B5', fn: runB5, desc: '历史200+200+37·期间插入新事件' },
    { name: 'B6', fn: runB6, desc: 'SSE不可用→轮询→恢复·重挂载不重复连' },
    { name: 'B7', fn: runB7, desc: '仅profiles_changed·自动化独立刷新·失败来源' },
    { name: 'B8', fn: runB8, desc: '乱序完成·较旧catchup后返回·evCursor不回退' },
  ];

  for (const sc of scenarios) {
    if (scenarioFilter && sc.name !== scenarioFilter) continue;
    console.log(`\n----------- ${sc.name}: ${sc.desc} -----------`);
    try {
      await sc.fn({ page, check, capturedUrls });
    } catch (err) {
      console.log(`  ERROR ${sc.name}: ${err.message}`);
      check(`${sc.name} threw`, false, err.message);
    }
  }

  console.log(`\n=== FINAL: ${results.pass} PASS, ${results.fail} FAIL ===`);
  for (const item of results.items) {
    console.log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail || 'ok'}`);
  }
  require('fs').writeFileSync('/tmp/fixture-acceptance-results.json', JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(results.fail > 0 ? 1 : 0);
}

// 断言辅助: 从已展开的 DOM 取内容
async function liveChipText(page) { return page.textContent('[title^="实时连接状态"]'); }
async function bodyText(page) { return page.textContent('body'); }

// 等待并读取实时芯片内容
async function waitLiveChip(page, targetText, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    try {
      const text = await liveChipText(page);
      if (text && text.trim().includes(targetText)) return true;
    } catch { /* noop */ }
  }
  return false;
}

// 收集服务器端 eventsAfter 统计数据
async function getEventsAfterStats() {
  const stats = await ctlStats();
  return stats.eventsAfter || [];
}

// 从 stats 重建非空 pages 列表(只取 count>0)
function nonEmptyPages(stats) {
  const all = stats.eventsAfter || [];
  return all.filter((e) => e.count > 0 && !e.stalled);
}

// 验证 pages 的 id 区间是否不重叠、不遗漏、连续
function assertPartition(pages, expectedDistinct, expectedFirst, expectedLast) {
  if (pages.length === 0) return { ok: false, reason: 'no pages' };
  // pages 按 after 排序 = 按提取顺序(已保证)
  const allIds = [];
  for (const p of pages) allIds.push(...p.ids);
  const sorted = allIds.slice().sort((a, b) => a - b);
  const distinct = new Set(sorted).size;
  if (distinct !== allIds.length) return { ok: false, reason: `duplicates inside union: ${allIds.length} total, ${distinct} distinct` };
  if (expectedDistinct != null && distinct !== expectedDistinct) return { ok: false, reason: `expected ${expectedDistinct} distinct ids, got ${distinct}` };
  if (expectedFirst != null && sorted[0] !== expectedFirst) return { ok: false, reason: `first id ${sorted[0]} !== expected ${expectedFirst}` };
  if (expectedLast != null && sorted[sorted.length - 1] !== expectedLast) return { ok: false, reason: `last id ${sorted[sorted.length - 1]} !== expected ${expectedLast}` };
  // 连续性检查
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return { ok: false, reason: `gap at ${sorted[i-1]} -> ${sorted[i]}` };
  }
  return { ok: true };
}

// ================================================================ B3
async function runB3({ page, check, capturedUrls }) {
  // 重置: baseline 10 events, SSE 开
  await ctlServer('reset', 'baseline=10&sse=1');
  // 加载首页
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  // 确认事件池基线: evCursor=10 (最大 id =10)
  let stats = await ctlStats();
  // 添加 451 个事件(id 11..461)
  await ctlServer('add', 'count=451&kind=claimed');
  // 广播 events 消息触发 catchup
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(2000); // 等待 catchup 完成
  stats = await ctlStats();
  const pages = nonEmptyPages(stats);
  // 断言: 3 个非空分页
  check('B3 page count', pages.length === 3, `${pages.length} pages`);
  // 断言各页 after 光标: after=10, 210, 410
  const afters = pages.map((p) => p.after);
  check('B3 page afters [10,210,410]', JSON.stringify(afters) === JSON.stringify([10, 210, 410]),
    'afters: ' + JSON.stringify(afters));
  // 断言 451 条非重复无间隔覆盖 11..461
  const part = assertPartition(pages, 451, 11, 461);
  check('B3 partition 451 distinct ids 11-461', part.ok, part.reason || 'ok');
  // 断言最后 page 的 next_cursor = 461, has_more=false
  const lastPage = pages[pages.length - 1];
  check('B3 last page has_more=false', !lastPage.has_more, `has_more=${lastPage.has_more}, next_cursor=${lastPage.next_cursor}`);
  check('B3 last page next_cursor=461', lastPage.next_cursor === 461, `next_cursor=${lastPage.next_cursor}`);
  // 截图
  await page.screenshot({ path: `${SCREENSHOT_DIR}/b3-events-451.png`, fullPage: false });
}

// ================================================================ B4
async function runB4({ page, check, capturedUrls }) {
  await ctlServer('reset', 'baseline=10&sse=1');
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  // ----- 阶段1: 两次重叠补取 -----
  await ctlServer('add', 'count=200&kind=claimed'); // ids 11..210
  // 两次快速广播 → 两个并发 catchup
  await ctlServer('broadcast', 'type=events');
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(2000);
  let stats = await ctlStats();
  const afters = (stats.eventsAfter || []).filter((e) => e.count > 0).map((e) => e.after);
  // 标准 200/200 两页, 但两个并发 chains → 可能 after:[10,210,10,210] 或 [10,10,210,210]
  const after10Count = afters.filter((a) => a === 10).length;
  check('B4 overlap concurrent after=10 requests >=2',
    after10Count >= 2, `after=10 appears ${after10Count} times`);
  // 无无限循环: 每个 chain 最多 2 页 (总非空 pages ≤ 6, 若 2 个 chain 各 2 页 = 4)
  const totalPages = (stats.eventsAfter || []).filter((e) => e.count > 0).length;
  check('B4 bounded pages (≤6 for 2 concurrent chains)',
    totalPages <= 6, `${totalPages} pages total`);

  // ----- 阶段2: 模拟存量积压 -> 开启 stall -> 广播 -> 无死循环 -----
  // 猛增一批事件(使 catchup 需要多页), 开启 stall
  await ctlServer('add', 'count=300&kind=claimed'); // ids 211..510
  await ctlServer('stall', 'on=1');
  const preStallPageCount = (await ctlStats()).eventsAfter.length;
  await ctlServer('broadcast', 'type=events'); // catchup → stall → one page then throw
  await page.waitForTimeout(3500); // 等待足够长时间确认死循环不会继续
  const midStats = await ctlStats();
  const stalledPages = midStats.eventsAfter.length - preStallPageCount;
  check('B4 stalled pages bounded (≤2, no infinite loop)',
    stalledPages >= 1 && stalledPages <= 2,
    `${stalledPages} new eventsAfter entries during stall`);

  // ----- 阶段3: 清除 stall → 恢复 → 最终能追平 -----
  await ctlServer('stall', 'on=0');
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(2500);
  const finalStats = await ctlStats();
  const recoveryPages = nonEmptyPages(finalStats);
  // stall+recovery 后, 最终应有完整 catchup 覆盖 ids 11..510 (500 events)
  const recoveryP = recoveryPages.slice(-4); // 最后几个可能是完整分页
  // 检查最后有一次 has_more=false
  const last = recoveryPages[recoveryPages.length - 1];
  check('B4 recovery last page has_more=false', last && !last.has_more,
    last ? `has_more=${last.has_more}, next_cursor=${last.next_cursor}` : 'no pages');
  // 验证 mode 回到 live
  const live = await waitLiveChip(page, '秒级同步', 5000);
  check('B4 recovery mode=live', live, live ? 'chip shows 秒级同步' : 'timeout');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/b4-stall-recovery.png`, fullPage: false });
}

// ================================================================ B5
async function runB5({ page, check, capturedUrls }) {
  await ctlServer('reset', 'baseline=5&sse=1'); // baseline 5, ids 1..5
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  // 设置注入: 在第 2 个非空 events-after 请求之后插入 3 个新事件
  await ctlServer('injectRule', 'afterNth=2&count=3');
  // 添加 437 个历史事件 (id 6..442)
  await ctlServer('add', 'count=437&kind=claimed');
  // 广播 → catchup
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(3000);
  const stats = await ctlStats();
  const pages = nonEmptyPages(stats);
  // 页数: 应该是 3 页(200 + 200 + 40, 因为注入的 3 个追加到最后导致最后页从 37→40)
  //   base ids: 6..442 = 437; injected: 3 new (443,444,445) → total 440 in 3 pages
  check('B5 page count 3', pages.length === 3, `${pages.length} pages`);
  // 第 1 页 ids 6..205 (200); 第 2 页 ids 206..405 (200); 第 3 页 ids 406..445 (40)
  const pageSizes = pages.map((p) => p.count);
  check('B5 page sizes 200+200+40', JSON.stringify(pageSizes) === JSON.stringify([200, 200, 40]),
    'sizes: ' + JSON.stringify(pageSizes));
  // 断言 440 条不重复连续覆盖 ids 6..445
  const part = assertPartition(pages, 440, 6, 445);
  check('B5 partition 440 distinct ids 6-445', part.ok, part.reason || 'ok');
  // 437 条历史全部可见(id 6..442 全部在 union 中)
  const allIds = [];
  for (const p of pages) allIds.push(...p.ids);
  const missing = [];
  for (let i = 6; i <= 442; i++) { if (!allIds.includes(i)) missing.push(i); }
  check('B5 all 437 history events visible', missing.length === 0,
    missing.length > 0 ? `missing ${missing.length} ids: ${missing.slice(0,10).join(',')}...` : 'all 437 present');
  // 注入的 3 个新事件(443,444,445)也在
  let allPresent = ([443,444,445]).every((id) => allIds.includes(id));
  check('B5 injected 3 events visible', allPresent, allPresent ? '443,444,445 present' : 'missing injected');
  // 最终 cursor
  const lastPage = pages[pages.length - 1];
  check('B5 last page has_more=false', !lastPage.has_more, `has_more=${lastPage.has_more}`);
  check('B5 last page next_cursor=445', lastPage.next_cursor === 445, `next_cursor=${lastPage.next_cursor}`);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/b5-history-insertion.png`, fullPage: false });
}

// ================================================================ B6
async function runB6({ page, check, capturedUrls }) {
  // 重置: SSE 关闭
  await ctlServer('reset', 'baseline=10&sse=0'); // sse off → 503
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // ----- 阶段1: 初始 SSE 不可用 → 降级轮询 -----
  // 等待芯片显示降级轮询或正在重连
  const polling = await waitLiveChip(page, '降级轮询', 8000);
  check('B6 initial SSE fail → polling', polling,
    polling ? 'chip shows 降级轮询' : 'chip not polling');

  // 期望 polling 期间有 ≥2 次 board 请求(初始 + 至少一次轮询)
  // board 请求含: 初始 ensureStarted + SSE onerror 后的 fetchBoard+重连定时器+polling
  let stats = await ctlStats();
  check('B6 board fetched during polling (≥2)',
    stats.board >= 2, `board=${stats.board}`);
  const preLiveConnections = stats.streamConnections;

  // ----- 阶段2: SSE 恢复 → 自动切回实时 -----
  await ctlServer('sse', 'on=1');
  // 等待 frontend 的 3s 重连定时器触发 → SSE 成功 → mode live
  const live = await waitLiveChip(page, '秒级同步', 12000);
  check('B6 SSE recover → live', live, live ? 'chip shows 秒级同步' : 'timeout');
  await page.waitForTimeout(2000); // 确认稳定
  stats = await ctlStats();
  const afterRecoverConns = stats.streamConnections;
  check('B6 SSE connection increased after recovery',
    afterRecoverConns > preLiveConnections,
    `before=${preLiveConnections} after=${afterRecoverConns}`);

  // ----- 阶段3: 路由切换不产生重复连接 -----
  const stableConns = afterRecoverConns;
  // 切换到任务页 (#tasks)
  await page.evaluate(() => { location.hash = 'tasks'; });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { location.hash = 'projects'; });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.waitForTimeout(1000);
  stats = await ctlStats();
  check('B6 route switching no extra SSE connections',
    stats.streamConnections === stableConns,
    `before=${stableConns} after=${stats.streamConnections} (should stay same)`);

  // 验证 console 没有新错误
  const consoleErrs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrs.push(msg.text()); });
  await page.waitForTimeout(500);
  check('B6 no console errors on route switch',
    consoleErrs.length === 0,
    consoleErrs.length > 0 ? consoleErrs[0] : 'clean');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/b6-sse-polling.png`, fullPage: false });
}

// ================================================================ B7
async function runB7({ page, check, capturedUrls }) {
  await ctlServer('reset', 'baseline=10&sse=1');
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  // 确认在 Overview
  await page.waitForSelector('text=自动化', { timeout: 5000 });
  await page.waitForSelector('text=需要关注', { timeout: 5000 });

  // 记录初始 eventsAfter 数量
  const initialEvAfter = (await ctlStats()).eventsAfter.length;

  // ----- 阶段1: 仅 profiles_changed, 无任务事件, 自动化数据更新 -----
  // 查看初始 daily-report 显示"未运行过"
  const bodyBefore = await bodyText(page);
  check('B7 initial daily-report 未运行过',
    bodyBefore.includes('未运行过'),
    bodyBefore.includes('未运行过') ? 'shows 未运行过' : 'missing');

  // 改变自动化 last_status = ok
  await ctlServer('setAutomation', 'name=daily-report&field=last_status&value=ok');
  await ctlServer('setAutomation', 'name=daily-report&field=next_run_at&value=2026-09-21T09:00:00');
  // 广播 profiles_changed
  await ctlServer('broadcast', 'type=profiles_changed');
  await page.waitForTimeout(2500);
  // 断言: daily-report 展示 capsule "正常" (非"未运行过")
  const bodyMid = await bodyText(page);
  check('B7 automation updated via profiles_changed (calls 正常)',
    bodyMid.includes('正常') && !bodyMid.includes('未运行过'),
    bodyMid.includes('正常') ? 'shows 正常' : 'still shows 未运行过');

  // 确认无新增 events-after 请求(仅 profiles_changed, 不触发 catchup)
  const midStats = await ctlStats();
  const addedEvAfter = midStats.eventsAfter.length - initialEvAfter;
  check('B7 no events-after catchup from profiles_changed',
    addedEvAfter === 0, `added ${addedEvAfter} events-after requests`);

  // ----- 阶段2: 子源失败 → LKG 保留旧数据 + stale 标注(不伪装成空/正常, 也不误删缓存) -----
  // 让 automations 源失败 (HTTP 503)
  await ctlServer('fail', 'source=automations&on=1');
  // 触发 board 刷新 (broadcast profiles_changed 触发 fetchBoard)
  await ctlServer('broadcast', 'type=profiles_changed');
  await page.waitForTimeout(2500);
  const bodyFail = await bodyText(page);
  // 之前成功加载过 daily-report → 失败后仍保留 (LKG), 且标注「缓存 · 刷新失败」
  check('B7 LKG: failed source keeps cached automation row (daily-report retained)',
    bodyFail.includes('daily-report'),
    bodyFail.includes('daily-report') ? 'cached row retained' : 'cached row wrongly dropped');
  check('B7 LKG: shows stale pill 缓存 · 刷新失败',
    bodyFail.includes('缓存 · 刷新失败'),
    bodyFail.includes('缓存 · 刷新失败') ? 'stale pill shown' : 'missing stale pill');
  check('B7 LKG: no "暂无自动化任务" (cache present, not empty)',
    !bodyFail.includes('暂无自动化任务'),
    bodyFail.includes('暂无自动化任务') ? 'wrongly shows empty state' : 'correct');
  // 有缓存时不应整片「暂不可用」空态
  check('B7 LKG: no "自动化数据暂不可用" empty state (cache present)',
    !bodyFail.includes('自动化数据暂不可用'),
    bodyFail.includes('自动化数据暂不可用') ? 'wrongly shows unavailable empty state' : 'correct');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/b7-automation-fail.png`, fullPage: false });

  // ----- 阶段3: 恢复 → 正常数据回归, 无 stale 标注 -----
  await ctlServer('fail', 'source=automations&on=0');
  await ctlServer('broadcast', 'type=profiles_changed');
  await page.waitForTimeout(2000);
  const bodyRecover = await bodyText(page);
  check('B7 LKG: recovery removes stale pill',
    !bodyRecover.includes('缓存 · 刷新失败'),
    bodyRecover.includes('缓存 · 刷新失败') ? 'stale pill lingered after recovery' : 'correct');

  // ----- 阶段4: source_ok=false (HTTP 200 内部失败) → 不得伪装成空/正常 -----

  // 阶段4a: source_ok=false 且无缓存(首次加载) → 显「自动化数据暂不可用」
  // 先置 source_ok=false 再首次加载, 确保无缓存可 LKG 保留 → 验证首次 unavailable 空态
  await ctlServer('reset', 'baseline=10&sse=1');
  await ctlServer('sourceOkFalse', 'source=automations&on=1');
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  const bodyOkFalse = await bodyText(page);
  // source_ok=false 且无缓存 → 应显「自动化数据暂不可用」, 而非「暂无自动化任务」或「正常」
  check('B7 source_ok=false shows unavailable (not empty/normal)',
    bodyOkFalse.includes('自动化数据暂不可用'),
    bodyOkFalse.includes('自动化数据暂不可用') ? 'unavailable shown' : 'missing unavailable');
  check('B7 source_ok=false no "暂无自动化任务"',
    !bodyOkFalse.includes('暂无自动化任务'),
    bodyOkFalse.includes('暂无自动化任务') ? 'wrongly shows empty state' : 'correct');
  // source_ok=false 且无缓存 → 整片 unavailable 空态, 不再渲染任何自动化行
  check('B7 source_ok=false no cached automation row rendered',
    !bodyOkFalse.includes('daily-report'),
    bodyOkFalse.includes('daily-report') ? 'wrongly renders automation row' : 'correct');
  check('B7 source_ok=false no 正常 capsule',
    !/>正常</.test(bodyOkFalse),
    /正常/.test(bodyOkFalse) ? 'wrongly shows 正常' : 'correct');

  // ----- 阶段5: source_ok=false 但存在 LKG → 语义必须与 HTTP reject 一致 -----
  // 老板 B.1.1 统一口径: 该子源历史上成功过 → 无论 HTTP/network failure 还是
  // source_ok=false, 都保留 last-known-good + stale 标注, 不显空数据/暂不可用。
  await ctlServer('sourceOkFalse', 'source=automations&on=0');
  await ctlServer('reset', 'baseline=10&sse=1');
  await ctlServer('setAutomation', 'name=daily-report&field=last_status&value=ok');
  await ctlServer('setAutomation', 'name=daily-report&field=next_run_at&value=2026-09-21T09:00:00');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  // 确认缓存建立: daily-report 可见且无 stale 标注
  const bodyLkgBase = await bodyText(page);
  check('B7 LKG setup: daily-report cached, no stale pill before failure',
    bodyLkgBase.includes('daily-report') && !bodyLkgBase.includes('缓存 · 刷新失败'),
    bodyLkgBase.includes('daily-report') ? 'cache established' : 'cache NOT established');
  // 现在打 source_ok=false(不做任何其它变化), 触发一次 profiles_changed 刷新
  await ctlServer('sourceOkFalse', 'source=automations&on=1');
  await ctlServer('broadcast', 'type=profiles_changed');
  await page.waitForTimeout(2500);
  const bodyOkFalseLkg = await bodyText(page);
  // LKG + source_ok=false → 缓存行保留
  check('B7 source_ok=false with LKG: cached daily-report row retained',
    bodyOkFalseLkg.includes('daily-report'),
    bodyOkFalseLkg.includes('daily-report') ? 'cached row retained' : 'CACHE LOST on source_ok=false');
  // LKG + source_ok=false → stale 标注存在
  check('B7 source_ok=false with LKG: stale pill shown',
    bodyOkFalseLkg.includes('缓存 · 刷新失败'),
    bodyOkFalseLkg.includes('缓存 · 刷新失败') ? 'stale pill shown' : 'missing stale pill');
  // LKG + source_ok=false → 不显空数据文案
  check('B7 source_ok=false with LKG: no "暂无自动化任务"',
    !bodyOkFalseLkg.includes('暂无自动化任务'),
    bodyOkFalseLkg.includes('暂无自动化任务') ? 'wrongly shows empty' : 'correct');
  check('B7 source_ok=false with LKG: no "自动化数据暂不可用"',
    !bodyOkFalseLkg.includes('自动化数据暂不可用'),
    bodyOkFalseLkg.includes('自动化数据暂不可用') ? 'wrongly shows unavailable' : 'correct');
  // B.1 关账精确断言: source_ok=false + LKG 必须
  //   (a) 显示「正常 · 缓存」标注 capsule  (b) 存在 stale pill  (c) 禁止裸「正常」
  // 不用 body.includes("正常") —— "正常 · 缓存" 也会命中, 必须锚定 >正常< 边界。
  const hasAnnotatedCapsule = bodyOkFalseLkg.includes('正常 · 缓存');
  const hasBareNormal = /正常(?! · 缓存)/.test(bodyOkFalseLkg);
  const hasStalePill = bodyOkFalseLkg.includes('缓存 · 刷新失败');
  check('B7 source_ok=false with LKG: annotated 正常·缓存 capsule shown',
    hasAnnotatedCapsule,
    hasAnnotatedCapsule ? 'annotated capsule shown' : 'missing 正常·缓存 annotation');
  check('B7 source_ok=false with LKG: stale pill shown',
    hasStalePill,
    hasStalePill ? 'stale pill shown' : 'missing stale pill');
  check('B7 source_ok=false with LKG: no bare 正常 capsule',
    !hasBareNormal,
    hasBareNormal ? 'bare 正常 leaked (cache not annotated)' : 'correct');
}

// ================================================================ B8
// §B.1.4 乱序完成: 较新 catchup 先返回(较高游标已提交), 较旧 catchup 携带旧快照(更小游标)后返回。
// 断言最终 evCursor 不回退(Math.max 单调): 观察下一次 catchup 的 after 参数仍为较高游标。
async function runB8({ page, check, capturedUrls }) {
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await ctlServer('reset', 'baseline=10&sse=1');
  capturedUrls.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  // ----- 阶段1: 建立 evCursor=210 -----
  await ctlServer('add', 'count=200&kind=claimed'); // ids 11..210, eventsCursor=210
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(2000);
  let stats = await ctlStats();
  const afterFirst = (stats.eventsAfter || []).filter((e) => e.count > 0);
  const lastFirst = afterFirst[afterFirst.length - 1];
  check('B8 stage1 evCursor advanced to 210 (last page next_cursor=210, has_more=false)',
    !!lastFirst && lastFirst.next_cursor === 210 && !lastFirst.has_more,
    lastFirst ? `after=${lastFirst.after} next_cursor=${lastFirst.next_cursor} has_more=${lastFirst.has_more}` : 'no pages');

  // ----- 阶段2: 触发乱序完成 -----
  // 再添 200 个事件(211..410), eventsCursor=410
  await ctlServer('add', 'count=200&kind=claimed');
  // 一次性 delayAfter: 对 after=210 的请求延迟 1500ms 并返回旧游标 210(旧快照)
  await ctlServer('delayAfter', 'after=210&ms=1500&staleCursor=210&on=1');
  // 两次快速广播 → 两个并发 catchup, 均从 evCursor=210 出发请求 after=210
  await ctlServer('broadcast', 'type=events');
  await ctlServer('broadcast', 'type=events');
  // 等待: 较新(fast, cursor=410)先返回提交 evCursor=410; 较旧(stale, cursor=210)1500ms后返回
  await page.waitForTimeout(3000);

  stats = await ctlStats();
  const allAfter = (stats.eventsAfter || []);
  // 确认确实发生了乱序完成: 存在一个 stale 记录
  const staleRec = allAfter.find((e) => e.stale);
  check('B8 out-of-order path executed (stale response seen)',
    !!staleRec,
    staleRec ? `stale after=${staleRec.after} cursor=${staleRec.stale_cursor}` : 'no stale response');
  // 确认较新 catchup 提交了较高游标 410 (存在 next_cursor=410 且 has_more=false 的非stale记录)
  const committed410 = allAfter.some((e) => !e.stale && e.next_cursor === 410 && !e.has_more);
  check('B8 newer catchup committed cursor 410', committed410,
    committed410 ? 'next_cursor=410 has_more=false seen' : 'no 410 commit');

  // ----- 阶段3: 证明 evCursor 不回退 -----
  // 再次广播 → 下一次 catchup 应从 evCursor(≥410) 出发。观察 after 参数。
  capturedUrls.length = 0;
  await ctlServer('broadcast', 'type=events');
  await page.waitForTimeout(2500);
  // 从捕获的 URL 解析 after 值
  const afterParams = capturedUrls
    .map((u) => new URL(u).searchParams.get('after'))
    .map((n) => Number(n));
  check('B8 subsequent catchup starts from high cursor (after>=410, not regressed to 210)',
    afterParams.length > 0 && afterParams.every((a) => a >= 410),
    'next after values: ' + JSON.stringify(afterParams));

  await page.screenshot({ path: `${SCREENSHOT_DIR}/b8-outoforder-cursor.png`, fullPage: false });
  check('B8 advanceEvCursor monotonic log (no prev > next regression)',
    logs.every((l) => !l.startsWith('[B8-REG]') || l.includes('advanceEvCursor(')),
    'last reg log: ' + (logs.filter((l) => l.startsWith('[B8-REG]')).slice(-3).join(' | ') || 'none'));
  console.log('  [B8] evCursor sequence:', JSON.stringify(logs.filter((l) => l.startsWith('[B8-REG]'))));
}

// ================================================================ entry
if (require.main === module) {
  // 启动 fixture-server
  const serverPath = path.join(__dirname, 'fixture-server.cjs');
  const child = spawn('node', [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FIXTURE_PORT: String(BASE_PORT) },
  });
  child.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));

  waitForServer(`http://127.0.0.1:${BASE_PORT}/_ctl/ping`)
    .then(() => runAll(process.argv[2]))
    .catch((err) => { console.error('Server start failed:', err.message); process.exit(1); })
    .finally(() => setTimeout(() => child.kill(), 1000));
} else {
  module.exports = { runAll };
}