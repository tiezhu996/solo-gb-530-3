'use strict';
// 评估页“人员 ↔ 计划”选择调和的纯函数（浏览器与 node:test 共用）。
// 关键不变量：提交评估时，plan_id 要么为空，要么必须属于当前 worker_id。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 只返回某人员名下的计划。
  function plansOfWorker(plans, workerId) {
    return (plans || []).filter((p) => p.worker_id === workerId);
  }

  // 给定当前人员、当前选中的计划和全部计划，返回“合法的”计划 id：
  // - 未选计划 → ''（基线评估：仅期间累计）
  // - 计划不存在（已删除/数据未加载）→ ''
  // - 计划属于其他人员（跨人员残留）→ ''  ← 本次缺陷的核心防线
  // - 计划确属当前人员 → 原 id
  function resolvePlanForWorker(workerId, planId, plans) {
    if (!planId) return '';
    const hit = (plans || []).find((p) => p.id === planId);
    if (!hit) return '';
    if (!workerId || hit.worker_id !== workerId) return '';
    return planId;
  }

  // 切换前后的完整调和：返回 { planId, changed, reason }，便于 UI 提示用户。
  // 入参为切换前选择（fromWorker/fromPlan）与切换后人员（toWorker）。
  function reconcileOnWorkerChange(toWorker, previousPlanId, plans) {
    const resolved = resolvePlanForWorker(toWorker, previousPlanId, plans);
    if (resolved === String(previousPlanId || '')) {
      return { planId: resolved, changed: false, reason: null };
    }
    return {
      planId: resolved,
      changed: true,
      reason: previousPlanId
        ? '所选计划不属于切换后的人员，已清空计划选择'
        : '已按新人员刷新计划列表',
    };
  }

  return { plansOfWorker, resolvePlanForWorker, reconcileOnWorkerChange };
});
