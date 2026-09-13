'use strict';

// 多进程写入竞争回归：两个真实服务进程共享同一个数据文件。
// 修复前：各自基于内存快照写入并 rename → 都报成功、生成重复编号、重开后丢一个进程的数据。
// 修复后：跨进程排他锁 + 锁内重读 → 有效记录全保留、编号唯一连续、唯一约束不被竞态打破。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { Storage } = require('../server/storage');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-multi-'));
const dataFile = path.join(tmpDir, 'shared.json');

const procs = [];
const bases = [];
let logs = ['', ''];

function spawnServer(idx) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      env: {
        ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_FILE: dataFile,
        LOCK_TIMEOUT_MS: '15000', LOCK_STALE_MS: '1000',
      },
      cwd: ROOT,
    });
    procs[idx] = child;
    child.stdout.on('data', (d) => {
      logs[idx] += d;
      const m = d.toString().match(/"port":(\d+)/);
      if (m && !settled) { settled = true; bases[idx] = `http://127.0.0.1:${m[1]}`; resolve(); }
    });
    child.stderr.on('data', (d) => { logs[idx] += d; });
    child.on('exit', (code) => { if (!settled) reject(new Error(`进程${idx} 提前退出 ${code}\n${logs[idx]}`)); });
    setTimeout(() => { if (!settled) reject(new Error(`进程${idx} 启动超时\n${logs[idx]}`)); }, 10000);
  });
}

before(async () => {
  await Promise.all([spawnServer(0), spawnServer(1)]);
  await Promise.all(bases.map(async (b) => {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(b + '/healthz')).ok) return; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('healthz 未就绪');
  }));
});

after(async () => {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* noop */ } }
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

async function call(base, method, p, body, actor) {
  const res = await fetch(base + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Actor': actor || 'mp-tester' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const workerBody = (code, actor) => ({
  worker_code: code, display_name: `多进程 ${code}`, authorization_level: 'standard',
  annual_limit_msv: 20, administrative_limit_msv: 12, period_start_day: '2026-01-01', period_days: 365,
});

test('两个进程同时各写 20 名人员：全部成功、40 条不丢、编号唯一连续', async () => {
  const N = 20;
  const tasks = [];
  for (let i = 0; i < N; i++) {
    tasks.push(call(bases[0], 'POST', '/workers', workerBody(`PA-${String(i + 1).padStart(2, '0')}`), 'proc-A'));
    tasks.push(call(bases[1], 'POST', '/workers', workerBody(`PB-${String(i + 1).padStart(2, '0')}`), 'proc-B'));
  }
  const results = await Promise.all(tasks);

  const bad = results.filter((r) => r.status !== 201);
  assert.equal(bad.length, 0, '每次写入都应成功，不应有丢写：' + JSON.stringify(bad[0]?.json));

  const ids = results.map((r) => r.json.data.id);
  assert.equal(new Set(ids).size, 40, '不得出现重复编号');

  // 两个进程各自立刻读到全部 40 条（锁内重读 + 请求前 reload）
  for (const b of bases) {
    const list = await call(b, 'GET', '/workers');
    assert.equal(list.json.data.length, 40, '两进程视图都应包含全部 40 条');
  }

  // 编号连续 wkr_00001..wkr_00040（计数器在锁内串行推进，不重号不跳号）
  const nums = ids.map((x) => Number(x.split('_')[1])).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: 40 }, (_, i) => i + 1));

  // 锁已释放、无临时文件残留
  const files = await fsp.readdir(tmpDir);
  assert.deepEqual(files.filter((f) => f.endsWith('.lock')), [], '事务后锁文件应释放');
  assert.deepEqual(files.filter((f) => f.includes('.tmp-')), []);
});

test('同一来源并发竞态：两进程同时提交相同 source_ref，恰好一次成功，其余唯一约束拒绝', async () => {
  // 先用进程 A 建一个人员（进程 B 立即可见）
  const w = await call(bases[0], 'POST', '/workers', workerBody('RACE-W'), 'proc-A');
  assert.equal(w.status, 201);
  const wid = w.json.data.id;
  const seenByB = await call(bases[1], 'GET', `/workers/${wid}`);
  assert.equal(seenByB.status, 200, '进程 A 的写入须对进程 B 立即可见');

  const payload = { worker_id: wid, source_ref: 'RACE-SRC', occurred_at: '2026-03-01', dose_msv: 1 };
  const attempts = await Promise.all([
    call(bases[0], 'POST', '/exposures', payload, 'proc-A'),
    call(bases[1], 'POST', '/exposures', payload, 'proc-B'),
    call(bases[0], 'POST', '/exposures', payload, 'proc-A'),
    call(bases[1], 'POST', '/exposures', payload, 'proc-B'),
    call(bases[0], 'POST', '/exposures', payload, 'proc-A'),
  ]);
  const okCount = attempts.filter((a) => a.status === 201).length;
  const dupCount = attempts.filter((a) => a.status === 409 && a.json.error.code === 'duplicate_source_ref').length;
  assert.equal(okCount, 1, '同一来源只能保存一次');
  assert.equal(dupCount, 4, '其余并发提交必须被唯一约束拒绝');

  const list = await call(bases[1], 'GET', `/exposures?worker_id=${wid}`);
  assert.equal(list.json.data.length, 1, '台账中该来源只有一条');
});

test('两进程交错写暴露/计划：编号跨进程不冲突，全部记录保留', async () => {
  const workers = (await call(bases[0], 'GET', '/workers')).json.data.slice(0, 4);
  const jobs = [];
  workers.forEach((w, i) => {
    const base = bases[i % 2];
    for (let k = 1; k <= 3; k++) {
      jobs.push(call(base, 'POST', '/exposures', {
        worker_id: w.id, source_ref: `X-${w.worker_code}-${k}`,
        occurred_at: '2026-04-01', dose_msv: 0.1 * k,
      }, `proc-${i % 2 ? 'B' : 'A'}`));
    }
    jobs.push(call(base, 'POST', '/plans', {
      plan_code: `PLAN-${w.worker_code}`, worker_id: w.id,
      estimated_rate_msvh: 0.2, planned_minutes: 30, controls: [],
    }, `proc-${i % 2 ? 'B' : 'A'}`));
  });
  const rs = await Promise.all(jobs);
  assert.equal(rs.filter((r) => r.status !== 201).length, 0);
  const expIds = rs.filter((r) => r.json.data?.source_ref?.startsWith('X-')).map((r) => r.json.data.id);
  const planIds = rs.filter((r) => r.json.data?.plan_code?.startsWith('PLAN-')).map((r) => r.json.data.id);
  assert.equal(new Set(expIds).size, 12);
  assert.equal(new Set(planIds).size, 4);
});

test('进程全部退出后用第三个存储打开器回读：数据完整、计数器连续、审计含两个操作者', async () => {
  // 独立打开器（模拟修复前“重新打开后丢数据”的场景）
  const store = await Storage.open(dataFile, { timeoutMs: 5000, staleMs: 1000 });
  assert.equal(store.listWorkers().length, 41, '40 并发人员 + 1 竞态人员，一个都不能少');
  const counters = store.db.counters;
  assert.equal(counters.worker, 41);
  // 每条人员编号都能在列表中找到，且编号唯一
  const ids = store.listWorkers().map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  // 审计同时记录了两个进程操作者的写入
  const actors = new Set(store.listAudit().map((a) => a.actor));
  assert.ok(actors.has('proc-A') && actors.has('proc-B'), '两个进程的操作都应在审计中');
  // 两批人员编码都在
  const codes = new Set(store.listWorkers().map((w) => w.worker_code));
  assert.ok(codes.has('PA-01') && codes.has('PA-20') && codes.has('PB-01') && codes.has('PB-20'));
});
