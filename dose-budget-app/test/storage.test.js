'use strict';

// 存储层可重复运行测试（每个文件独立临时目录，结束时清理）：
// 1) 连续/并发写入不丢记录；2) 临时写入失败后旧数据可回读、内存回滚、临时文件无残留；
// 3) 评估只追加、内容不可变；4) 无删除入口、审计只增；5) 更正事务失败不留半条记录。
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Storage } = require('../server/storage');
const { FileLock } = require('../server/lock');

let dir;
let dbPath;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dose-storage-'));
  dbPath = path.join(dir, 'db.json');
});
afterEach(async () => {
  // 强制：无论断言成败都移除临时目录
  await fsp.rm(dir, { recursive: true, force: true });
});

async function open() { return Storage.open(dbPath); }

function workerInput(code) {
  return {
    worker_code: code, display_name: '测试人员', authorization_level: 'standard',
    annual_limit_msv: 20, administrative_limit_msv: 12,
    period_start_day: '2026-01-01', period_days: 365,
  };
}

const minimalResult = (v) => ({
  as_of_day: '2026-09-01',
  period: { start_day: '2026-01-01', end_day: '2027-01-01', days: 365 },
  period_dose_msv: v, plan: null, planned_increment_msv: 0, projected_dose_msv: v,
  remaining_admin_msv: Math.max(0, 12 - v), remaining_legal_msv: Math.max(0, 20 - v),
  risk_band: 'within_admin', risk_band_label: '行政控制值内', first_exceedance: null,
  five_year: { years: [2022, 2023, 2024, 2025, 2026], per_year: [], average_msv: 0, total_msv: 0, covered_years: [], note: '' },
  requires_manual_review: true, automatic_approval: false, review_prompts: [],
  evidence: { included_entries: [], excluded_entries: [], formulas: {}, threshold_version: 'ALARA-2026.1', near_legal_ratio: 0.9, limits: {} },
});

test('连续写入 30 名人员不丢记录，计数器连续', async () => {
  const s = await open();
  for (let i = 1; i <= 30; i++) await s.createWorker(workerInput(`W-${String(i).padStart(3, '0')}`), 'tester');
  const list = s.listWorkers();
  assert.equal(list.length, 30);
  assert.deepEqual(list.map((w) => w.worker_code).slice(0, 3), ['W-001', 'W-002', 'W-003']);
  // 落盘内容完整
  const onDisk = JSON.parse(await fsp.readFile(dbPath, 'utf8'));
  assert.equal(onDisk.workers.length, 30);
  assert.equal(onDisk.counters.worker, 30);
});

test('并发写入由写队列串行化：40 条暴露记录全部落库不重号不丢失', async () => {
  const s = await open();
  const w = await s.createWorker(workerInput('W-CONC'), 'tester');
  const jobs = Array.from({ length: 40 }, (_, i) =>
    s.createExposure({
      worker_id: w.id, source_ref: `SRC-${i}`,
      occurred_at: '2026-03-01', dose_msv: 0.01, note: '',
    }, 'tester'));
  const results = await Promise.all(jobs);
  assert.equal(results.length, 40);
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 40, 'id 不得重复');
  const rows = s.listExposures({ worker_id: w.id });
  assert.equal(rows.length, 40);
  const refs = new Set(rows.map((r) => r.source_ref));
  assert.equal(refs.size, 40);
});

test('临时文件写入失败：内存回滚、磁盘旧数据可回读、无临时文件残留', async () => {
  const s = await open();
  await s.createWorker(workerInput('W-OLD'), 'tester');
  assert.equal(s.listWorkers().length, 1);

  // 注入一次性 EIO：模拟临时文件写入失败（锁文件 .lock 不受影响，仅 .tmp 失败）
  const origOpen = fsp.open;
  let failed = false;
  fsp.open = async function patchedOpen(p, ...rest) {
    if (String(p).includes('.tmp-') && !failed) {
      failed = true;
      const e = new Error('simulated EIO');
      e.code = 'EIO';
      throw e;
    }
    return origOpen.call(this, p, ...rest);
  };
  try {
    await assert.rejects(
      () => s.createWorker(workerInput('W-NEW'), 'tester'),
      (e) => e.code === 'EIO',
    );
  } finally {
    fsp.open = origOpen;
  }
  assert.equal(failed, true);

  // 内存已回滚：看不到失败事务的人员，计数器也回退
  assert.equal(s.listWorkers().length, 1);
  assert.equal(s.listWorkers()[0].worker_code, 'W-OLD');

  // 回滚后写入链可用，且新 id 不跳号
  const wAfter = await s.createWorker(workerInput('W-AFTER'), 'tester');
  assert.equal(wAfter.id, 'wkr_00002');

  // 磁盘文件未被破坏：重新打开（模拟另一进程回读）得到旧数据 + 恢复后写入
  const s2 = await Storage.open(dbPath);
  const codes = s2.listWorkers().map((w) => w.worker_code).sort();
  assert.deepEqual(codes, ['W-AFTER', 'W-OLD']);

  // 失败事务已释放锁、清理临时文件：无 .tmp/.lock 残留
  const files = await fsp.readdir(dir);
  assert.deepEqual(files.filter((f) => f.includes('.tmp-')), []);
  assert.deepEqual(files.filter((f) => f.endsWith('.lock')), [], '失败事务必须释放锁');
});

test('rename 失败（模拟磁盘满后目录操作失败）：内存回滚且可恢复', async () => {
  const s = await open();
  await s.createWorker(workerInput('W-OLD2'), 'tester');
  const origRename = fsp.rename;
  let hit = false;
  fsp.rename = async function patchedRename(from, to) {
    if (!hit) { hit = true; const e = new Error('simulated rename fail'); e.code = 'EBUSY'; throw e; }
    return origRename.call(this, from, to);
  };
  try {
    await assert.rejects(() => s.createWorker(workerInput('W-LOST'), 'tester'), /rename fail/);
  } finally {
    fsp.rename = origRename;
  }
  assert.ok(hit);
  assert.deepEqual(s.listWorkers().map((w) => w.worker_code), ['W-OLD2']);
  const s2 = await Storage.open(dbPath);
  assert.deepEqual(s2.listWorkers().map((w) => w.worker_code), ['W-OLD2']);
});

test('业务校验失败不写入、不污染计数器，同一来源仍只保存一次', async () => {
  const s = await open();
  const w = await s.createWorker(workerInput('W-UNIQ'), 'tester');
  await s.createExposure({ worker_id: w.id, source_ref: 'DUP', occurred_at: '2026-03-01', dose_msv: 1 }, 'tester');
  await assert.rejects(
    () => s.createExposure({ worker_id: w.id, source_ref: 'DUP', occurred_at: '2026-03-01', dose_msv: 2 }, 'tester'),
    (e) => e.code === 'duplicate_source_ref',
  );
  // 缺失人员也不得留下任何痕迹
  await assert.rejects(
    () => s.createExposure({ worker_id: 'wkr_9999', source_ref: 'GHOST', occurred_at: '2026-03-01', dose_msv: 1 }, 'tester'),
    (e) => e.code === 'not_found',
  );
  const rows = s.listExposures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_ref, 'DUP');
});

test('更正事务在落盘失败时整体回滚，不留半条 reversal/replacement', async () => {
  const s = await open();
  const w = await s.createWorker(workerInput('W-CORR'), 'tester');
  const e = await s.createExposure({ worker_id: w.id, source_ref: 'CORR-1', occurred_at: '2026-02-01', dose_msv: 5 }, 'tester');
  await s.verifyExposure(e.id, { reviewer: 'rpo' }, 'rpo');

  const origOpen = fsp.open;
  fsp.open = async (p, ...rest) => {
    if (String(p).includes('.tmp-')) {
      const err = new Error('disk down'); err.code = 'EIO';
      throw err;
    }
    return origOpen.call(this, p, ...rest);
  };
  try {
    await assert.rejects(() => s.correctExposure(e.id, { dose_msv: 4, reviewer: 'rpo' }, 'rpo'), /disk down/);
  } finally {
    fsp.open = origOpen;
  }
  const rows = s.listExposures();
  assert.equal(rows.length, 1, '失败的更正不得产生 reversal/replacement');
  assert.equal(rows[0].dose_msv, 5);
  assert.equal(rows[0].superseded_by, null);
  // 恢复后可重新更正
  const ok = await s.correctExposure(e.id, { dose_msv: 4, reviewer: 'rpo' }, 'rpo');
  assert.equal(ok.replacement.dose_msv, 4);
  assert.equal(s.listExposures().length, 3);
});

test('评估只追加：多次保存累积且快照内容不可变', async () => {
  const s = await open();
  const w = await s.createWorker(workerInput('W-ASM'), 'tester');
  const a1 = await s.saveAssessment({ worker_id: w.id, plan_id: null, result: minimalResult(1) }, 'tester');
  const a2 = await s.saveAssessment({ worker_id: w.id, plan_id: null, result: minimalResult(2) }, 'tester');
  assert.notEqual(a1.id, a2.id);
  assert.equal(s.listAssessments().length, 2);
  // 第一条的内容不被第二次保存影响
  const first = s.getAssessment(a1.id);
  assert.equal(first.result.period_dose_msv, 1);
  assert.equal(first.result.projected_dose_msv, 1);
  assert.equal(first.status, 'assessed');
  // 拿不到的 id 返回 null，而不是被改写
  assert.equal(s.getAssessment('asm_9999'), null);
});

test('审计只增：每次成功/失败关键操作都追加记录，且存储层不提供任何删除方法', async () => {
  const s = await open();
  const w = await s.createWorker(workerInput('W-AUD'), 'tester');
  const e = await s.createExposure({ worker_id: w.id, source_ref: 'AUD-1', occurred_at: '2026-03-01', dose_msv: 1 }, 'tester');
  await assert.rejects(
    () => s.createExposure({ worker_id: w.id, source_ref: 'AUD-1', occurred_at: '2026-03-01', dose_msv: 1 }, 'tester'),
    (err) => err.code === 'duplicate_source_ref',
  );
  const audit = s.listAudit();
  const actions = audit.map((a) => a.action);
  assert.ok(actions.includes('worker.create'));
  assert.ok(actions.includes('exposure.create'));
  // 重复来源在写记录前被拒，不产生 exposure.create 之外的伪审计
  assert.equal(actions.filter((a) => a === 'exposure.create').length, 1);
  // 每条审计有操作者与摘要
  assert.ok(audit.every((a) => a.actor && typeof a.summary === 'string' && a.at));

  // 白名单：Storage 原型上不存在任何删除/清空/覆盖审计的方法
  const forbidden = Object.getOwnPropertyNames(Storage.prototype)
    .filter((n) => /delete|remove|purge|clear|truncate|drop|destroy/i.test(n));
  assert.deepEqual(forbidden, []);
  // 审计访问器不返回可直接改变长度的内部数组（应是克隆）
  const view = s.listAudit();
  view.length = 0;
  assert.ok(s.listAudit().length > 0);
});

// ---------- 多进程共享场景：两个 opener 操作同一文件 ----------

test('双 opener：一方落盘失败，另一方与磁盘旧数据都不被破坏，恢复后写入编号不重', async () => {
  const a = await Storage.open(dbPath, { timeoutMs: 5000 });
  await a.createWorker(workerInput('BASE-1'), 'A');
  const b = await Storage.open(dbPath, { timeoutMs: 5000 }); // 第二个打开器（模拟第二个进程）

  // A 注入临时文件写入失败：其事务整体回滚
  const origOpen = fsp.open;
  fsp.open = async function (p, ...rest) {
    if (String(p).includes('.tmp-')) { const e = new Error('A disk down'); e.code = 'EIO'; throw e; }
    return origOpen.call(this, p, ...rest);
  };
  try {
    await assert.rejects(() => a.createWorker(workerInput('A-FAIL'), 'A'), /A disk down/);
  } finally {
    fsp.open = origOpen;
  }

  // A 内存回滚：仍只有 BASE-1
  assert.deepEqual(a.listWorkers().map((w) => w.worker_code), ['BASE-1']);

  // B 不受影响，可正常提交（锁内重读磁盘）
  const byB = await b.createWorker(workerInput('B-OK'), 'B');
  assert.equal(byB.id, 'wkr_00002', '失败事务不得占用编号');

  // A 恢复后也能继续提交，编号接着 B 的走，不重复
  const byA = await a.createWorker(workerInput('A-OK'), 'A');
  assert.equal(byA.id, 'wkr_00003');

  // 从磁盘重新打开（第三个打开器）：BASE-1 / B-OK / A-OK 全在，无 A-FAIL
  const c = await Storage.open(dbPath, { timeoutMs: 5000 });
  assert.deepEqual(c.listWorkers().map((w) => w.worker_code).sort(), ['A-OK', 'BASE-1', 'B-OK'].sort());
  const ids = new Set(c.listWorkers().map((w) => w.id));
  assert.equal(ids.size, 3);
});

test('双 opener 交错连续写入：经文件锁串行化，全部保留且编号唯一连续', async () => {
  const a = await Storage.open(dbPath, { timeoutMs: 5000 });
  const b = await Storage.open(dbPath, { timeoutMs: 5000 });
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(a.createWorker(workerInput(`X-A-${String(i).padStart(2, '0')}`), 'A'));
    jobs.push(b.createWorker(workerInput(`X-B-${String(i).padStart(2, '0')}`), 'B'));
  }
  const rs = await Promise.all(jobs);
  assert.equal(rs.length, 40);
  assert.equal(new Set(rs.map((r) => r.id)).size, 40, '编号不得重复');
  const nums = rs.map((r) => Number(r.id.split('_')[1])).sort((x, y) => x - y);
  assert.deepEqual(nums, Array.from({ length: 40 }, (_, i) => i + 1));
  const c = await Storage.open(dbPath);
  assert.equal(c.listWorkers().length, 40);
});

test('锁等待：锁被占满超过超时时间返回 lock_timeout(503)，不覆盖旧数据；释放后可继续', async () => {
  const s = await Storage.open(dbPath, { timeoutMs: 300, staleMs: 60_000 });
  await s.createWorker(workerInput('LOCK-BASE'), 'A');

  const blocker = new FileLock(`${dbPath}.lock`, { timeoutMs: 50, staleMs: 60_000 });
  const held = await blocker.acquire(); // 模拟另一个进程长时间持锁
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => s.createWorker(workerInput('SHOULD-WAIT'), 'A'),
      (e) => e.code === 'lock_timeout' && e.statusCode === 503,
    );
    assert.ok(Date.now() - t0 >= 250, '应当确实等待到超时，而不是立即失败');
  } finally {
    await held.release();
  }

  // 超时写入未生效，旧数据完好；锁释放后新写入成功
  assert.deepEqual(s.listWorkers().map((w) => w.worker_code), ['LOCK-BASE']);
  const ok = await s.createWorker(workerInput('AFTER-LOCK'), 'A');
  assert.equal(ok.worker_code, 'AFTER-LOCK');
  const again = await Storage.open(dbPath);
  assert.deepEqual(again.listWorkers().map((w) => w.worker_code).sort(), ['AFTER-LOCK', 'LOCK-BASE']);
});

test('陈旧锁：持锁进程在本机已不存在且锁超龄，新事务可接管并正常提交', async () => {
  const s = await Storage.open(dbPath, { timeoutMs: 2000, staleMs: 200 });
  await s.createWorker(workerInput('STALE-BASE'), 'A');

  // 伪造一个属于“不存在进程”的陈旧锁文件（mtime 设为很久以前）
  const lockPath = `${dbPath}.lock`;
  await fsp.writeFile(lockPath, JSON.stringify({ pid: 999999, hostname: os.hostname(), token: 'dead' }));
  const old = new Date(Date.now() - 60_000);
  await fsp.utimes(lockPath, old, old);

  const ok = await s.createWorker(workerInput('STALE-AFTER'), 'A');
  assert.equal(ok.worker_code, 'STALE-AFTER');
  // 提交后锁已释放（陈旧锁接管者负责释放自己的锁）
  assert.deepEqual((await fsp.readdir(dir)).filter((f) => f.endsWith('.lock')), []);
});
