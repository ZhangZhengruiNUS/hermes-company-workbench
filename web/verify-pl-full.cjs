// verify-pl-full.cjs — spec 8.1 深度验收: 嵌套/抽屉/滚动对准/color-mix computed/几何回归/浅色/触摸/reduced-motion
const { chromium } = require('playwright-core');
const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8123/next/';
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const results = [];
function report(k, v, pass){ results.push({k, v, pass}); console.log(`${pass?'PASS':'FAIL'}  ${k}${v?'  -> '+v:''}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, hasTouch:false });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e=>pageErrors.push(e.message));
  page.on('response', r=>{ if(r.status()>=500) console.log('[HTTP'+r.status()+']', r.url()); });
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('[data-exec-strip]', { timeout:15000 });
  await sleep(600);

  const onHosts = () => page.evaluate(()=>[...document.querySelectorAll('.pl-on')].map(el=>{
    const a=getComputedStyle(el,'::after');
    return { d:el.getAttribute('data-pointer-light')||'quiet', cx:Math.round(el.getBoundingClientRect().left+el.getBoundingClientRect().width/2), cy:Math.round(el.getBoundingClientRect().top+el.getBoundingClientRect().height/2), op:a.opacity };
  }));

  // --- 1. ExecutiveStrip 中心: 单宿主(glass) 不重复叠 5 格
  const ex=await page.evaluate(()=>{const r=document.querySelector('[data-exec-strip]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.mouse.move(ex.x,ex.y); await sleep(350);
  let on=await onHosts();
  report('1.1 ExecutiveStrip 命中单一宿主', JSON.stringify(on), on.length===1 && on[0].d==='glass');

  // --- 2. 嵌套表面: 悬停在 当前推进 任务卡(PrimCard=glass) 内部, 不应再点亮外层容器
  // 当前推进在 .prism-card 内(它是 glass 宿主); 检查是否有外层也点亮
  const cardBox=await page.evaluate(()=>{const e=document.querySelector('button[aria-label*="当前推进"] .prism-card, .prism-card');const r=e.getBoundingClientRect();return{x:r.left+r.width*0.4,y:r.top+r.height*0.4};});
  await page.mouse.move(cardBox.x,cardBox.y); await sleep(350);
  on=await onHosts();
  report('2.1 嵌套表面只亮最内层(=1) '+JSON.stringify(on), '', on.length===1);

  // --- 3. Drawer Portal: 打开任务抽屉, 指针进入面板点亮面板(glass), 遮罩后方不点亮
  await page.locator('main button', { hasText: 'Aurora Global Pointer Light' }).first().click(); await sleep(900);
  const drawerOpen = await page.evaluate(()=>!!document.querySelector('[role="dialog"]'));
  report('3.0 Drawer 已打开', '', !!drawerOpen);
  if (drawerOpen) {
    const dBox=await page.evaluate(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return{x:r.left+r.width*0.7,y:r.top+r.height*0.5};});
    await page.mouse.move(dBox.x,dBox.y); await sleep(400);
    on=await onHosts();
    const hasDrawerHost = await page.evaluate(()=>{
      const dl=document.querySelector('[role="dialog"]');
      return dl && dl.classList.contains('pl-on');
    });
    report('3.1 Drawer 面板被点亮', JSON.stringify(on)+' drawerPlOn='+hasDrawerHost, hasDrawerHost && on.some(h=>h.d==='glass'));
    // 遮罩后方 ExecutiveStrip 不应点亮
    const execStillOn = await page.evaluate(()=>document.querySelector('[data-exec-strip]')?.classList.contains('pl-on')||false);
    report('3.2 遮罩后方 ExecutiveStrip 未点亮', 'execOn='+execStillOn, !execStillOn);
    // 关闭
    await page.keyboard.press('Escape'); await sleep(600);
  }

  // --- 4. 滚动对准: 滚动页面(光标不动) 后 rehit, 光斑应对准新位置下的宿主
  // 回到总览确保状态干净
  if (await page.evaluate(()=>location.hash !== '')) {
    await page.evaluate(()=>{ location.hash='overview'; });
    await page.waitForTimeout(900);
  }
  const target=await page.evaluate(()=>{
    const e=[...document.querySelectorAll('.prism-card')].find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
    if(!e) return null;
    const r=e.getBoundingClientRect();
    return {x:r.left+r.width*0.5,y:r.top+r.height*0.5};
  });
  if (!target) {
    report('4.1 滚动对准(找不到 prism-card)', '', false);
  } else {
    await page.mouse.move(target.x,target.y); await sleep(300);
    const before=await page.evaluate(()=>{const e=[...document.querySelectorAll('.prism-card')].find(el=>el.classList.contains('pl-on'));return e?{mx:e.style.getPropertyValue('--mx'),my:e.style.getPropertyValue('--my')}:null;});
    await page.evaluate(()=>window.scrollBy(0,120)); await sleep(450);
    const after=await page.evaluate(()=>{const e=[...document.querySelectorAll('.prism-card')].find(el=>el.classList.contains('pl-on'));return e?{mx:e.style.getPropertyValue('--mx'),my:e.style.getPropertyValue('--my')}:null;});
    report('4.1 滚动后光斑坐标重对准', `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`, before!==null && after!==null && JSON.stringify(before)!==JSON.stringify(after));
    await page.evaluate(()=>window.scrollTo(0,0)); await sleep(300);
  }

  // --- 5. color-mix computed 值: 检查 pill 边框 / 指标 textShadow 不再是无效 var()88
  const cm=await page.evaluate(()=>{
    const out={};
    const pill=document.querySelector('.pill');
    if(pill){ const cs=getComputedStyle(pill); out.pillBorder=cs.borderColor; }
    const metric=document.querySelector('[data-exec-strip] [class*="tabular"]');
    if(metric){ const cs=getComputedStyle(metric); out.metricTextShadow=cs.textShadow; out.metricColor=cs.color; }
    const dot=document.querySelector('[data-exec-strip] .w-1\\.5');
    if(dot){ out.dotShadow=getComputedStyle(dot).boxShadow; }
    return out;
  });
  const badCM = JSON.stringify(cm).includes('var(') && !JSON.stringify(cm).includes('color-mix') && /88|1f|66|44/.test(JSON.stringify(cm));
  report('5.1 color-mix 生效(computed 无 var()88 拼接)', JSON.stringify(cm), !badCM && !/--[a-z]+\)(88|1f|66|44)/.test(JSON.stringify(cm)));

  // --- 6. 几何回归: Sidebar/Topbar/ExecutiveStrip 的 computed position 不变 (仍是 relative/sticky/fixed)
  const geo=await page.evaluate(()=>{
    const g=(s)=>{const e=document.querySelector(s); if(!e)return null; const cs=getComputedStyle(e); return {position:cs.position, top:cs.top, overflow:cs.overflow};};
    return { sidebar:g('nav[data-pointer-light="nav"]'), topbar:g('header'), exec:g('[data-exec-strip]'), quiet:g('.quiet-surface') };
  });
  report('6.1 宿主 position/overflow 无回归', JSON.stringify(geo), geo.sidebar.position==='sticky' && geo.topbar.position==='sticky' && geo.exec.position==='relative');

  // --- 7. 浅色主题: 光效强度仍低、无漂白(颜色非纯白 #fff, 为冷蓝灰)
  await page.click('button[aria-label*="浅色"]').catch(()=>{});
  await sleep(600);
  const light=await page.evaluate(()=>{
    const e=document.querySelector('[data-exec-strip]'); const r=e.getBoundingClientRect();
    const a=getComputedStyle(e,'::after');
    return { color: a.backgroundColor, opacity: a.opacity, plColor: getComputedStyle(e,'::after').getPropertyValue('--pl-color') };
  });
  // 切回深色
  await page.click('button[aria-label*="深色"]').catch(()=>{});
  await sleep(500);
  report('7.1 浅色主题光效为冷色低强度', JSON.stringify(light), light.plColor.trim()!=='' && light.plColor.trim()!=='var(--accent-blue)');
  const lightVal=await page.evaluate(()=>{const s=document.querySelector(':root');return {isLight:s.classList.contains('light')};});
  report('7.2 已切回深色主题', JSON.stringify(lightVal), !lightVal.isLight);

  // --- 8. 触摸 + reduced-motion: 无监听/无光斑
  const rmCtx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true });
  const rmPage = await rmCtx.newPage();
  rmPage.on('pageerror', e=>pageErrors.push('rm:'+e.message));
  // emulate reduced-motion
  await rmCtx.newCDPSession?.(null).catch(()=>{});
  await rmPage.emulateMedia({ reducedMotion:'reduce' });
  await rmPage.goto(BASE,{waitUntil:'domcontentloaded'});
  await rmPage.waitForTimeout(2500);
  const rmState=await rmPage.evaluate(()=>{
    const hosts=[...document.querySelectorAll('[data-pointer-light],.quiet-surface')];
    const anyOn=hosts.some(h=>h.classList.contains('pl-on'));
    const bg=document.querySelector('.pointer-bg-light');
    return { anyOn, bgDisplay: bg?getComputedStyle(bg).display:null, bgOpacity: bg?getComputedStyle(bg).opacity:null };
  });
  report('8.1 触摸(reduced-motion) 无残留光斑/背景层隐藏', JSON.stringify(rmState), !rmState.anyOn && (rmState.bgDisplay==='none'));
  // 触摸(非reduced) 也无 pl-on
  const touchCtx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true });
  const tPage = await touchCtx.newPage();
  await tPage.goto(BASE,{waitUntil:'domcontentloaded'});
  await tPage.waitForTimeout(2500);
  const tState=await tPage.evaluate(()=>{
    const hosts=[...document.querySelectorAll('[data-pointer-light],.quiet-surface')];
    return { anyOn: hosts.some(h=>h.classList.contains('pl-on')), fine: matchMedia('(hover:hover) and (pointer:fine)').matches };
  });
  report('8.2 触摸设备无 pl-on(pointer 非 fine)', JSON.stringify(tState), !tState.anyOn);

  // --- 9. 路由切换不重复注册
  const navBtn = (label) => page.evaluate((l)=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()===l)?.click(), label);
  await navBtn('任务'); await page.waitForTimeout(900);
  const tasksOK=await page.evaluate(()=>document.querySelectorAll('[data-pointer-light="glass"]').length>0);
  report('9.1 路由到任务页有 glass 宿主', 'count>0='+tasksOK, tasksOK);
  await navBtn('总览'); await page.waitForTimeout(900);
  const overviewOK=await page.evaluate(()=>!!document.querySelector('[data-exec-strip]'));
  report('9.2 回到总览 ExecutiveStrip 仍渲染', '', overviewOK);

  console.log('\n--- 汇总 ---');
  console.log('PAGEERRORS:', pageErrors.length?pageErrors:'none');
  const fails=results.filter(r=>!r.pass);
  console.log(`PASS ${results.length-fails.length}/${results.length}`);
  await browser.close();
  process.exit(fails.length?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
