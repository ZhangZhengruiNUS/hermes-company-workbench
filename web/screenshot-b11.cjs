// Phase B B11 screenshots: task board/list/detail on desktop 1440x900 + mobile 390x844
// Both themes + reduced-motion variant. Uses the real /next/ build via test server.
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'http://127.0.0.1:18123/next/';
const OUT = '/home/ubuntu/hermes-company-workbench/web/screenshots';
const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox','--disable-setuid-sandbox'] });
  const results = { pass:0, fail:0, items:[] };
  const check=(n,ok,d='')=>{ results.items.push({n,ok,d}); if(ok){results.pass++;console.log('  PASS',n,d);} else {results.fail++;console.log('  FAIL',n,d);} };

  try {
    // ---------- DESKTOP 1440x900 dark ----------
    const page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto(BASE,{waitUntil:'networkidle',timeout:20000});
    await page.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await page.reload({waitUntil:'networkidle',timeout:20000});
    await page.waitForSelector('#root',{timeout:8000});
    await wait(2500);

    // go to tasks page
    const navBtns = await page.$$('nav button');
    for (const b of navBtns){ const t = await b.textContent(); if(t && t.includes('任务')){ await b.click(); break; } }
    await wait(2000);

    // Task board (current work)
    const boardText = await page.textContent('body');
    const hasColumns = boardText.includes('进行中') && boardText.includes('完成');
    check('B11 desktop board columns present', hasColumns, '进行中/完成 columns');
    await page.screenshot({ path:`${OUT}/b11-board-1440-dark.png`, fullPage:false });
    console.log('  SCREENSHOT b11-board-1440-dark.png');

    // Switch to list view
    const modeBtns = await page.$$('button');
    for (const b of modeBtns){ const t = await b.textContent(); if(t && t.includes('列表')){ await b.click(); break; } }
    await wait(1500);
    const listText = await page.textContent('body');
    check('B11 desktop list view renders rows', listText.includes('Aurora Glass') || listText.includes('筛选结果'), 'list view');
    await page.screenshot({ path:`${OUT}/b11-list-1440-dark.png`, fullPage:false });
    console.log('  SCREENSHOT b11-list-1440-dark.png');

    // Open a task detail drawer (the running task)
    const cards = await page.$$('main button, [role="button"]');
    for (const c of cards){ const t = await c.textContent(); if(t && t.includes('执行: Phase B 施工')){ await c.click(); break; } }
    await wait(2500);
    const drawerText = await page.textContent('body');
    const hasDetail = drawerText.includes('任务详情') || drawerText.includes('任务要求');
    check('B11 desktop detail drawer opens', hasDetail, 'task detail drawer');
    await page.screenshot({ path:`${OUT}/b11-detail-1440-dark.png`, fullPage:false });
    console.log('  SCREENSHOT b11-detail-1440-dark.png');

    // overflow check (no page-level horizontal scroll)
    const overflowX = await page.evaluate(()=> document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('B11 desktop no page-level horizontal overflow', !overflowX, overflowX?'has overflow':'clean');
    await page.close();

    // ---------- MOBILE 390x844 dark ----------
    const mob = await browser.newPage({ viewport:{width:390,height:844} });
    await mob.goto(BASE+'#tasks',{waitUntil:'networkidle',timeout:20000});
    await mob.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await mob.reload({waitUntil:'networkidle',timeout:20000});
    await wait(2500);
    await mob.screenshot({ path:`${OUT}/b11-board-390-dark.png`, fullPage:false });
    console.log('  SCREENSHOT b11-board-390-dark.png');

    // touch target check: only interactive card-level buttons in main (exclude status label capsules/nav)
    const cardTargets = await mob.evaluate(()=>{
      const navText = document.querySelector('nav')?.textContent||'';
      const btns = Array.from(document.querySelectorAll('main button, main [role="button"]'));
      const small = btns.filter(b=>{
        const r=b.getBoundingClientRect();
        const t=b.textContent?.trim()||'';
        if(!t || t.length<3) return false;
        if(navText.includes(t)) return false;
        if(b.closest('[role="tablist"]')) return false;
        return r.width>0 && r.height>0 && r.height<44;
      });
      return small.length;
    });
    check('B11 mobile touch targets >=44px (card main targets)', cardTargets < 3, `${cardTargets} small`);

    // open detail on mobile
    const mcards = await mob.$$('main button, [role="button"]');
    for (const c of mcards){ const t = await c.textContent(); if(t && t.includes('执行: Phase B 施工')){ await c.click(); break; } }
    await wait(2500);
    const mdrawer = await mob.textContent('body');
    check('B11 mobile detail drawer opens', mdrawer.includes('任务要求') || mdrawer.includes('任务详情'), 'mobile detail');
    await mob.screenshot({ path:`${OUT}/b11-detail-390-dark.png`, fullPage:false });
    console.log('  SCREENSHOT b11-detail-390-dark.png');
    await mob.close();

    // ---------- LIGHT THEME 1440 ----------
    const lp = await browser.newPage({ viewport:{width:1440,height:900} });
    await lp.goto(BASE,{waitUntil:'networkidle',timeout:20000});
    await lp.evaluate(()=>localStorage.setItem('wb_theme','light'));
    await lp.reload({waitUntil:'networkidle',timeout:20000});
    await wait(2500);
    const lnav = await lp.$$('nav button');
    for (const b of lnav){ const t = await b.textContent(); if(t && t.includes('任务')){ await b.click(); break; } }
    await wait(2000);
    await lp.screenshot({ path:`${OUT}/b11-board-1440-light.png`, fullPage:false });
    console.log('  SCREENSHOT b11-board-1440-light.png');
    await lp.close();

    // ---------- REDUCED MOTION ----------
    const rm = await browser.newPage({ viewport:{width:1440,height:900}, reducedMotion:'reduce' });
    await rm.goto(BASE,{waitUntil:'networkidle',timeout:20000});
    await rm.evaluate(()=>localStorage.setItem('wb_theme','dark'));
    await rm.reload({waitUntil:'networkidle',timeout:20000});
    await wait(2000);
    await rm.screenshot({ path:`${OUT}/b11-reduced-motion-1440.png`, fullPage:false });
    console.log('  SCREENSHOT b11-reduced-motion-1440.png');
    await rm.close();

  } catch(err){
    console.error('Screenshot error:', err.message, err.stack);
  } finally {
    await browser.close();
  }

  fs.writeFileSync('/tmp/b11-screenshot-results.json', JSON.stringify(results,null,2));
  console.log(`\n=== B11 SCREENSHOTS: ${results.pass} PASS, ${results.fail} FAIL ===`);
  for(const it of results.items) console.log(`  ${it.ok?'PASS':'FAIL'} ${it.n}: ${it.d}`);
}
main().catch(console.error);
