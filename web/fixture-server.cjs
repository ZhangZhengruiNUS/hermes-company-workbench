// fixture-server.cjs — 独立 mock 后端 + /next/ 静态服务(零依赖, raw Node http)
// 用于 Phase B B3~B7 行为验收: 用可控场景驱动真实 React /next/ 构建。
//  - /api/v1/board | /events | /automations | /profiles | /tasks/<id> | /stream(SSE)
//  - /next/ 静态文件来自 web/dist
//  - /avatars/* 返回占位 1x1 PNG
//  - /_ctl/*   测试控制端点(reset/add/broadcast/sse/stall/fail/setAutomation/injectRule/stats)
//
// 启动: node fixture-server.cjs  (默认端口 18123, 环境变量 FIXTURE_PORT 可改)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DIST = '/home/ubuntu/hermes-company-workbench/web/dist';
const PORT = Number(process.env.FIXTURE_PORT || 18123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};
// 1x1 透明 PNG
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const KINDS = ['claimed', 'created', 'spawned', 'reviewed', 'blocked', 'completed'];

// ---------------------------------------------------------------- state
const state = {
  tasks: [],
  projects: [],
  profiles: [],
  automations: [],
  events: [],
  nextId: 1,
  eventsCursor: 0,
  sseOn: true,
  stall: false,
  inject: null,
  failSources: {},
  sourceOkFalse: {},
  // B.1.4 乱序完成: 延迟特定 after 的 events-after 响应, 返回一个更旧的(更小)游标,
  // 模拟"较旧 catchup 后返回" — 断言前端 evCursor 不因此回退(Math.max 单调)
  delayAfter: null,
  sseClients: new Set(),
  pendingBroadcasts: [],
  stats: {
    eventsAfter: [],
    desc: 0,
    board: 0,
    automations: 0,
    profiles: 0,
    streamConnections: 0,
    taskDetail: 0,
  },
};

function mkEvent(i) {
  return {
    id: i,
    task_id: 't_alpha',
    kind: KINDS[i % KINDS.length],
    title: 'fixture-event-' + i,
    assignee: 'frontend',
    created_at: 1758000000 + i,
    payload: { n: i },
  };
}

function statusCounts(tasks) {
  const m = {};
  for (const t of tasks) m[t.status] = (m[t.status] || 0) + 1;
  return m;
}

// 确定性基线数据(含九状态 + 未知状态 + 独立任务 + 项目)
function buildBaseline() {
  const B = 1758000000;
  const tasks = [
    { id: 't_alpha', title: '执行: Phase B 施工', status: 'running', assignee: 'frontend', project_id: 'proj_aurora', priority: 'high', created_at: B, started_at: B + 10, completed_at: null, has_run: true, result_preview: '推进中' },
    { id: 't_triage', title: '分诊: 新需求收集', status: 'triage', assignee: 'researcher', project_id: 'proj_aurora', priority: 'med', created_at: B - 100, started_at: null, completed_at: null, has_run: false, result_preview: null },
    { id: 't_todo', title: '待办: 资料整理', status: 'todo', assignee: 'archivist', project_id: 'proj_cron', priority: 'low', created_at: B - 200, started_at: null, completed_at: null, has_run: false, result_preview: null },
    { id: 't_sched', title: '已排期: 周报准备', status: 'scheduled', assignee: 'secretary', project_id: 'proj_cron', priority: 'med', created_at: B - 300, started_at: null, completed_at: null, has_run: false, result_preview: null },
    { id: 't_ready1', title: '就绪: 数据核对', status: 'ready', assignee: 'backend', project_id: 'proj_aurora', priority: 'med', created_at: B - 400, started_at: null, completed_at: null, has_run: false, result_preview: null },
    { id: 't_ready2', title: '就绪无负责人: 独立调研', status: 'ready', assignee: null, project_id: null, priority: 'low', created_at: B - 420, started_at: null, completed_at: null, has_run: false, result_preview: null },
    { id: 't_block', title: '阻塞: 外部依赖等待', status: 'blocked', assignee: 'pm', project_id: 'proj_aurora', priority: 'high', created_at: B - 500, started_at: B - 490, completed_at: null, has_run: true, result_preview: null },
    { id: 't_review', title: '待审: 报告初稿', status: 'review', assignee: 'reviewer', project_id: 'proj_cron', priority: 'med', created_at: B - 600, started_at: B - 590, completed_at: null, has_run: true, result_preview: '已提交初稿' },
    { id: 't_done1', title: '完成: 里程碑一', status: 'done', assignee: 'frontend', project_id: 'proj_aurora', priority: 'high', created_at: B - 1000, started_at: B - 990, completed_at: B - 700, has_run: true, result_preview: '已交付' },
    { id: 't_done2', title: '完成: 基建搭建', status: 'done', assignee: 'backend', project_id: 'proj_aurora', priority: 'med', created_at: B - 1100, started_at: B - 1090, completed_at: B - 800, has_run: true, result_preview: '完成' },
    { id: 't_arch1', title: '归档: 旧调研A', status: 'archived', assignee: 'researcher', project_id: 'proj_arch', priority: 'low', created_at: B - 2000, started_at: B - 1900, completed_at: B - 1500, has_run: true, result_preview: '归档' },
    { id: 't_arch2', title: '归档: 旧任务B', status: 'archived', assignee: 'secretary', project_id: 'proj_arch', priority: 'low', created_at: B - 2100, started_at: B - 2000, completed_at: B - 1600, has_run: true, result_preview: '归档' },
    { id: 't_unknown', title: '未知状态: 实验任务', status: 'mystery', assignee: null, project_id: null, priority: 'low', created_at: B - 3000, started_at: null, completed_at: null, has_run: false, result_preview: null },
  ];
  const projects = [
    { id: 'proj_aurora', name: 'Aurora Glass', description: 'Phase B 施工', color: '#6aa8ff', created_at: B - 5000 },
    { id: 'proj_cron', name: '日常运营', description: '例行事务', color: '#ffb454', created_at: B - 4000 },
    { id: 'proj_arch', name: '历史归档', description: '已归档项目', color: '#9aa0a6', created_at: B - 3000 },
  ];
  const profiles = [
    { name: 'secretary', cn: '行政秘书', role: '运营线', department: '运营', model: 'gpt-4o' },
    { name: 'researcher', cn: '研究员', role: '研发线', department: '研发', model: 'claude' },
    { name: 'reviewer', cn: '审查员', role: '研发线', department: '研发', model: 'claude' },
    { name: 'frontend', cn: '前端', role: '研发线', department: '研发', model: 'gpt-4o' },
    { name: 'backend', cn: '后端', role: '研发线', department: '研发', model: 'gpt-4o' },
    { name: 'pm', cn: '项目经理', role: '运营线', department: '运营', model: 'claude' },
  ];
  const automations = [
    { name: 'daily-report', schedule: '0 9 * * *', schedule_display: '每日 09:00', state: 'enabled', last_status: null, has_issue: false, issue_summary: '', last_error: null, last_delivery_error: null, next_run_at: null },
    { name: 'weekly-summary', schedule: '0 10 * * 1', schedule_display: '每周一 10:00', state: 'enabled', last_status: 'ok', has_issue: false, issue_summary: '', last_error: null, last_delivery_error: null, next_run_at: null },
    { name: 'monitor-heartbeat', schedule: '*/5 * * * *', schedule_display: '每 5 分钟', state: 'paused', last_status: 'ok', has_issue: false, issue_summary: '', last_error: null, last_delivery_error: null, next_run_at: null },
  ];
  return { tasks, projects, profiles, automations };
}

// ---------------------------------------------------------------- reset
function reset(opts) {
  Object.assign(state, buildBaseline());
  state.events = [];
  state.nextId = 1;
  const nBaseline = opts.baseline != null ? Number(opts.baseline) : 10;
  for (let i = 1; i <= nBaseline; i++) state.events.push(mkEvent(i));
  state.nextId = nBaseline + 1;
  state.eventsCursor = nBaseline;
  state.sseOn = opts.sse !== '0';
  state.stall = false;
  state.inject = null;
  state.failSources = {};
  state.sourceOkFalse = {};
  state.delayAfter = null;
  state.pendingBroadcasts = [];
  state.stats = { eventsAfter: [], desc: 0, board: 0, automations: 0, profiles: 0, streamConnections: 0, taskDetail: 0 };
}

// ---------------------------------------------------------------- api handlers
function publicEvent(e) {
  return {
    id: e.id, task_id: e.task_id, kind: e.kind, title: e.title,
    assignee: e.assignee, created_at: e.created_at, payload: e.payload,
  };
}

function handleEventsAsc(after, limit) {
  const cands = state.events.filter((e) => e.id > after); // 数组保持 id 升序
  const page = cands.slice(0, limit);
  // 注入规则: 在第 afterNth 个非空分页响应之后追加 count 个新事件(模拟翻页期间插入)
  if (state.inject && page.length > 0) {
    state.inject.n = (state.inject.n || 0) + 1;
    if (state.inject.n === state.inject.afterNth) {
      for (let k = 0; k < state.inject.count; k++) state.events.push(mkEvent(state.nextId++));
    }
  }
  const ids = page.map((e) => e.id);
  const rec = { after, count: page.length, ids, ts: Date.now() };
  if (state.stall && page.length > 0) {
    // 模拟 has_more=true 但游标停滞 → live.ts 应抛 "cursor stalled" 停止递归(无死循环)
    rec.has_more = true; rec.next_cursor = after; rec.stalled = true;
    state.stats.eventsAfter.push(rec);
    return { events: page.map(publicEvent), has_more: true, next_cursor: after, cursor: after, after };
  }
  const hasMore = cands.length > limit;
  const nextCursor = page.length ? page[page.length - 1].id : after;
  rec.has_more = hasMore; rec.next_cursor = nextCursor;
  // B.1.4 乱序完成: 若命中 delayAfter, 返回一个比真实游标更旧的 next_cursor
  // (模拟较旧 catchup 携带旧快照后返回), 由响应层负责延迟发送。一次性: 命中后即清除,
  // 保证仅一个"较旧 catchup"被延迟, 另一个(较新)catchup 正常快速返回更高游标。
  if (state.delayAfter && state.delayAfter.after === after) {
    rec.stale = true; rec.stale_cursor = state.delayAfter.staleCursor;
    state.stats.eventsAfter.push(rec);
    // 关键: stale 响应必须"携带事件"(ed.events.length>0), 否则 live.ts 的
    // `if (ed.events.length) advanceEvCursor(...)` 不会提交这个低游标, 单调保护形同虚设。
    // 返回 page 事件, 但 next_cursor 是旧的(更小)游标 → 模拟较旧 catchup 携带旧快照后返回。
    const stale = {
      events: page.map(publicEvent),
      has_more: false,
      next_cursor: state.delayAfter.staleCursor,
      cursor: after,
      after,
      stale: true,
      staleMs: state.delayAfter.ms,
    };
    state.delayAfter = null; // 一次性
    return stale;
  }
  state.stats.eventsAfter.push(rec);
  return { events: page.map(publicEvent), has_more: hasMore, next_cursor: nextCursor, cursor: after, after };
}

function handleEventsDesc(limit) {
  const cap = limit || 200;
  const sortedDesc = state.events.slice().sort((a, b) => b.id - a.id);
  const page = sortedDesc.slice(0, cap);
  state.stats.desc++;
  return {
    events: page.map(publicEvent),
    has_more: page.length < state.events.length,
    next_before: page.length ? page[page.length - 1].id : 0,
    cursor: 0,
  };
}

function handleEvents(q) {
  const after = q.get('after');
  const order = q.get('order');
  const limit = q.get('limit') ? Number(q.get('limit')) : 200;
  let data;
  if (order === 'desc') {
    data = handleEventsDesc(limit);
  } else if (after != null) {
    data = handleEventsAsc(Number(after) || 0, 200);
  } else {
    data = handleEventsDesc(8); // 默认最近 8 条
  }
  return { ok: true, data };
}

function handleBoard() {
  state.stats.board++;
  return {
    ok: true,
    data: {
      tasks: state.tasks,
      projects: state.projects,
      projects_ok: true,
      projects_error: '',
      events_cursor: state.eventsCursor,
      fetched_at: Math.floor(Date.now() / 1000),
      counts: statusCounts(state.tasks),
    },
  };
}

function handleAutomations() {
  state.stats.automations++;
  if (state.failSources.automations) {
    return { __status: 503, ok: false, error: 'automations unavailable' };
  }
  if (state.sourceOkFalse.automations) {
    // HTTP 200 但 source_ok=false: 内部源失败, 不得伪装成空成功
    return { ok: true, data: { automations: [], source_ok: false } };
  }
  return { ok: true, data: { automations: state.automations, source_ok: true } };
}

function handleProfiles() {
  state.stats.profiles++;
  if (state.failSources.profiles) {
    return { __status: 503, ok: false, error: 'profiles unavailable' };
  }
  if (state.sourceOkFalse.profiles) {
    // HTTP 200 但 source_ok=false: 内部源失败, 不得伪装成空成功
    return { ok: true, data: { profiles: [], source_ok: false } };
  }
  return { ok: true, data: state.profiles };
}

function handleTaskDetail(id) {
  state.stats.taskDetail++;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return { __status: 404, ok: false, error: 'task not found' };
  return {
    ok: true,
    data: {
      ...t,
      body: '任务要求占位 body',
      body_full: '任务要求完整描述(来自详情接口): 需要完成 Phase B 相关施工。',
      result: '最终结果占位 result',
      result_full: '最终结果完整描述: 已按规格完成并部署 /next/。',
      project_name: t.project_id ? (state.projects.find((p) => p.id === t.project_id)?.name || '') : '',
      runs: [
        { id: 1, profile: 'frontend', step_key: 'execute', status: t.status === 'done' ? 'succeeded' : 'running', started_at: t.started_at || 1758000000, ended_at: t.completed_at, outcome: t.status === 'done' ? 'succeeded' : 'running', summary: '施工中' },
      ],
      events: state.events.slice(-8).map((e) => ({ id: e.id, kind: e.kind, created_at: e.created_at })),
      upstream: [{ id: 't_review', title: '待审: 报告初稿', status: 'review' }],
      downstream: [{ id: 't_block', title: '阻塞: 外部依赖等待', status: 'blocked' }],
    },
  };
}

// ---------------------------------------------------------------- SSE
function broadcast(msg) {
  if (state.sseClients.size === 0) {
    state.pendingBroadcasts.push(msg);
    return;
  }
  const payload = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of state.sseClients) {
    try { res.write(payload); } catch (_) { /* noop */ }
  }
}

function handleSSE(req, res) {
  if (!state.sseOn) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('stream unavailable');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  state.stats.streamConnections++;
  res.write(': connected\n\n');
  state.sseClients.add(res);
  // hello 水位
  res.write('data: ' + JSON.stringify({ type: 'hello', cursor: state.eventsCursor }) + '\n\n');
  // 补发排队消息
  if (state.pendingBroadcasts.length) {
    const queued = state.pendingBroadcasts;
    state.pendingBroadcasts = [];
    for (const m of queued) res.write('data: ' + JSON.stringify(m) + '\n\n');
  }
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) { /* noop */ }
  }, 15000);
  req.on('close', () => {
    clearInterval(keepalive);
    state.sseClients.delete(res);
  });
}

// ---------------------------------------------------------------- control
function getQuery(reqUrl) {
  return new URL(reqUrl, 'http://x').searchParams;
}

function handleControl(reqUrl, res) {
  const q = getQuery(reqUrl);
  const path = new URL(reqUrl, 'http://x').pathname;
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (path === '/_ctl/ping') return send({ ok: true, pong: Date.now() });

  if (path === '/_ctl/reset') {
    reset({ baseline: q.get('baseline') ?? 10, sse: q.get('sse') ?? '1' });
    return send({ ok: true, baseline: state.events.length, eventsCursor: state.eventsCursor, sseOn: state.sseOn });
  }

  if (path === '/_ctl/add') {
    const count = Number(q.get('count') || 0);
    const kind = q.get('kind') || 'claimed';
    const start = state.nextId;
    for (let k = 0; k < count; k++) {
      const e = mkEvent(state.nextId++);
      e.kind = kind;
      state.events.push(e);
    }
    state.eventsCursor = state.nextId - 1;
    return send({ ok: true, added: count, range: [start, state.nextId - 1], eventsCursor: state.eventsCursor });
  }

  if (path === '/_ctl/broadcast') {
    const type = q.get('type') || 'events';
    if (type === 'events') broadcast({ type: 'events', cursor: state.eventsCursor, count: state.events.length });
    else if (type === 'profiles_changed') broadcast({ type: 'profiles_changed' });
    else if (type === 'hello') broadcast({ type: 'hello', cursor: state.eventsCursor });
    else if (type === 'source_error') broadcast({ type: 'source_error' });
    else if (type === 'resync') broadcast({ type: 'resync' });
    else return send({ ok: false, error: 'unknown type' });
    return send({ ok: true, type });
  }

  if (path === '/_ctl/sse') {
    state.sseOn = q.get('on') !== '0';
    return send({ ok: true, sseOn: state.sseOn });
  }

  if (path === '/_ctl/stall') {
    state.stall = q.get('on') !== '0';
    return send({ ok: true, stall: state.stall });
  }

  // B.1.4 乱序完成: 对指定 after 的 events-after 响应延迟 ms 毫秒, 返回 staleCursor(更旧游标)
  if (path === '/_ctl/delayAfter') {
    const on = q.get('on') !== '0';
    state.delayAfter = on
      ? { after: Number(q.get('after') || 0), ms: Number(q.get('ms') || 500), staleCursor: Number(q.get('staleCursor') != null ? q.get('staleCursor') : q.get('after') || 0) }
      : null;
    return send({ ok: true, delayAfter: state.delayAfter });
  }

  if (path === '/_ctl/injectRule') {
    state.inject = { afterNth: Number(q.get('afterNth') || 2), count: Number(q.get('count') || 3), n: 0 };
    return send({ ok: true, inject: state.inject });
  }

  if (path === '/_ctl/fail') {
    const source = q.get('source');
    if (!['automations', 'profiles', 'events'].includes(source)) return send({ ok: false, error: 'bad source' });
    state.failSources[source] = q.get('on') !== '0';
    return send({ ok: true, failSources: state.failSources });
  }
  // source_ok=false 模拟: HTTP 200 但子源内部失败 (不伪装成空成功)
  if (path === '/_ctl/sourceOkFalse') {
    const source = q.get('source');
    if (!['automations', 'profiles'].includes(source)) return send({ ok: false, error: 'bad source' });
    state.sourceOkFalse[source] = q.get('on') !== '0';
    return send({ ok: true, sourceOkFalse: state.sourceOkFalse });
  }

  if (path === '/_ctl/setAutomation') {
    const name = q.get('name');
    const field = q.get('field');
    const value = q.get('value');
    const a = state.automations.find((x) => x.name === name);
    if (!a) return send({ ok: false, error: 'no such automation' });
    if (value === 'null') a[field] = null; else a[field] = value;
    return send({ ok: true, automation: a });
  }

  if (path === '/_ctl/setProfile') {
    const name = q.get('name');
    const field = q.get('field');
    const value = q.get('value');
    const p = state.profiles.find((x) => x.name === name);
    if (!p) return send({ ok: false, error: 'no such profile' });
    p[field] = value;
    return send({ ok: true, profile: p });
  }

  if (path === '/_ctl/stats') return send(state.stats);

  return send({ ok: false, error: 'unknown control: ' + path });
}

// ---------------------------------------------------------------- static
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- server
const server = http.createServer((req, res) => {
  const url = req.url;

  if (url.startsWith('/_ctl/')) return handleControl(url, res);

  if (url.startsWith('/api/v1/stream')) return handleSSE(req, res);

  if (url.startsWith('/api/v1/tasks/')) {
    const id = decodeURIComponent(url.replace('/api/v1/tasks/', '').split('?')[0]);
    const out = handleTaskDetail(id);
    if (out.__status) { res.writeHead(out.__status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }

  if (url.startsWith('/api/v1/events')) {
    const q = getQuery(url);
    const out = handleEvents(q);
    // B.1.4 乱序完成: 若响应标记 stale, 延迟发送以模拟"较旧 catchup 后返回"
    if (out.data && out.data.stale) {
      console.log('[B8-SRV ' + Date.now() + '] stale after=' + out.data.after + ' delaying ' + (out.data.staleMs||500) + 'ms cursor=' + out.data.next_cursor);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      }, out.data.staleMs || 500);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }

  if (url.startsWith('/api/v1/board')) {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(handleBoard())); return;
  }

  if (url.startsWith('/api/v1/automations')) {
    const out = handleAutomations();
    if (out.__status) { res.writeHead(out.__status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }

  if (url.startsWith('/api/v1/profiles')) {
    const out = handleProfiles();
    if (out.__status) { res.writeHead(out.__status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }

  if (url.startsWith('/avatars/')) {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return;
  }

  if (url.startsWith('/next/')) {
    let p = url.replace(/^\/next\//, '').split('?')[0];
    if (p === '' || p === '/') p = 'index.html';
    serveStatic(res, path.join(DIST, p));
    return;
  }

  res.writeHead(404); res.end('route not mapped: ' + url);
});

server.listen(PORT, () => {
  console.log('fixture-server on http://127.0.0.1:' + PORT + '/next/ (mock /api/, /_ctl/, SSE)');
});
