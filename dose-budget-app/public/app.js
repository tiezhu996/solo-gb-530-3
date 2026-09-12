'use strict';
// 前端逻辑（原生 JS，零构建）。所有复核动作都只是“人工处置记录”，界面不提供任何“批准作业”语义。

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { workers: [], plans: [], exposures: [], assessments: [], meta: null };

async function api(method, path, body) {
  const opts = { method, headers: { 'X-Actor': $('#actor').value, 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api/v1' + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`);
  return json.data;
}

function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${ok ? 'ok' : 'err'}`;
  setTimeout(() => t.classList.add('hidden'), 3500);
  t.classList.remove('hidden');
}
const bandBadge = (b) => `<span class="badge ${b}">${esc(state.meta?.risk_bands?.[b] || b)}</span>`;
const flagBadge = (f) => `<span class="badge flag-${f}">${({ pending: '待核验', verified: '已核验', rejected: '已拒绝', superseded: '已被替代' })[f] || f}</span>`;
const statusBadge = (s) => `<span class="badge status-${s}">${esc(state.meta?.review_statuses?.[s] || s)}</span>`;
const fmt = (v) => (typeof v === 'number' ? v.toFixed(3).replace(/\.?0+$/, '') : esc(v));

// ---------- tabs ----------
$$('.tab').forEach((btn) => btn.addEventListener('click', () => {
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
}));

// ---------- worker selects ----------
function syncWorkerSelects() {
  const opts = state.workers.map((w) => `<option value="${w.id}">${esc(w.worker_code)} · ${esc(w.display_name)}</option>`).join('');
  $$('select[data-worker-select]').forEach((sel) => {
    const keep = sel.value;
    sel.innerHTML = '<option value="">请选择…</option>' + opts;
    if (state.workers.some((w) => w.id === keep)) sel.value = keep;
  });
  // 数据刷新后也必须按当前人员调和计划下拉（refreshAll 后旧值可能已失效）。
  syncPlanOptions(true);
}

// 重建评估页计划下拉：只列当前人员的计划。
// preserve=true 时尽量保留当前选择（跨人员/不存在的计划一律清空）；
// preferredPlanId 显式指定要选中的计划（仍须属于当前人员）。返回选中的计划 id。
function syncPlanOptions(preserve, preferredPlanId) {
  const ps = $('#budget-plan');
  const wid = $('#budget-worker').value;
  const previous = ps.value; // 必须在重建 innerHTML 之前读取
  const plans = BudgetSelection.plansOfWorker(state.plans, wid);
  ps.innerHTML = '<option value="">不叠加计划（仅期间累计）</option>' +
    plans.map((p) => `<option value="${p.id}">${esc(p.plan_code)}（${statusLabel(p.permit_status)}）</option>`).join('');
  const candidate = preferredPlanId !== undefined ? preferredPlanId : (preserve ? previous : '');
  ps.value = BudgetSelection.resolvePlanForWorker(wid, candidate, state.plans);
  return ps.value;
}

// 切换评估人员的统一入口。无论来源是下拉 change、人员页按钮还是“评估此计划”，
// 都先调和计划选择（跨人员计划一律清空），避免把旧人员计划带给试算/保存。
function changeBudgetWorker(workerId, preferredPlanId) {
  const previousPlan = $('#budget-plan').value;
  $('#budget-worker').value = workerId || '';
  const reconcile = BudgetSelection.reconcileOnWorkerChange(workerId, previousPlan, state.plans);
  const nextPlan = preferredPlanId !== undefined
    ? BudgetSelection.resolvePlanForWorker(workerId, preferredPlanId, state.plans)
    : reconcile.planId;
  syncPlanOptions(false, nextPlan);
  if (reconcile.changed && previousPlan) toast(reconcile.reason);
  return $('#budget-plan').value;
}
function statusLabel(s) { return state.meta?.review_statuses?.[s] || s; }

// ---------- rendering ----------
function renderWorkers() {
  $('#workers-list').innerHTML = state.workers.map((w) => {
    const exps = state.exposures.filter((e) => e.worker_id === w.id);
    const pending = exps.filter((e) => e.quality_flag === 'pending').length;
    return `<div class="item">
      <div class="title"><span>${esc(w.worker_code)} · ${esc(w.display_name)}</span><span class="badge status-draft">${esc(w.authorization_level)}</span></div>
      <div class="meta">
        法规年限值 <strong>${fmt(w.annual_limit_msv)}</strong> mSv ｜ 行政控制值 <strong>${fmt(w.administrative_limit_msv)}</strong> mSv<br/>
        统计周期：${esc(w.period_start_day)} 起，每 ${w.period_days} 天（半开区间）｜ 待核验记录 ${pending} 条 ｜ 版本 v${w.version}
      </div>
      <div class="actions">
        <button class="btn small" onclick="quickAssess('${w.id}')">去评估该人员</button>
        <button class="btn small" onclick="editWorker('${w.id}')">编辑限值（v${w.version}）</button>
      </div>
    </div>`;
  }).join('') || '<p class="hint">暂无人员。</p>';
}

function renderExposures() {
  $('#exposures-list').innerHTML = state.exposures.slice().reverse().map((e) => {
    const worker = state.workers.find((w) => w.id === e.worker_id);
    const chain = e.entry_type === 'original' && e.superseded_by
      ? `→ 已由 <code>${esc(e.superseded_by)}</code> 替代`
      : e.correction_of_id ? `← 更正自 <code>${esc(e.correction_of_id)}</code>` : '';
    const typeLabel = { original: '原始', reversal: '冲销', replacement: '替代' }[e.entry_type];
    let actions = '';
    if (e.quality_flag === 'pending') {
      actions = `<button class="btn small primary" onclick="verifyExp('${e.id}')">核验通过</button>
                 <button class="btn small danger" onclick="rejectExp('${e.id}')">拒绝</button>`;
    } else if (e.quality_flag === 'verified' && e.entry_type === 'original' && !e.superseded_by) {
      actions = `<button class="btn small warn" onclick="correctExp('${e.id}', ${e.dose_msv})">更正（保留原记录）</button>`;
    }
    return `<div class="item">
      <div class="title">
        <span>${esc(e.source_ref)} · ${esc(worker?.display_name || e.worker_id)} · ${typeLabel}</span>
        ${flagBadge(e.quality_flag)}
      </div>
      <div class="meta">
        发生日期 ${esc(e.occurred_at)} ｜ 剂量 <strong>${fmt(e.dose_msv)}</strong> mSv ｜ ${chain}<br/>
        ${e.verified_by ? `核验人：${esc(e.verified_by)}（${esc(e.verified_at?.slice(0, 16).replace('T', ' '))}）` : ''}
        ${e.note ? `<br/>备注：${esc(e.note)}` : ''}
      </div>
      <div class="actions">${actions}</div>
    </div>`;
  }).join('') || '<p class="hint">暂无暴露记录。</p>';
}

function renderPlans() {
  $('#plans-list').innerHTML = state.plans.slice().reverse().map((p) => {
    const worker = state.workers.find((w) => w.id === p.worker_id);
    const inc = (p.estimated_rate_msvh * p.planned_minutes / 60);
    const editable = ['draft', 'rejected'].includes(p.permit_status);
    return `<div class="item">
      <div class="title"><span>${esc(p.plan_code)} · ${esc(p.work_area || '—')} · ${esc(worker?.display_name || '')}</span>${statusBadge(p.permit_status)}</div>
      <div class="meta">
        ${esc(p.task_category)} ｜ ${fmt(p.estimated_rate_msvh)} mSv/h × ${p.planned_minutes} min = <strong>${fmt(inc)}</strong> mSv 增量<br/>
        控制措施：${(p.controls_json || []).map(esc).join('；') || '（未填写）'} ｜ 计划日 ${esc(p.planned_on_day || '未指定')} ｜ v${p.version}
        ${p.reviewer_id ? `<br/>复核人：${esc(p.reviewer_id)}` : ''}
      </div>
      <div class="actions">
        <button class="btn small primary" onclick="assessPlan('${p.id}')">评估此计划</button>
        ${editable ? `<button class="btn small" onclick="editPlan('${p.id}')">编辑假设</button>` : ''}
        ${['planning_accepted', 'rejected'].includes(p.permit_status) ? `<button class="btn small" onclick="archivePlan('${p.id}')">归档</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<p class="hint">暂无计划。</p>';
}

function renderAssessments() {
  $('#assessments-list').innerHTML = state.assessments.slice().reverse().map((a) => {
    const w = state.workers.find((x) => x.id === a.worker_id);
    const p = state.plans.find((x) => x.id === a.plan_id);
    let actions = '';
    if (a.status === 'assessed') actions = `<button class="btn small warn" onclick="submitAssessment('${a.id}')">提交 RPO 人工复核</button>`;
    if (a.status === 'pending_rpo_review') {
      actions = `<button class="btn small primary" onclick="reviewAssessment('${a.id}','planning_accepted')">RPO 记录：规划证据接受（非作业许可）</button>
                 <button class="btn small danger" onclick="reviewAssessment('${a.id}','rejected')">RPO 拒绝规划</button>`;
    }
    return `<div class="item">
      <div class="title">
        <span><code>${a.id}</code> · ${esc(w?.worker_code || a.worker_id)} · ${p ? esc(p.plan_code) : '无计划'}</span>
        ${bandBadge(a.result.risk_band)} ${statusBadge(a.status)}
      </div>
      <div class="meta">
        截至 ${esc(a.as_of_day)} ｜ 周期 ${esc(a.result.period.start_day)} ~ ${esc(a.result.period.end_day)}<br/>
        期间已核验 <strong>${fmt(a.result.period_dose_msv)}</strong> + 计划增量 <strong>${fmt(a.result.planned_increment_msv)}</strong>
        = 投影 <strong>${fmt(a.result.projected_dose_msv)}</strong> mSv<br/>
        行政余量 ${fmt(a.result.remaining_admin_msv)} ｜ 法规余量 ${fmt(a.result.remaining_legal_msv)} ｜ 近五年均值 ${fmt(a.result.five_year.average_msv)} mSv
        ${a.result.first_exceedance ? `<br/><span style="color:var(--red);font-weight:700">⚠ 首超：${esc(a.result.first_exceedance.limit_label)}，超出 ${fmt(a.result.first_exceedance.overage_mSv)} mSv</span>` : ''}
        ${a.reviewer_id ? `<br/>复核人：${esc(a.reviewer_id)} @ ${esc(a.reviewed_at?.slice(0,16).replace('T',' '))}` : ''}
      </div>
      <div class="actions">${actions}</div>
      <details><summary>评估证据（计入/排除记录、公式、阈值版本）</summary><pre style="font-size:12px;white-space:pre-wrap">${esc(JSON.stringify(a.result.evidence, null, 2))}</pre></details>
    </div>`;
  }).join('') || '<p class="hint">暂无已保存评估。</p>';
}

async function refreshAll() {
  [state.workers, state.exposures, state.plans, state.assessments, state.meta] = await Promise.all([
    api('GET', '/workers'), api('GET', '/exposures'), api('GET', '/plans'), api('GET', '/assessments'), api('GET', '/meta'),
  ]);
  syncWorkerSelects();
  renderWorkers(); renderExposures(); renderPlans(); renderAssessments();
}

// ---------- forms ----------
$('#form-worker').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const editing = ev.target.dataset.editId;
  const payload = {
    display_name: f.get('display_name'),
    authorization_level: f.get('authorization_level'),
    annual_limit_msv: Number(f.get('annual_limit_msv')),
    administrative_limit_msv: Number(f.get('administrative_limit_msv')),
    period_start_day: f.get('period_start_day'),
    period_days: Number(f.get('period_days')),
  };
  try {
    if (editing) {
      payload.version = Number(ev.target.dataset.version);
      await api('PUT', `/workers/${editing}`, payload);
      toast('人员限值已更新（新版本，旧值见审计）');
      delete ev.target.dataset.editId; delete ev.target.dataset.version;
      $('#worker-submit').textContent = '新增人员';
      ev.target.worker_code.disabled = false;
    } else {
      payload.worker_code = f.get('worker_code');
      await api('POST', '/workers', payload);
      toast('人员已创建');
    }
    ev.target.reset();
    ev.target.worker_code.disabled = false;
    $('input[name=period_start_day]').value = state.meta.today;
    await refreshAll();
  } catch (e) { toast(e.message, false); }
});

window.editWorker = (id) => {
  const w = state.workers.find((x) => x.id === id);
  const form = $('#form-worker');
  form.worker_code.value = w.worker_code; form.worker_code.disabled = true;
  form.display_name.value = w.display_name;
  form.authorization_level.value = w.authorization_level;
  form.annual_limit_msv.value = w.annual_limit_msv;
  form.administrative_limit_msv.value = w.administrative_limit_msv;
  form.period_start_day.value = w.period_start_day;
  form.period_days.value = w.period_days;
  form.dataset.editId = id; form.dataset.version = w.version;
  $('#worker-submit').textContent = `保存限值编辑（v${w.version} → 新版本）`;
  form.scrollIntoView({ behavior: 'smooth' });
};

$('#form-exposure').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api('POST', '/exposures', {
      worker_id: f.get('worker_id'), source_ref: f.get('source_ref'),
      occurred_at: f.get('occurred_at'), dose_msv: Number(f.get('dose_msv')), note: f.get('note'),
    });
    toast('暴露记录已录入（待核验）'); ev.target.reset(); await refreshAll();
  } catch (e) { toast(e.message, false); }
});

$('#form-plan').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const editing = ev.target.dataset.editId;
  const payload = {
    work_area: f.get('work_area'), task_category: f.get('task_category'),
    estimated_rate_msvh: Number(f.get('estimated_rate_msvh')), planned_minutes: Number(f.get('planned_minutes')),
    planned_on_day: f.get('planned_on_day') || null, controls: f.get('controls'),
  };
  try {
    if (editing) {
      payload.version = Number(ev.target.dataset.version);
      await api('PUT', `/plans/${editing}`, payload);
      toast('计划草案已更新（新版本）'); delete ev.target.dataset.editId; delete ev.target.dataset.version;
      $('button[type=submit]', ev.target).textContent = '新增计划草案';
    } else {
      payload.plan_code = f.get('plan_code'); payload.worker_id = f.get('worker_id');
      await api('POST', '/plans', payload);
      toast('计划草案已创建');
    }
    ev.target.reset(); await refreshAll();
  } catch (e) { toast(e.message, false); }
});

// ---------- exposure actions ----------
window.verifyExp = async (id) => {
  const reviewer = prompt('请输入 RPO 核验人姓名（人工核验）：', $('#actor').selectedOptions[0].textContent.includes('RPO') ? $('#actor').value : '');
  if (!reviewer) return;
  try { await api('POST', `/exposures/${id}/verify`, { reviewer }); toast('已核验，记录开始计入周期累计'); await refreshAll(); }
  catch (e) { toast(e.message, false); }
};
window.rejectExp = async (id) => {
  const reviewer = prompt('请输入 RPO 核验人姓名：');
  if (!reviewer) return;
  const reason = prompt('拒绝原因：') || '';
  try { await api('POST', `/exposures/${id}/reject`, { reviewer, reason }); toast('记录已拒绝，不计入累计'); await refreshAll(); }
  catch (e) { toast(e.message, false); }
};
window.correctExp = async (id, oldDose) => {
  const reviewer = prompt('更正需要 RPO 处理，请输入复核人姓名：');
  if (!reviewer) return;
  const doseStr = prompt(`输入更正后的剂量 (mSv)（原值 ${oldDose} 将以负值冲销并完整保留）：`);
  if (doseStr === null || !Number.isFinite(Number(doseStr)) || Number(doseStr) < 0) { toast('更正剂量无效', false); return; }
  const note = prompt('更正说明（可选）：') || '';
  try {
    const r = await api('POST', `/exposures/${id}/correct`, { dose_msv: Number(doseStr), reviewer, note });
    toast(`更正完成：冲销 ${r.reversal.id}，替代 ${r.replacement.id}；原记录保留`); await refreshAll();
  } catch (e) { toast(e.message, false); }
};

// ---------- plan actions ----------
window.editPlan = (id) => {
  const p = state.plans.find((x) => x.id === id);
  const form = $('#form-plan');
  form.plan_code.value = p.plan_code; form.worker_id.value = p.worker_id;
  form.work_area.value = p.work_area; form.task_category.value = p.task_category;
  form.estimated_rate_msvh.value = p.estimated_rate_msvh; form.planned_minutes.value = p.planned_minutes;
  form.planned_on_day.value = p.planned_on_day || ''; form.controls.value = (p.controls_json || []).join('；');
  form.dataset.editId = id; form.dataset.version = p.version;
  form.querySelector('button[type=submit]').textContent = '保存编辑（v' + p.version + ' → 新版本）';
  document.querySelector('.tab[data-tab=plans]').click();
  form.scrollIntoView({ behavior: 'smooth' });
};
window.archivePlan = async (id) => {
  try { await api('POST', `/plans/${id}/archive`); toast('计划已归档'); await refreshAll(); } catch (e) { toast(e.message, false); }
};
window.assessPlan = (pid) => {
  const p = state.plans.find((x) => x.id === pid);
  changeBudgetWorker(p.worker_id, pid); // 切到计划所属人员并选中该计划
  document.querySelector('.tab[data-tab=budgets]').click();
};
window.quickAssess = (wid) => {
  changeBudgetWorker(wid); // 从人员页进入：清空任何可能残留的他人计划
  document.querySelector('.tab[data-tab=budgets]').click();
};

// ---------- budget ----------
// 提交前最后一道防线：任何来源拿到的 plan_id 都必须属于当前人员，否则按无计划处理。
function budgetArgs() {
  const workerId = $('#budget-worker').value;
  const planId = BudgetSelection.resolvePlanForWorker(workerId, $('#budget-plan').value, state.plans);
  if (planId !== $('#budget-plan').value) $('#budget-plan').value = planId; // 纠正 UI 残留
  return {
    worker_id: workerId,
    plan_id: planId || null,
    as_of_day: $('#budget-asof').value || (state.meta?.today),
  };
}
function renderResult(r, savedId) {
  const box = $('#budget-result');
  box.classList.remove('hidden');
  const first = r.first_exceedance;
  const prompts = r.review_prompts;
  box.innerHTML = `
    <h3>评估结果 ${bandBadge(r.risk_band)} <span style="font-weight:400;font-size:12px;color:var(--muted)">截至 ${esc(r.as_of_day)}，周期 [${esc(r.period.start_day)}, ${esc(r.period.end_day)})，阈值版本 ${esc(r.evidence.threshold_version)}</span></h3>
    <div class="metrics">
      <div class="metric"><div class="k">期间已核验剂量</div><div class="v">${fmt(r.period_dose_msv)} <small>mSv</small></div></div>
      <div class="metric"><div class="k">计划增量</div><div class="v">${fmt(r.planned_increment_msv)} <small>mSv</small></div></div>
      <div class="metric ${r.risk_band === 'above_legal' || r.risk_band === 'near_legal' ? 'danger' : r.risk_band === 'above_admin' ? 'warn' : ''}">
        <div class="k">投影累计</div><div class="v">${fmt(r.projected_dose_msv)} <small>mSv</small></div></div>
      <div class="metric ${r.remaining_admin_msv <= 0 ? 'danger' : ''}"><div class="k">行政余量</div><div class="v">${fmt(r.remaining_admin_msv)}</div></div>
      <div class="metric ${r.remaining_legal_msv <= 0 ? 'danger' : ''}"><div class="k">法规余量</div><div class="v">${fmt(r.remaining_legal_msv)}</div></div>
      <div class="metric"><div class="k">近五年平均</div><div class="v">${fmt(r.five_year.average_msv)} <small>mSv</small></div></div>
    </div>
    ${first ? `<div class="prompts danger"><strong>⚠ 首超提示：</strong>该计划执行后将首次越过「${esc(first.limit_label)}」（${fmt(first.limit_value_mSv)} mSv），投影 ${fmt(first.projected_mSv)} mSv，超出 ${fmt(first.overage_mSv)} mSv。</div>` : ''}
    ${prompts.length ? `<div class="prompts"><strong>人工复核提示（系统不自动批准作业）：</strong><ul>${prompts.map((p) => `<li>[${p.level}] ${esc(p.message)}</li>`).join('')}</ul></div>`
      : '<div class="manual-note">当前投影位于行政控制值内，暂无升级提示；本结论仍只是规划证据，不构成作业许可。</div>'}
    <div class="manual-note"><strong>automatic_approval = false。</strong>${savedId ? `本结果已保存为 <code>${esc(savedId)}</code>，状态“已评估”，可提交 RPO 人工复核。` : '试算结果未落库；需要证据留存请点击“计算并保存评估”。'}</div>
    <details open><summary>预算证据（计入 ${r.evidence.included_entries.length} 条 / 排除 ${r.evidence.excluded_entries.length} 条）</summary>
      <table class="evidence"><tr><th>记录</th><th>来源</th><th>日期</th><th>剂量</th><th>类型</th><th>状态/原因</th></tr>
      ${r.evidence.included_entries.map((e) => `<tr><td>${esc(e.exposure_id)}</td><td>${esc(e.source_ref)}</td><td>${esc(e.occurred_at)}</td><td>${fmt(e.dose_msv)}</td><td>${esc(e.entry_type)}</td><td>${esc(e.reason)}</td></tr>`).join('')}
      ${r.evidence.excluded_entries.map((e) => `<tr style="color:var(--muted)"><td>${esc(e.exposure_id)}</td><td>${esc(e.source_ref)}</td><td>${esc(e.occurred_at)}</td><td>${fmt(e.dose_msv)}</td><td>${esc(e.entry_type)}</td><td>${esc(e.reason)}</td></tr>`).join('')}
      </table>
      <p class="hint">${esc(r.five_year.note)}：${r.five_year.per_year.map((y) => `${y.year}=${fmt(y.dose_msv)}`).join('，')}</p>
    </details>`;
}

$('#budget-worker').addEventListener('change', (ev) => {
  // 用户手动切换人员：旧计划若不属新人员会被清空并提示。
  changeBudgetWorker(ev.target.value);
});

$('#btn-preview').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/assessments?preview=1', budgetArgs());
    renderResult(r);
  } catch (e) { toast(e.message, false); }
});
$('#btn-save').addEventListener('click', async () => {
  try {
    const saved = await api('POST', '/assessments', budgetArgs());
    toast(`评估已保存：${saved.id}（不可变，可回读）`);
    renderResult(saved.result, saved.id);
    await refreshAll();
  } catch (e) { toast(e.message, false); }
});
$('#btn-compare').addEventListener('click', async () => {
  const workerId = $('#budget-worker').value;
  if (!workerId) return toast('请先选择人员', false);
  try {
    const r = await api('POST', '/assessments/compare', { worker_id: workerId, as_of_day: $('#budget-asof').value || undefined });
    const box = $('#compare-result');
    box.classList.remove('hidden');
    box.innerHTML = `<h3>多计划情景比较（不落库、不改变状态）</h3>
      <table class="evidence"><tr><th>计划</th><th>增量 mSv</th><th>投影 mSv</th><th>行政余量</th><th>法规余量</th><th>风险带</th><th>首超</th></tr>
      ${r.scenarios.map((s) => `<tr><td>${esc(s.plan?.plan_code || '（无计划基线）')}</td><td>${fmt(s.planned_increment_msv)}</td><td>${fmt(s.projected_dose_msv)}</td>
        <td>${fmt(s.remaining_admin_msv)}</td><td>${fmt(s.remaining_legal_msv)}</td><td>${bandBadge(s.risk_band)}</td>
        <td>${s.first_exceedance ? esc(s.first_exceedance.limit_label) : '—'}</td></tr>`).join('')}
      </table><p class="hint">${esc(r.note)}</p>`;
  } catch (e) { toast(e.message, false); }
});

window.submitAssessment = async (id) => {
  try { await api('POST', `/assessments/${id}/submit`, {}); toast('已提交 RPO 人工复核'); await refreshAll(); } catch (e) { toast(e.message, false); }
};
window.reviewAssessment = async (id, decision) => {
  const reviewer = prompt('请输入 RPO 复核人姓名：');
  if (!reviewer) return;
  const note = prompt(decision === 'planning_accepted' ? '接受说明（规划证据接受 ≠ 现场作业许可）：' : '拒绝原因：') || '';
  try { await api('POST', `/assessments/${id}/review`, { decision, reviewer, note }); toast('RPO 人工处置已记录'); await refreshAll(); }
  catch (e) { toast(e.message, false); }
};

// ---------- audit ----------
async function loadAudit() {
  const entity = $('#audit-entity').value;
  const rows = await api('GET', '/audit' + (entity ? `?entity=${entity}` : ''));
  $('#audit-list').innerHTML = rows.map((a) => `<div class="item">
    <div class="title"><span>${esc(a.action)}</span><span class="hint">${esc(a.at)}</span></div>
    <div class="meta">操作者 <code>${esc(a.actor)}</code> ｜ 对象 ${esc(a.entity)} ${esc(a.entity_id || '')}<br/>${esc(a.summary)}</div>
    <details><summary>前后状态摘要</summary><pre style="font-size:12px;white-space:pre-wrap">${esc(JSON.stringify({ before: a.before_state, after: a.after_state }, null, 2))}</pre></details>
  </div>`).join('') || '<p class="hint">暂无审计记录。</p>';
}
$('#btn-audit-refresh').addEventListener('click', loadAudit);
$('#audit-entity').addEventListener('change', loadAudit);
$$('.tab').forEach((b) => b.dataset.tab === 'audit' && b.addEventListener('click', loadAudit));

// ---------- bootstrap ----------
(async function init() {
  try {
    state.meta = await api('GET', '/meta');
    $('input[name=period_start_day]').value = state.meta.today;
    $('input[name=occurred_at]').value = state.meta.today;
    $('#budget-asof').value = state.meta.today;
    await refreshAll();
  } catch (e) {
    toast('加载失败：' + e.message, false);
  }
})();
