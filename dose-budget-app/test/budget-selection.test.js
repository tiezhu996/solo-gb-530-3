'use strict';

// 回归：评估页跨人员计划残留缺陷（先选 A 的计划，再切到 B，旧计划不得被提交）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/budget-selection.js');

const plans = [
  { id: 'pA1', plan_code: 'A1', worker_id: 'wA' },
  { id: 'pA2', plan_code: 'A2', worker_id: 'wA' },
  { id: 'pB1', plan_code: 'B1', worker_id: 'wB' },
];

test('plansOfWorker 只返回当前人员的计划', () => {
  assert.deepEqual(S.plansOfWorker(plans, 'wA').map((p) => p.id), ['pA1', 'pA2']);
  assert.deepEqual(S.plansOfWorker(plans, 'wB').map((p) => p.id), ['pB1']);
  assert.deepEqual(S.plansOfWorker(plans, 'wX'), []);
});

test('resolvePlanForWorker：跨人员/不存在/空计划一律清空', () => {
  // 缺陷场景：当前人员 wB，但残留 wA 的计划 pA1 → 必须清空
  assert.equal(S.resolvePlanForWorker('wB', 'pA1', plans), '');
  // 同人员保留
  assert.equal(S.resolvePlanForWorker('wA', 'pA1', plans), 'pA1');
  // 空选择合法（基线评估）
  assert.equal(S.resolvePlanForWorker('wB', '', plans), '');
  assert.equal(S.resolvePlanForWorker('wB', null, plans), '');
  // 计划在数据中不存在（被删/未加载）
  assert.equal(S.resolvePlanForWorker('wA', 'pGONE', plans), '');
  // 未选人员
  assert.equal(S.resolvePlanForWorker('', 'pA1', plans), '');
});

test('reconcileOnWorkerChange：切换前后行为', () => {
  // 在 wA 选了 pA1，切到 wB → changed，计划清空，给出原因
  const toB = S.reconcileOnWorkerChange('wB', 'pA1', plans);
  assert.equal(toB.planId, '');
  assert.equal(toB.changed, true);
  assert.match(toB.reason, /不属于切换后的人员/);

  // 从 wB 切回 wA（此时无计划）→ 不提示“清空”
  const backToA = S.reconcileOnWorkerChange('wA', '', plans);
  assert.equal(backToA.planId, '');
  assert.equal(backToA.changed, false);

  // 在 wA 选 pA1，切到 wA（等同刷新）→ 保留
  const stay = S.reconcileOnWorkerChange('wA', 'pA1', plans);
  assert.equal(stay.planId, 'pA1');
  assert.equal(stay.changed, false);

  // 从无计划人员 wX(不存在) 直接选 pB1 到 wB（assessPlan 路径）→ 保留 pB1
  assert.equal(S.resolvePlanForWorker('wB', 'pB1', plans), 'pB1');
});

test('完整切换序列：A选计划→切B清空→切回A可选原计划→提交参数始终自洽', () => {
  // 模拟 UI 状态
  let worker = 'wA';
  let plan = S.resolvePlanForWorker(worker, 'pA1', plans); // 用户在 A 下选 A1
  assert.equal(plan, 'pA1');

  // 切到 B（quickAssess / 下拉 change）
  worker = 'wB';
  plan = S.reconcileOnWorkerChange(worker, plan, plans).planId;
  assert.equal(plan, ''); // 旧计划绝不带给 B
  assert.deepEqual({ worker_id: worker, plan_id: plan || null }, { worker_id: 'wB', plan_id: null });

  // 切回 A，重新选 A2
  worker = 'wA';
  plan = S.resolvePlanForWorker(worker, 'pA2', plans);
  assert.equal(plan, 'pA2');

  // 即使 UI 被异常地塞回 pB1，budgetArgs 防线也会清空
  const hostile = 'pB1';
  assert.equal(S.resolvePlanForWorker(worker, hostile, plans), '');
});
