'use strict';

// HTTP 级可重复运行测试（独立临时数据文件 + 端口 0；结束杀进程并删除临时目录）：
// - 连续写入跨实体不丢记录
// - 评估只能追加保存，无修改/删除入口
// - 审计/各实体没有 DELETE/PUT 移除入口，尝试后数据仍在
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-integ-'));
const dataFile = path.join(tmpDir, 'integ.json');

let baseUrl, serverProc, logBuf = '';

function startServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_FILE: dataFile },
      cwd: ROOT,
    });
    child.stdout.on('data', (d) => {
      logBuf += d;
      const m = d.toString().match(/"port":(\d+)/);
      if (m && !settled) { settled = true; baseUrl = `http://127.0.0.1:${m[1]}`; resolve(child); }
    });
    child.stderr.on('data', (d) => { logBuf += d; });
    child.on('exit', (code) => { if (!settled) reject(new Error(`提前退出 ${code}\n${logBuf}`)); });
    setTimeout(() => { if (!settled) reject(new Error('启动超时\n' + logBuf)); }, 10000);
  });
}

before(async () => {
  serverProc = await startServer();
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(baseUrl + '/healthz'); if (r.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(async () => {
  try { serverProc.kill('SIGTERM'); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmpDir, { recursive: true, force: true }); // 结束移除临时文件
});

async function call(method, p, body) {
  const res = await fetch(baseUrl + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Actor': 'integ-tester' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const workerBody = (code) => ({
  worker_code: code, display_name: '集成测试', authorization_level: 'standard',
  annual_limit_msv: 20, administrative_limit_msv: 12, period_start_day: '2026-01-01', period_days: 365,
});

test('连续 API 写入：20 名人员 + 每人 2 条暴露，全部可读且不丢', async () => {
  const workerIds = [];
  for (let i = 1; i <= 20; i++) {
    const r = await call('POST', '/workers', workerBody(`I-${String(i).padStart(3, '0')}`));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    workerIds.push(r.json.data.id);
  }
  for (const wid of workerIds) {
    for (const k of [1, 2]) {
      const r = await call('POST', '/exposures', {
        worker_id: wid, source_ref: `SRC-${wid}-${k}`, occurred_at: '2026-03-01', dose_msv: 0.05 * k,
      });
      assert.equal(r.status, 201);
    }
  }
  const all = await call('GET', '/workers');
  assert.equal(all.json.data.length, 20);
  for (const wid of workerIds) {
    const ex = await call('GET', `/exposures?worker_id=${wid}`);
    assert.equal(ex.json.data.length, 2, `${wid} 应有 2 条暴露`);
    assert.ok(ex.json.data.every((e) => e.quality_flag === 'pending'));
  }
});

test('评估只追加：同一人员保存两次，列表 2 条且首条内容不变', async () => {
  const w = (await call('GET', '/workers')).json.data[0];
  const s1 = await call('POST', '/assessments', { worker_id: w.id, as_of_day: '2026-09-01' });
  assert.equal(s1.status, 201);
  await new Promise((r) => setTimeout(r, 5));
  const s2 = await call('POST', '/assessments', { worker_id: w.id, as_of_day: '2026-09-02' });
  assert.equal(s2.status, 201);
  assert.notEqual(s1.json.data.id, s2.json.data.id);

  const list = await call('GET', `/assessments?worker_id=${w.id}`);
  assert.equal(list.json.data.length, 2);
  const back1 = await call('GET', `/assessments/${s1.json.data.id}`);
  assert.equal(back1.json.data.as_of_day, '2026-09-01');
  assert.equal(back1.json.data.status, 'assessed');
});

test('没有移除入口：对评估/审计/人员/暴露/计划的 DELETE 与非预期 PUT 均不删除数据', async () => {
  const w = (await call('GET', '/workers')).json.data[0];
  const saved = await call('POST', '/assessments', { worker_id: w.id, as_of_day: '2026-09-01' });
  const asmId = saved.json.data.id;
  const beforeWorkers = (await call('GET', '/workers')).json.data.length;
  const beforeAudit = (await call('GET', '/audit')).json.data.length;

  // 尝试各种删除/改写入口，都应被拒（404 未知路径 或 405 不支持的方法）
  const attempts = [
    ['DELETE', `/assessments/${asmId}`],
    ['DELETE', `/audit`],
    ['DELETE', `/workers/${w.id}`],
    ['DELETE', `/exposures`],
    ['DELETE', `/plans`],
    ['PUT', `/audit`],
    ['POST', `/audit/delete`],
    ['PATCH', `/assessments/${asmId}`],
  ];
  for (const [method, p] of attempts) {
    const r = await call(method, p, {});
    assert.ok([404, 405].includes(r.status), `${method} ${p} 应被拒，实际 ${r.status}`);
  }

  // 数据原封不动
  assert.equal((await call('GET', `/assessments/${asmId}`)).status, 200, '评估仍可回读');
  assert.equal((await call('GET', '/workers')).json.data.length, beforeWorkers, '人员数不变');
  const auditAfter = (await call('GET', '/audit')).json.data;
  assert.equal(auditAfter.length, beforeAudit, '审计未因删除尝试增加/减少');
  // 审计只含追加动作，绝无 *.delete 类动作
  assert.ok(auditAfter.every((a) => !/delete|remove|purge/i.test(a.action)));
});

test('审计在连续写入后完整可查且有序（新在前）', async () => {
  const audit = (await call('GET', '/audit')).json.data;
  const creates = audit.filter((a) => a.action === 'worker.create');
  assert.equal(creates.length, 20, '20 次建员各有一条审计');
  const ids = audit.map((a) => a.id);
  assert.ok(new Set(ids).size === ids.length, '审计 id 不重复');
  for (let i = 1; i < audit.length; i++) {
    assert.ok(audit[i - 1].at >= audit[i].at, '审计按时间倒序（新在前）');
  }
  // 按实体过滤可用
  const expAudit = (await call('GET', '/audit?entity=exposure')).json.data;
  assert.ok(expAudit.length >= 40, '40 条暴露录入至少 40 条审计');
  assert.ok(expAudit.every((a) => a.entity === 'exposure'));
});
