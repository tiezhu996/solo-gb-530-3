'use strict';

// 端到端冒烟：真实启动 HTTP 服务（临时数据文件 + 端口 0），覆盖主流程
// 写入 → 重复拒绝 → 核验 → 更正保留原记录 → 计划 → 评估/首超/风险带 →
// 保存 → 提交 RPO → 人工接受（非自动批准）→ 审计 → 重启进程后回读持久化。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-budget-e2e-'));
const dataFile = path.join(tmpDir, 'db.json');

let baseUrl;
let serverProc;
let logBuf = '';

function startServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_FILE: dataFile },
      cwd: ROOT,
    });
    child.stdout.on('data', (d) => {
      logBuf += d.toString();
      const m = d.toString().match(/"port":(\d+)/);
      if (m && !settled) { settled = true; baseUrl = `http://127.0.0.1:${m[1]}`; resolve(child); }
    });
    child.stderr.on('data', (d) => { logBuf += d.toString(); });
    child.on('exit', (code) => { if (!settled) reject(new Error(`服务提前退出 code=${code}\n${logBuf}`)); });
    setTimeout(() => { if (!settled) reject(new Error('启动超时\n' + logBuf)); }, 10000);
  });
}

async function waitReady(child) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(baseUrl + '/healthz'); if (r.ok) return; } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 100));
  }
  child.kill();
  throw new Error('healthz 未就绪\n' + logBuf);
}

before(async () => {
  serverProc = await startServer();
  await waitReady(serverProc);
});
after(() => { try { serverProc.kill('SIGTERM'); } catch { /* noop */ } });

async function call(method, p, body, actor = 'planner_zhang') {
  const res = await fetch(baseUrl + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Actor': actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json, requestId: res.headers.get('x-request-id') };
}

let workerId, exposureId, planLowId, planHighId, assessmentId;

test('健康检查与静态首页', async () => {
  const h = await fetch(baseUrl + '/healthz');
  assert.equal(h.status, 200);
  const html = await fetch(baseUrl + '/');
  const text = await html.text();
  assert.match(text, /辐射作业个人剂量预算/);
});

test('创建人员限值档案', async () => {
  const r = await call('POST', '/workers', {
    worker_code: 'W-1001', display_name: '王工', authorization_level: 'standard',
    annual_limit_msv: 20, administrative_limit_msv: 12,
    period_start_day: '2026-01-01', period_days: 365,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  workerId = r.json.data.id;
  assert.equal(r.json.data.version, 1);
  assert.ok(r.requestId, '响应应带 request id');

  const bad = await call('POST', '/workers', {
    worker_code: 'W-1001', display_name: '重复',
    annual_limit_msv: 20, administrative_limit_msv: 12, period_start_day: '2026-01-01',
  });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.error.code, 'duplicate_worker_code');
});

test('录入暴露 + 重复来源拒绝 + 核验后才计入', async () => {
  const r = await call('POST', '/exposures', {
    worker_id: workerId, source_ref: 'DOS-2026-0007',
    occurred_at: '2026-03-01', dose_msv: 10, note: '热释光读数',
  });
  assert.equal(r.status, 201);
  exposureId = r.json.data.id;
  assert.equal(r.json.data.quality_flag, 'pending');

  const dup = await call('POST', '/exposures', {
    worker_id: workerId, source_ref: 'DOS-2026-0007',
    occurred_at: '2026-03-01', dose_msv: 10,
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'duplicate_source_ref');

  // 未核验：期间累计应为 0
  const pre = await call('POST', '/assessments?preview=1', { worker_id: workerId, as_of_day: '2026-09-01' });
  assert.equal(pre.json.data.period_dose_msv, 0);

  const v = await call('POST', `/exposures/${exposureId}/verify`, { reviewer: 'rpo_li' }, 'rpo_li');
  assert.equal(v.status, 200);
  assert.equal(v.json.data.quality_flag, 'verified');

  const noReviewer = await call('POST', `/exposures/${exposureId}/verify`, { reviewer: '' });
  assert.equal(noReviewer.status, 400); // 人工核验动作必须填复核人
  assert.equal(noReviewer.json.error.code, 'reviewer_required');

  const again = await call('POST', `/exposures/${exposureId}/verify`, { reviewer: 'rpo_li' }, 'rpo_li');
  assert.equal(again.status, 409); // 重复核验 → 状态冲突
  assert.equal(again.json.error.code, 'invalid_state');
});

test('更正：原记录保留，原+冲销+替代净额为更正值', async () => {
  const r = await call('POST', `/exposures/${exposureId}/correct`, {
    dose_msv: 9, reviewer: 'rpo_li', note: '读数修正',
  }, 'rpo_li');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { original, reversal, replacement } = r.json.data;
  assert.equal(original.id, exposureId);
  assert.equal(original.dose_msv, 10); // 原值未被覆盖
  assert.ok(original.superseded_by === replacement.id);
  assert.equal(reversal.dose_msv, -10);
  assert.equal(replacement.dose_msv, 9);

  const acc = await call('POST', '/assessments?preview=1', { worker_id: workerId, as_of_day: '2026-09-01' });
  assert.equal(acc.json.data.period_dose_msv, 9, '净额应为 9 mSv');
});

test('创建低/高剂量计划：增量、余量、风险带、首超', async () => {
  const low = await call('POST', '/plans', {
    plan_code: 'PLAN-LOW', worker_id: workerId, work_area: 'A 区', task_category: '巡检',
    estimated_rate_msvh: 0.15, planned_minutes: 40, controls: ['铅屏', '限时'],
  });
  assert.equal(low.status, 201);
  planLowId = low.json.data.id;

  const high = await call('POST', '/plans', {
    plan_code: 'PLAN-HIGH', worker_id: workerId, work_area: 'B 区', task_category: '大修',
    estimated_rate_msvh: 1.5, planned_minutes: 600, controls: ['远距离操作'],
  });
  assert.equal(high.status, 201);
  planHighId = high.json.data.id;

  // 低计划：9 + 0.1 = 9.1，行政值内
  const a = await call('POST', '/assessments?preview=1', { worker_id: workerId, plan_id: planLowId, as_of_day: '2026-09-01' });
  assert.equal(a.json.data.planned_increment_msv, 0.1);
  assert.equal(a.json.data.projected_dose_msv, 9.1);
  assert.equal(a.json.data.remaining_admin_msv, 2.9);
  assert.equal(a.json.data.risk_band, 'within_admin');
  assert.equal(a.json.data.first_exceedance, null);

  // 高计划：9 + 15 = 24 → 超法规、首超法规限值
  const b = await call('POST', '/assessments?preview=1', { worker_id: workerId, plan_id: planHighId, as_of_day: '2026-09-01' });
  assert.equal(b.json.data.projected_dose_msv, 24);
  assert.equal(b.json.data.remaining_legal_msv, 0);
  assert.equal(b.json.data.risk_band, 'above_legal');
  assert.equal(b.json.data.first_exceedance.limit, 'annual_limit_msv');
  assert.equal(b.json.data.first_exceedance.overage_mSv, 4);
  assert.equal(b.json.data.automatic_approval, false);
  assert.ok(b.json.data.requires_manual_review);
  assert.ok(b.json.data.review_prompts.some((p) => p.level === 'mandatory_escalation'));
});

test('情景比较不落库', async () => {
  const r = await call('POST', '/assessments/compare', { worker_id: workerId, plan_ids: [planLowId, planHighId], as_of_day: '2026-09-01' });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.scenarios.length, 2);
  const savedAfter = await call('GET', '/assessments?worker_id=' + workerId);
  assert.equal(savedAfter.json.data.length, 0, '比较不应保存评估');
});

test('保存评估 → 回读 → 提交 RPO → 人工接受（不自动批准）', async () => {
  const save = await call('POST', '/assessments', { worker_id: workerId, plan_id: planLowId, as_of_day: '2026-09-01' });
  assert.equal(save.status, 201);
  assessmentId = save.json.data.id;
  assert.equal(save.json.data.status, 'assessed');
  assert.deepEqual(save.json.data.input_snapshot.worker.worker_code, 'W-1001');

  // 回读
  const got = await call('GET', `/assessments/${assessmentId}`);
  assert.equal(got.json.data.result.projected_dose_msv, 9.1);

  // 越级：未提交直接 RPO 复核 → 409
  const leap = await call('POST', `/assessments/${assessmentId}/review`,
    { decision: 'planning_accepted', reviewer: 'rpo_li' }, 'rpo_li');
  assert.equal(leap.status, 409);
  assert.equal(leap.json.error.code, 'invalid_state');

  const sub = await call('POST', `/assessments/${assessmentId}/submit`, {});
  assert.equal(sub.json.data.status, 'pending_rpo_review');

  const rev = await call('POST', `/assessments/${assessmentId}/review`,
    { decision: 'planning_accepted', reviewer: 'rpo_li', note: '规划证据接受，须另行办理现场许可' }, 'rpo_li');
  assert.equal(rev.status, 200);
  assert.equal(rev.json.data.status, 'planning_accepted');
  assert.equal(rev.json.data.result.automatic_approval, false);

  // 计划状态机被同步推进，但语义明确不是许可
  const plan = await call('GET', `/plans/${planLowId}`);
  assert.equal(plan.json.data.permit_status, 'planning_accepted');
});

test('审计可查询且覆盖关键动作', async () => {
  const r = await call('GET', '/audit?entity=exposure', undefined, 'rpo_li');
  const actions = r.json.data.map((a) => a.action);
  for (const need of ['exposure.create', 'exposure.verify', 'exposure.correct']) {
    assert.ok(actions.includes(need), `审计缺少 ${need}`);
  }
  const all = await call('GET', '/audit');
  assert.ok(all.json.data.length >= 6);
  // 审计里不应出现更正备注正文长度以外的敏感需求——这里只验证结构稳定
  assert.ok(all.json.data.every((a) => a.request_id === undefined || typeof a.request_id === 'string'));
});

test('乐观锁：版本冲突返回 409', async () => {
  const r = await call('PUT', `/workers/${workerId}`, {
    version: 1, display_name: '王工（更新行政值）', administrative_limit_msv: 10,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.version, 2);
  const stale = await call('PUT', `/workers/${workerId}`, { version: 1, administrative_limit_msv: 11 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'version_conflict');
});

test('重启进程后数据完整回读（持久化）', async () => {
  serverProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  baseUrl = null;
  serverProc = await startServer();
  await waitReady(serverProc);

  const workers = await call('GET', '/workers');
  assert.equal(workers.json.data.length, 1);
  assert.equal(workers.json.data[0].administrative_limit_msv, 10);

  const exposures = await call('GET', `/exposures?worker_id=${workerId}`);
  assert.equal(exposures.json.data.length, 3, '原记录 + 冲销 + 替代');
  const doses = exposures.json.data.map((e) => e.dose_msv).sort((x, y) => x - y);
  assert.deepEqual(doses, [-10, 9, 10]);

  const got = await call('GET', `/assessments/${assessmentId}`);
  assert.equal(got.json.data.status, 'planning_accepted');
  assert.equal(got.json.data.result.risk_band, 'within_admin');
});
