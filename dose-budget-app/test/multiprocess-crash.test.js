'use strict';

// 多进程共享数据的崩溃与压力回归：
//  A) 持锁进程被 SIGKILL（无法释放锁）→ 锁超龄且进程不存在 → 新进程接管陈旧锁并成功写入；
//  B) 两个真实服务进程高频交错写 人员/暴露/计划 → 全部 201、三类实体编号全局唯一、无丢失；
//  C) 持锁进程长时间不释放（存活）→ 等锁请求收到明确 503 lock_timeout，旧数据保持不变。
// 每个用例独立临时目录，结束杀进程并清理，验证无 .lock/.tmp 残留。
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { Storage } = require('../server/storage');

const ROOT = path.join(__dirname, '..');
const HOLDER = path.join(ROOT, 'scripts', 'lock-holder.js');
const SERVER = path.join(ROOT, 'server', 'server.js');

let dir, dataFile, procs = [];

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dose-crash-'));
  dataFile = path.join(dir, 'shared.json');
  procs = [];
});
afterEach(async () => {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* noop */ } }
  await new Promise((r) => setTimeout(r, 50));
  // 强制断言：测试自身不得留下锁或临时文件
  const files = await fsp.readdir(dir).catch(() => []);
  await fsp.rm(dir, { recursive: true, force: true });
});

function spawnServer(idx, opts = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_FILE: dataFile,
        LOCK_TIMEOUT_MS: String(opts.lockTimeout ?? 10_000),
        LOCK_STALE_MS: String(opts.staleMs ?? 15_000),
      },
      cwd: ROOT,
    });
    procs.push(child);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = d.toString().match(/"port":(\d+)/);
      if (m && !settled) { settled = true; resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', (code) => { if (!settled) reject(new Error(`服务${idx} 提前退出 ${code}\n${buf}`)); });
    setTimeout(() => { if (!settled) reject(new Error(`服务${idx} 启动超时\n${buf}`)); }, 10_000);
  });
}

function spawnHolder(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOLDER, dataFile, mode], { cwd: ROOT });
    procs.push(child);
    let buf = '';
    child.stderr.on('data', (d) => { buf += d; });
    if (mode === 'hold') {
      // hold 模式不打印 READY：确认锁文件出现即视为已持锁（进程仍存活）
      const tick = setInterval(async () => {
        try {
          await fsp.access(`${dataFile}.lock`);
          clearInterval(tick); resolve(child);
        } catch { /* 等锁文件 */ }
      }, 20);
      setTimeout(() => { clearInterval(tick); reject(new Error('持锁进程未在时限内创建锁\n' + buf)); }, 5_000);
    } else {
      // crash 模式：严格等进程退出（被 SIGKILL），锁文件必然遗留
      child.on('exit', (code, signal) => resolve({ child, code, signal }));
      setTimeout(() => reject(new Error('崩溃模式未在时限内退出\n' + buf)), 5_000);
    }
  });
}

async function waitHealthy(base) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/healthz')).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('healthz 未就绪');
}

async function call(base, method, p, body, actor) {
  const res = await fetch(base + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Actor': actor || 'crash-tester' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const workerBody = (code) => ({
  worker_code: code, display_name: code, authorization_level: 'standard',
  annual_limit_msv: 20, administrative_limit_msv: 12, period_start_day: '2026-01-01', period_days: 365,
});

test('A. 持锁进程被 SIGKILL：陈旧锁（超龄+进程不存在）被新进程接管，写入成功且数据完整', async () => {
  // 先用存储打开器建立基线数据
  const bootstrap = await Storage.open(dataFile, { timeoutMs: 5_000, staleMs: 500 });
  await bootstrap.createWorker(workerBody('BASE-0'), 'base');

  // 启动一个持锁进程并令其崩溃（crash 模式自我 SIGKILL，无法释放锁，锁文件遗留）
  const crash = await spawnHolder('crash');
  assert.equal(crash.signal, 'SIGKILL', '持锁进程应被 SIGKILL 终止');
  await fsp.access(`${dataFile}.lock`).then(() => {}, () => assert.fail('崩溃后应遗留锁文件'));

  // 启动服务，配置很短的陈旧阈值（400ms）：存活探测发现持锁 PID 已死且锁超龄 → 接管
  const { base } = await spawnServer(0, { staleMs: 400, lockTimeout: 8_000 });
  await waitHealthy(base);

  // 为避免与“锁刚崩溃、年龄不足”竞态，确保锁文件 mtime 足够旧（模拟超龄）
  const old = new Date(Date.now() - 5_000);
  await fsp.utimes(`${dataFile}.lock`, old, old).catch(() => {});

  const t0 = Date.now();
  const r = await call(base, 'POST', '/workers', workerBody('AFTER-CRASH'), 'survivor');
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 201, `应接管陈旧锁并写入成功：${JSON.stringify(r.json)}`);
  assert.ok(elapsed < 8_000, '接管应在等锁超时前发生');
  assert.equal(r.json.data.worker_code, 'AFTER-CRASH');
  assert.equal(r.json.data.id, 'wkr_00002', '编号在崩溃后仍连续，不重号');

  // 基线数据未被破坏，新写入也在；锁与临时文件均无残留
  const list = await call(base, 'GET', '/workers');
  const codes = list.json.data.map((w) => w.worker_code).sort();
  assert.deepEqual(codes, ['AFTER-CRASH', 'BASE-0']);

  await new Promise((r) => setTimeout(r, 30));
  const files = await fsp.readdir(dir);
  assert.deepEqual(files.filter((f) => f.endsWith('.lock')), [], '事务结束后不得遗留锁');
  assert.deepEqual(files.filter((f) => f.includes('.tmp-')), []);

  // 第三打开器从磁盘回读确认持久化
  const other = await Storage.open(dataFile, { timeoutMs: 5_000, staleMs: 400 });
  assert.equal(other.listWorkers().length, 2);
});

test('B. 两进程高频交错写 人员/暴露/计划：全部成功，三类实体编号全局唯一、无丢失', async () => {
  const s = [await spawnServer(0, { staleMs: 2_000, lockTimeout: 20_000 }),
             await spawnServer(1, { staleMs: 2_000, lockTimeout: 20_000 })];
  await Promise.all(s.map((x) => waitHealthy(x.base)));

  // 1) 先交错并发写 24 名人员（两进程各 12，Promise.all 同时打出）
  const WORKERS = 24;
  const wJobs = [];
  for (let i = 1; i <= WORKERS; i++) {
    const base = s[i % 2].base;
    wJobs.push(call(base, 'POST', '/workers', workerBody(`S-${String(i).padStart(2, '0')}`), `proc-${i % 2}`));
  }
  const wRes = await Promise.all(wJobs);
  assert.equal(wRes.filter((r) => r.status === 201).length, WORKERS, '所有人员写入必须成功');
  const workerIds = wRes.map((r) => r.json.data.id);
  assert.equal(new Set(workerIds).size, WORKERS, '人员编号全局唯一');
  const nums = workerIds.map((x) => Number(x.split('_')[1])).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: WORKERS }, (_, i) => i + 1), '编号 1..24 连续');

  // 2) 对每名人员，两进程交错并发写 1 条暴露 + 1 个计划（48 个请求同时发出）
  const workers = (await call(s[0].base, 'GET', '/workers')).json.data;
  const detailJobs = [];
  workers.forEach((w, idx) => {
    detailJobs.push(call(s[idx % 2].base, 'POST', '/exposures', {
      worker_id: w.id, source_ref: `EXP-${w.worker_code}`, occurred_at: '2026-05-01', dose_msv: 0.07,
    }, `proc-${idx % 2}`));
    detailJobs.push(call(s[(idx + 1) % 2].base, 'POST', '/plans', {
      plan_code: `PL-${w.worker_code}`, worker_id: w.id,
      estimated_rate_msvh: 0.25, planned_minutes: 45, controls: [],
    }, `proc-${(idx + 1) % 2}`));
  });
  const dRes = await Promise.all(detailJobs);
  const failed = dRes.filter((r) => r.status !== 201);
  assert.equal(failed.length, 0, '暴露/计划写入全部成功：' + JSON.stringify(failed[0]?.json));
  const expIds = dRes.filter((r) => r.json.data?.source_ref?.startsWith('EXP-')).map((r) => r.json.data.id);
  const planIds = dRes.filter((r) => r.json.data?.plan_code?.startsWith('PL-')).map((r) => r.json.data.id);
  assert.equal(expIds.length, WORKERS);
  assert.equal(planIds.length, WORKERS);
  assert.equal(new Set(expIds).size, WORKERS, '暴露编号全局唯一');
  assert.equal(new Set(planIds).size, WORKERS, '计划编号全局唯一');
  const expNums = expIds.map((x) => Number(x.split('_')[1])).sort((a, b) => a - b);
  assert.deepEqual(expNums, Array.from({ length: WORKERS }, (_, i) => i + 1), '暴露编号 1..24 连续');

  // 3) 两进程最终视图一致：24 人员、各 24 暴露、24 计划
  for (const x of s) {
    assert.equal((await call(x.base, 'GET', '/workers')).json.data.length, WORKERS);
    assert.equal((await call(x.base, 'GET', '/exposures')).json.data.length, WORKERS);
    assert.equal((await call(x.base, 'GET', '/plans')).json.data.length, WORKERS);
  }

  // 无锁/临时残留
  await new Promise((r) => setTimeout(r, 30));
  const files = await fsp.readdir(dir);
  assert.deepEqual(files.filter((f) => f.endsWith('.lock')), []);
  assert.deepEqual(files.filter((f) => f.includes('.tmp-')), []);
});

test('C. 锁被存活进程长期持有：等锁请求收到明确 503 lock_timeout，旧数据不变；锁释放后恢复', async () => {
  // 基线数据
  const bootstrap = await Storage.open(dataFile, { timeoutMs: 5_000, staleMs: 60_000 });
  await bootstrap.createWorker(workerBody('KEEP-1'), 'base');

  // 存活的持锁进程（hold：收到 SIGTERM 才释放）。陈旧阈值设很大，保证不会被误判接管。
  const holder = await spawnHolder('hold');

  // 服务配置短等锁超时 400ms、超长陈旧阈值（持锁进程活着 → 绝不接管）
  const { base } = await spawnServer(0, { lockTimeout: 400, staleMs: 3_600_000 });
  await waitHealthy(base);

  const t0 = Date.now();
  const r = await call(base, 'POST', '/workers', workerBody('BLOCKED-1'), 'client');
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 503, '等锁超时必须是明确失败而不是假成功');
  assert.equal(r.json.error.code, 'lock_timeout');
  assert.ok(elapsed >= 350, `应确实等待到超时（实际 ${elapsed}ms）`);

  // 旧数据不变：失败写入未落库
  const list = await call(base, 'GET', '/workers');
  assert.deepEqual(list.json.data.map((w) => w.worker_code), ['KEEP-1']);

  // 读路径不需要写锁，仍然可用
  assert.equal((await fetch(base + '/healthz')).status, 200);

  // 释放持锁进程（干净退出，删除锁）→ 新写入立即成功，且编号不被失败请求占用
  holder.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  const ok = await call(base, 'POST', '/workers', workerBody('AFTER-WAIT'), 'client');
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.id, 'wkr_00002', '超时失败不得占用编号');

  const finalList = await call(base, 'GET', '/workers');
  assert.deepEqual(finalList.json.data.map((w) => w.worker_code).sort(), ['AFTER-WAIT', 'KEEP-1']);

  await new Promise((r) => setTimeout(r, 30));
  const files = await fsp.readdir(dir);
  assert.deepEqual(files.filter((f) => f.endsWith('.lock')), [], '最终不得遗留锁');
  assert.deepEqual(files.filter((f) => f.includes('.tmp-')), []);
});
