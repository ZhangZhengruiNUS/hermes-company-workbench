#!/usr/bin/env node
// fixture-runner.cjs — Phase B B3~B7 验收编排入口
// 职责: 启动 fixture-server, 运行全部(或指定) B3~B7 Playwright 验收场景, 输出 PASS/FAIL 汇总。
//
// 用法:
//   node fixture-runner.cjs                # 跑全部 5 个场景
//   node fixture-runner.cjs B4             # 只跑 B4
//   node fixture-runner.cjs B3 B6          # 只跑 B3, B6 (逗号分隔亦可: B3,B6)
//
// 依赖: 本地 node_modules/playwright-core (无需安装), chromium 已缓存。
// 输出: 终端 PASS/FAIL; 截图 → web/screenshots/bX-*.png; JSON → /tmp/fixture-acceptance-results.json

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BASE_PORT = 18123;
const SERVER_JS = path.join(__dirname, 'fixture-server.cjs');
const ACCEPTANCE_JS = path.join(__dirname, 'fixture-acceptance.cjs');

function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (++n >= retries) reject(new Error('fixture-server did not become ready'));
          else setTimeout(tryOnce, 500);
        });
    };
    tryOnce();
  });
}

async function main() {
  const filters = process.argv.slice(2).flatMap((a) => a.split(',')).filter(Boolean);

  console.log('── fixture-runner: Phase B B3~B7 acceptance ──');
  const server = spawn('node', [SERVER_JS], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FIXTURE_PORT: String(BASE_PORT) },
  });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));
  server.on('exit', (code) => console.log(`[server] exited with code ${code}`));

  try {
    await waitForServer(`http://127.0.0.1:${BASE_PORT}/_ctl/ping`);
    // 复用 fixture-acceptance 的场景逻辑
    const acceptance = require(ACCEPTANCE_JS);
    await acceptance.runAll(filters.length ? filters[0] : undefined, filters);
  } catch (err) {
    console.error('RUNNER ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => { try { server.kill('SIGTERM'); } catch {} }, 1000);
  }
}

main();
