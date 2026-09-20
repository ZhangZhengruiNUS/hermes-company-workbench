// Phase B acceptance: B1, B2, B8, B9 — drives real /next/ build vs fixture-server (18123)
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');

const BASE = 'http://127.0.0.1:18123/next/';
const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const OUT = '/home/ubuntu/hermes-company-workbench/web/screenshots';

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function ctl(q){ return new Promise((res,rej)=>{ http.get('http://127.0.0.1:18123/_ctl/'+q,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej); }); }

async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox','--disable-setuid-sandbox'] });
  const results = { pass:0, fail:0, items:[] };
  const check=(n,ok,d='')=>{ results.items.push({n,ok,d}); if(ok){results.pass++;console.log('  PASS',n,d);} else {results.fail++;console.log('  FAIL',n,'|',d);} };
  let page;

  try {
    await ctl('reset?baseline=10&sse=1');

    // ===== B1 =====
    console.log('\n=== B1 ===');
    page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto(BASE+'#tasks',{waitUntil:'networkidle',timeout:20000});
    await page.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await page.reload({waitUntil:'networkidle',timeout:20000});
    await page.waitForSelector('#root',{timeout:8000});
    await wait(2500);

    const activeText = await page.textContent('body');
    check('B1 active default tab', activeText.includes('当前工作'), 'default tab');
    check('B1 unknown status visible in board', activeText.includes('未知状态: 实验任务'), 'unknown in board');
    check('B1 no-assignee standalone in board', activeText.includes('就绪无负责人: 独立调研'), 'standalone');
    check('B1 done NOT in active', !activeText.includes('完成: 里程碑一'), 'done excluded');
    check('B1 archived NOT in active', !activeText.includes('归档: 旧调研A'), 'archived excluded');

    // 全部 tab
    for (const t of await page.$$('[role="tab"]')){ const txt=await t.textContent(); if(txt&&txt.includes('全部')){ await t.click(); break; } }
    await wait(1800);
    const allText = await page.textContent('body');
    check('B1 all shows done', allText.includes('完成: 里程碑一'), 'done in all');
    check('B1 all shows unknown', allText.includes('未知状态: 实验任务'), 'unknown in all');

    // 归档 tab
    for (const t of await page.$$('[role="tab"]')){ const txt=await t.textContent(); if(txt&&txt.includes('归档')){ await t.click(); break; } }
    await wait(1800);
    const archText = await page.textContent('body');
    check('B1 archived shows archived', archText.includes('归档: 旧调研A'), 'archived view');
    check('B1 archived excludes done', !archText.includes('完成: 里程碑一'), 'archived excludes done');

    // 近期完成 tab
    for (const t of await page.$$('[role="tab"]')){ const txt=await t.textContent(); if(txt&&txt.includes('近期完成')){ await t.click(); break; } }
    await wait(1800);
    const doneText = await page.textContent('body');
    check('B1 done shows done', doneText.includes('完成: 里程碑一'), 'done view');
    check('B1 done excludes archived', !doneText.includes('归档: 旧调研A'), 'done excludes archived');

    // 列表模式 + 全部: unknown visible in list
    for (const b of await page.$$('button')){ const txt=await b.textContent(); if(txt&&txt.includes('列表')){ await b.click(); break; } }
    await wait(1200);
    for (const t of await page.$$('[role="tab"]')){ const txt=await t.textContent(); if(txt&&txt.includes('全部')){ await t.click(); break; } }
    await wait(1500);
    const listText = await page.textContent('body');
    check('B1 list renders rows', listText.includes('执行: Phase B 施工'), 'list rows');
    check('B1 unknown visible in list', listText.includes('未知状态: 实验任务'), 'unknown in list');

    // 独立任务 filter
    const projSel = await page.$('select[aria-label="按项目筛选"]');
    await projSel.selectOption('__none__');
    await wait(1200);
    const noneText = await page.textContent('body');
    check('B1 standalone filter', noneText.includes('独立调研') && noneText.includes('未知状态: 实验任务'), 'standalone only');
    check('B1 standalone excludes proj tasks', !noneText.includes('执行: Phase B 施工'), 'proj excluded');

    // 重置项目筛选, 再按 ID 搜索 (t_alpha 在 proj_aurora)
    await projSel.selectOption('');
    await wait(800);
    const search = await page.$('input[aria-label="搜索任务"]');
    await search.fill('t_alpha');
    await wait(1500);
    const searchText = await page.textContent('body');
    check('B1 search by ID t_alpha', searchText.includes('执行: Phase B 施工'), 'search ID');
    await page.close();

    // ===== B2 =====
    console.log('\n=== B2 ===');
    page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto(BASE,{waitUntil:'networkidle',timeout:20000});
    await page.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await page.reload({waitUntil:'networkidle',timeout:20000});
    await page.waitForSelector('#root',{timeout:8000});
    await wait(2500);
    const ovText = await page.textContent('body');
    // fixture: 2 done (t_done1,t_done2) + 2 archived; exec strip done cell = 2
    const ovDoneOk = ovText.includes('完成') && /完成\s*\n?2/.test(ovText);
    check('B2 exec done = 2 (archived not counted)', ovDoneOk, ovText.match(/完成\s*\n?\d+/)?.[0] || 'no done count');
    // archived-only project (proj_arch, only t_arch1/t_arch2) -> capsule title 历史归档 2 项
    const archCapsule = await page.$eval('main', el => {
      const caps = Array.from(el.querySelectorAll('[title]')).map(c=>c.getAttribute('title')||'');
      return caps.join(' | ');
    });
    check('B2 archived-only project label', archCapsule.includes('历史归档 2') || archCapsule.includes('当前无未归档任务'), archCapsule.slice(0,120));
    check('B2 no fake 100%', !/100%/.test(ovText), 'no 100%');

    // project card click -> filters to project (默认"当前工作"不含 done)
    for (const c of await page.$$('main [role="button"], main button')){ const t=await c.textContent(); if(t&&t.includes('Aurora Glass')){ await c.click(); break; } }
    await wait(2200);
    const projTasksText = await page.textContent('body');
    check('B2 project card filters to proj tasks', projTasksText.includes('执行: Phase B 施工'), 'aurora proj task in active');
    check('B2 project filter excludes others', !projTasksText.includes('待办: 资料整理') && !projTasksText.includes('归档: 旧调研A'), 'others excluded');
    await page.close();

    // ===== B8 =====
    console.log('\n=== B8 ===');
    page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto(BASE+'#tasks?task=t_alpha',{waitUntil:'networkidle',timeout:20000});
    await page.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await page.reload({waitUntil:'networkidle',timeout:20000});
    await wait(2500);
    const dlText = await page.textContent('body');
    check('B8 valid id deeplink opens detail', dlText.includes('任务要求') && dlText.includes('执行: Phase B 施工'), 'valid deeplink');
    await page.screenshot({path:`${OUT}/b8-deeplink-valid.png`});

    // archived id
    await page.evaluate(()=>location.hash='tasks?task=t_arch1');
    await wait(2200);
    const dlArch = await page.textContent('body');
    check('B8 archived id deeplink opens', dlArch.includes('归档: 旧调研A'), 'archived deeplink');

    // invalid id -> error, not blank
    await page.evaluate(()=>location.hash='tasks?task=nonexistent-id');
    await wait(2200);
    const invText = await page.textContent('body');
    check('B8 invalid id no white screen', invText.length > 80, 'page renders');
    check('B8 invalid id shows error state', invText.includes('详情加载失败') || invText.includes('不存在') || invText.includes('404'), invText.match(/详情.{0,40}/)?.[0] || 'no error');
    await page.screenshot({path:`${OUT}/b8-deeplink-invalid.png`});

    // forward/back: use location.hash (triggers hashchange listener)
    await page.evaluate(()=>location.hash='tasks');
    await wait(1500);
    await page.evaluate(()=>location.hash='tasks?task=t_done1');
    await wait(2200);
    const fwdText = await page.textContent('body');
    check('B8 forward to done task', fwdText.includes('完成: 里程碑一'), 'forward');
    await page.goBack();
    await wait(2200);
    const backText = await page.textContent('body');
    check('B8 back restores prior view', backText.includes('当前工作') || backText.includes('执行: Phase B 施工'), 'back restored');
    await page.close();

    // ===== B9 =====
    console.log('\n=== B9 ===');
    page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto(BASE+'#tasks',{waitUntil:'networkidle',timeout:20000});
    await page.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await page.reload({waitUntil:'networkidle',timeout:20000});
    await wait(2500);
    for (const card of await page.$$('main button, [role="button"]')){ const t=await card.textContent(); if(t&&t.includes('执行: Phase B 施工')){ await card.click(); break; } }
    await wait(2200);
    const detText = await page.textContent('body');
    check('B9 body (任务要求)', detText.includes('任务要求') || detText.includes('任务要求完整描述'), 'body');
    check('B9 result', detText.includes('最终结果'), 'result');
    check('B9 runs', detText.includes('执行记录'), 'runs');
    check('B9 events', detText.includes('事件(') || detText.includes('最近'), 'events section');
    check('B9 deps', detText.includes('上游') || detText.includes('后续') || detText.includes('依赖链') || detText.includes('待审: 报告初稿'), 'deps');
    await page.screenshot({path:`${OUT}/b9-detail-content.png`});

    // A-slow/B-fast: click A then immediately B; final must show B
    await page.keyboard.press('Escape');
    await wait(800);
    for (const card of await page.$$('main button, [role="button"]')){ const t=await card.textContent(); if(t&&t.includes('阻塞: 外部依赖等待')){ await card.click(); break; } }
    await wait(120);
    for (const card of await page.$$('main button, [role="button"]')){ const t=await card.textContent(); if(t&&t.includes('执行: Phase B 施工')){ await card.click(); break; } }
    await wait(2500);
    const raceText = await page.textContent('body');
    check('B9 race final shows B task', raceText.includes('执行: Phase B 施工'), 'final B');
    check('B9 race no A stale content', !raceText.includes('阻塞: 外部依赖等待'), 'no A stale');
    await page.screenshot({path:`${OUT}/b9-race-final.png`});
    await page.close();

  } catch(err){
    console.error('Test error:', err.message);
    console.error((err.stack||'').split('\n').slice(0,6).join('\n'));
  } finally {
    await browser.close();
  }

  fs.writeFileSync('/tmp/b1b2b8b9-results.json', JSON.stringify(results,null,2));
  console.log(`\n=== B1/B2/B8/B9: ${results.pass} PASS, ${results.fail} FAIL ===`);
  for(const it of results.items) console.log(`  ${it.ok?'PASS':'FAIL'} ${it.n}: ${it.d}`);
}
main().catch(console.error);
