// B10 real-server verification: /next/ + Basic Auth + Write-Token coexist
const https = require('https');
const fs = require('fs');

// read creds from private file (not in argv)
const creds = fs.readFileSync('/tmp/.b10creds','utf8').trim().split('\n');
const BASIC_USER = creds[0];
const BASIC_PASS = creds[1];
const WTOKEN = creds[2];
const HOST = 'workbench.zgzwr.site';

function req(opts, headers={}) {
  return new Promise((resolve)=>{
    const r = https.request({
      host: HOST, path: opts.path, method: opts.method || 'GET',
      headers: { 'User-Agent':'Mozilla/5.0', ...(headers.basic ? {Authorization:'Basic '+Buffer.from(headers.basic).toString('base64')} : {}), ...(headers.wt ? {'X-Workbench-Write-Token': headers.wt} : {}) },
      rejectUnauthorized: false,
    }, (res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode, body:d}));
    });
    r.on('error', e=>resolve({status:0, body:String(e)}));
    r.end();
  });
}

(async()=>{
  const results = [];
  const check=(n,ok,d)=>results.push({n,ok,d});

  // 1. /next/ with Basic Auth
  const r1 = await req({path:'/next/'}, {basic:`${BASIC_USER}:${BASIC_PASS}`});
  const jsRef = (r1.body.match(/assets\/index-[A-Za-z0-9_-]+\.js/)||[])[0];
  check('B10 /next/ loads with Basic Auth', r1.status===200 && !!jsRef, `HTTP ${r1.status} ref=${jsRef}`);

  // 2. /next/ without auth -> 401
  const r2 = await req({path:'/next/'});
  check('B10 /next/ rejects without auth', r2.status===401, `HTTP ${r2.status}`);

  // 3. /api/v1/board with Basic Auth only
  const r3 = await req({path:'/api/v1/board'}, {basic:`${BASIC_USER}:${BASIC_PASS}`});
  let boardOk=false; try{ const j=JSON.parse(r3.body); boardOk = r3.status===200 && j.ok && Array.isArray(j.data.tasks); }catch{}
  check('B10 board reads with Basic Auth', boardOk, `HTTP ${r3.status}`);

  // 4. write-status: Basic Auth + Write-Token header coexisting → unlocked 必须为 true
  const r4 = await req({path:'/api/v1/write-status'}, {basic:`${BASIC_USER}:${BASIC_PASS}`, wt: WTOKEN});
  let wok=false, unlocked=null; try{ const j=JSON.parse(r4.body); wok=r4.status===200 && j.ok; unlocked=j.data && j.data.unlocked; }catch{}
  check('B10 Basic Auth + Write-Token coexist → write unlocked', wok && unlocked===true, `HTTP ${r4.status} unlocked=${unlocked}`);

  // 5. write-status without write token -> still reads but write locked (Basic Auth alone OK for read)
  const r5 = await req({path:'/api/v1/write-status'}, {basic:`${BASIC_USER}:${BASIC_PASS}`});
  let r5unlocked=null; try{ const j=JSON.parse(r5.body); r5unlocked = j.data && j.data.unlocked; }catch{}
  check('B10 Basic Auth alone -> readable, write locked', r5.status===200 && r5unlocked===false, `HTTP ${r5.status} unlocked=${r5unlocked}`);

  console.log(`=== B10 REAL-SERVER: ${results.filter(r=>r.ok).length} PASS, ${results.filter(r=>!r.ok).length} FAIL ===`);
  for(const r of results) console.log(`  ${r.ok?'PASS':'FAIL'} ${r.n}: ${r.d}`);
  fs.writeFileSync('/tmp/b10-results.json', JSON.stringify(results,null,2));
})();
