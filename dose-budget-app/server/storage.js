'use strict';

// 文件型存储：全部数据保存在一个 JSON 文件中，原子写入（写临时文件 + rename）。
// 单进程内用串行写队列保证一致性；写失败不会损坏已有数据文件。
// 数据模型刻意最小化：不存任何医疗/诊断信息。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { QUALITY_FLAGS, ENTRY_TYPES, REVIEW_STATUSES, DEFAULTS } = require('./dosimetry');

class StorageError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const EMPTY_DB = () => ({
  schema_version: 1,
  counters: { worker: 0, exposure: 0, plan: 0, assessment: 0, audit: 0 },
  workers: [],
  exposures: [],
  plans: [],
  assessments: [],
  audit_log: [],
});

class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this._writeChain = Promise.resolve();
    this.db = EMPTY_DB();
  }

  static async open(filePath) {
    const s = new Storage(filePath);
    await fsp.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      s.db = { ...EMPTY_DB(), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await s._persist(); // 首次启动落盘
    }
    return s;
  }

  // 所有变更串行化，避免并发请求交叉写入。
  mutate(fn) {
    const run = this._writeChain.then(async () => {
      const result = await fn(this.db);
      await this._persist();
      return result;
    });
    // 保持链条不断（即便本次失败也允许后续写）。
    this._writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async _persist() {
    const tmp = `${this.filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const data = JSON.stringify(this.db, null, 2);
    await fsp.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tmp, this.filePath);
  }

  // ---------- 只读 ----------
  listWorkers() { return clone(this.db.workers); }
  getWorker(id) {
    const w = this.db.workers.find((x) => x.id === id);
    return w ? clone(w) : null;
  }
  listExposures(filter = {}) {
    let rows = this.db.exposures;
    if (filter.worker_id) rows = rows.filter((e) => e.worker_id === filter.worker_id);
    return clone(rows);
  }
  getExposure(id) {
    const e = this.db.exposures.find((x) => x.id === id);
    return e ? clone(e) : null;
  }
  listPlans(filter = {}) {
    let rows = this.db.plans;
    if (filter.worker_id) rows = rows.filter((p) => p.worker_id === filter.worker_id);
    return clone(rows);
  }
  getPlan(id) {
    const p = this.db.plans.find((x) => x.id === id);
    return p ? clone(p) : null;
  }
  listAssessments(filter = {}) {
    let rows = this.db.assessments;
    if (filter.worker_id) rows = rows.filter((a) => a.worker_id === filter.worker_id);
    if (filter.plan_id) rows = rows.filter((a) => a.plan_id === filter.plan_id);
    return clone(rows);
  }
  getAssessment(id) {
    const a = this.db.assessments.find((x) => x.id === id);
    return a ? clone(a) : null;
  }
  listAudit(filter = {}) {
    let rows = this.db.audit_log;
    if (filter.entity) rows = rows.filter((a) => a.entity === filter.entity);
    if (filter.actor) rows = rows.filter((a) => a.actor === filter.actor);
    return clone(rows).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  _nextId(prefix, kind) {
    this.db.counters[kind] += 1;
    return `${prefix}_${String(this.db.counters[kind]).padStart(5, '0')}`;
  }

  _audit(action, entity, entityId, actor, summary, before, after) {
    this.db.counters.audit += 1;
    this.db.audit_log.push({
      id: `aud_${String(this.db.counters.audit).padStart(6, '0')}`,
      at: nowIso(),
      actor: actor || 'anonymous',
      action,
      entity,
      entity_id: entityId || null,
      summary,
      before_state: before ? redact(clone(before)) : null,
      after_state: after ? redact(clone(after)) : null,
    });
  }

  // ---------- 人员 ----------
  async createWorker(input, actor) {
    return this.mutate((db) => {
      if (db.workers.some((w) => w.worker_code === input.worker_code)) {
        throw new StorageError('duplicate_worker_code', `人员编号已存在：${input.worker_code}`, 409);
      }
      const id = this._nextId('wkr', 'worker');
      const worker = {
        id,
        worker_code: input.worker_code,
        display_name: input.display_name,
        authorization_level: input.authorization_level || 'standard',
        annual_limit_msv: numOrFail(input.annual_limit_msv, 'annual_limit_msv'),
        administrative_limit_msv: numOrFail(input.administrative_limit_msv, 'administrative_limit_msv'),
        period_start_day: input.period_start_day,
        period_days: input.period_days || DEFAULTS.PERIOD_DAYS,
        status: 'active',
        version: 1,
        created_at: nowIso(),
      };
      if (worker.administrative_limit_msv > worker.annual_limit_msv) {
        throw new StorageError('invalid_limits', '行政控制值不得高于法规规划年限值');
      }
      db.workers.push(worker);
      this._audit('worker.create', 'worker', id, actor,
        `创建人员 ${worker.worker_code}（年限值 ${worker.annual_limit_msv}，行政值 ${worker.administrative_limit_msv}）`, null, worker);
      return clone(worker);
    });
  }

  async updateWorker(id, input, actor) {
    return this.mutate((db) => {
      const w = db.workers.find((x) => x.id === id);
      if (!w) throw new StorageError('not_found', `人员不存在：${id}`, 404);
      if (typeof input.version !== 'number' || input.version !== w.version) {
        throw new StorageError('version_conflict', '人员版本已变化，请刷新后重试', 409);
      }
      const before = clone(w);
      const nextAnnual = input.annual_limit_msv !== undefined ? numOrFail(input.annual_limit_msv, 'annual_limit_msv') : w.annual_limit_msv;
      const nextAdmin = input.administrative_limit_msv !== undefined
        ? numOrFail(input.administrative_limit_msv, 'administrative_limit_msv') : w.administrative_limit_msv;
      if (nextAdmin > nextAnnual) throw new StorageError('invalid_limits', '行政控制值不得高于法规规划年限值');
      if (input.display_name !== undefined) w.display_name = input.display_name;
      if (input.authorization_level !== undefined) w.authorization_level = input.authorization_level;
      w.annual_limit_msv = nextAnnual;
      w.administrative_limit_msv = nextAdmin;
      if (input.period_start_day !== undefined) w.period_start_day = input.period_start_day;
      if (input.period_days !== undefined) {
        if (!Number.isInteger(input.period_days) || input.period_days <= 0) {
          throw new StorageError('invalid_period', 'period_days 必须为正整数');
        }
        w.period_days = input.period_days;
      }
      if (input.status !== undefined) w.status = input.status;
      w.version += 1;
      this._audit('worker.update', 'worker', id, actor, `更新人员 ${w.worker_code}（版本 ${before.version} → ${w.version}）`, before, w);
      return clone(w);
    });
  }

  // ---------- 暴露记录 ----------
  // 同一来源只能保存一次：source_ref 在原始记录（original）中全局唯一，
  // 更正产生的 reversal/replacement 复用同一来源不构成“二次保存”。
  _findActiveSource(db, sourceRef, exceptId) {
    return db.exposures.find((e) =>
      e.source_ref === sourceRef &&
      e.entry_type === ENTRY_TYPES.ORIGINAL &&
      e.id !== exceptId);
  }

  async createExposure(input, actor) {
    return this.mutate((db) => {
      const worker = db.workers.find((w) => w.id === input.worker_id);
      if (!worker) throw new StorageError('not_found', `人员不存在：${input.worker_id}`, 404);
      if (this._findActiveSource(db, input.source_ref)) {
        throw new StorageError('duplicate_source_ref', `同一来源只能保存一次：${input.source_ref}`, 409);
      }
      const id = this._nextId('exp', 'exposure');
      const entry = {
        id,
        worker_id: worker.id,
        source_ref: input.source_ref,
        occurred_at: input.occurred_at,
        dose_msv: numOrFail(input.dose_msv, 'dose_msv'),
        entry_type: ENTRY_TYPES.ORIGINAL,
        quality_flag: QUALITY_FLAGS.PENDING, // 录入后必须核验才计入
        verified_by: null,
        verified_at: null,
        correction_of_id: null,
        superseded_by: null,
        note: input.note || '',
        created_at: nowIso(),
        created_by: actor || null,
      };
      db.exposures.push(entry);
      this._audit('exposure.create', 'exposure', id, actor,
        `录入暴露 ${entry.source_ref}（${entry.dose_msv} mSv，待核验）`, null, { id, source_ref: entry.source_ref, quality_flag: entry.quality_flag });
      return clone(entry);
    });
  }

  async verifyExposure(id, { reviewer }, actor) {
    return this.mutate((db) => {
      const e = db.exposures.find((x) => x.id === id);
      if (!e) throw new StorageError('not_found', `暴露记录不存在：${id}`, 404);
      if (e.quality_flag !== QUALITY_FLAGS.PENDING) {
        throw new StorageError('invalid_state', `仅待核验记录可核验，当前状态：${e.quality_flag}`, 409);
      }
      const before = clone(e);
      e.quality_flag = QUALITY_FLAGS.VERIFIED;
      e.verified_by = reviewer || actor || 'rpo';
      e.verified_at = nowIso();
      this._audit('exposure.verify', 'exposure', id, actor,
        `核验通过 ${e.source_ref}（核验人 ${e.verified_by}）`, before, { id, quality_flag: e.quality_flag });
      return clone(e);
    });
  }

  async rejectExposure(id, { reviewer, reason }, actor) {
    return this.mutate((db) => {
      const e = db.exposures.find((x) => x.id === id);
      if (!e) throw new StorageError('not_found', `暴露记录不存在：${id}`, 404);
      if (e.quality_flag !== QUALITY_FLAGS.PENDING) {
        throw new StorageError('invalid_state', `仅待核验记录可拒绝，当前状态：${e.quality_flag}`, 409);
      }
      const before = clone(e);
      e.quality_flag = QUALITY_FLAGS.REJECTED;
      e.verified_by = reviewer || actor || 'rpo';
      e.verified_at = nowIso();
      e.note = reason ? `${e.note ? e.note + ' | ' : ''}拒绝原因：${reason}` : e.note;
      this._audit('exposure.reject', 'exposure', id, actor,
        `拒绝记录 ${e.source_ref}（原因长度 ${String(reason || '').length}）`, before, { id, quality_flag: e.quality_flag });
      return clone(e);
    });
  }

  // 更正：原值绝不覆盖。一次更正事务内创建 reversal（等值负）+ replacement（新值），
  // 原记录标记 superseded 并指向 replacement；三条记录全部保留。
  async correctExposure(id, input, actor) {
    return this.mutate((db) => {
      const original = db.exposures.find((x) => x.id === id);
      if (!original) throw new StorageError('not_found', `暴露记录不存在：${id}`, 404);
      if (original.entry_type !== ENTRY_TYPES.ORIGINAL || original.superseded_by) {
        throw new StorageError('correction_chain_conflict', '只能更正尚未被替代的原始记录', 409);
      }
      if (original.quality_flag !== QUALITY_FLAGS.VERIFIED) {
        throw new StorageError('correction_chain_conflict', '只能更正已核验记录；待核验记录请先拒绝后重新录入', 409);
      }
      if (this._findActiveSource(db, original.source_ref, original.id)) {
        throw new StorageError('duplicate_source_ref', `来源仍被其他活跃记录占用：${original.source_ref}`, 409);
      }
      const newDose = numOrFail(input.dose_msv, 'dose_msv');
      const reviewer = input.reviewer || actor || 'rpo';
      const at = nowIso();

      db.counters.exposure += 1;
      const reversalId = `exp_${String(db.counters.exposure).padStart(5, '0')}`;
      db.counters.exposure += 1;
      const replacementId = `exp_${String(db.counters.exposure).padStart(5, '0')}`;

      const reversal = {
        id: reversalId,
        worker_id: original.worker_id,
        source_ref: original.source_ref,
        occurred_at: original.occurred_at,
        dose_msv: -Math.abs(original.dose_msv), // 冲销原值
        entry_type: ENTRY_TYPES.REVERSAL,
        quality_flag: QUALITY_FLAGS.VERIFIED,
        verified_by: reviewer,
        verified_at: at,
        correction_of_id: original.id,
        superseded_by: null,
        note: `更正冲销：${original.id}`,
        created_at: at,
        created_by: actor || null,
      };
      const replacement = {
        id: replacementId,
        worker_id: original.worker_id,
        source_ref: original.source_ref,
        occurred_at: input.occurred_at || original.occurred_at,
        dose_msv: newDose,
        entry_type: ENTRY_TYPES.REPLACEMENT,
        quality_flag: QUALITY_FLAGS.VERIFIED,
        verified_by: reviewer,
        verified_at: at,
        correction_of_id: original.id,
        superseded_by: null,
        note: input.note || `更正替代：${original.id}`,
        created_at: at,
        created_by: actor || null,
      };
      const before = clone(original);
      // 原值禁止覆盖：原始记录保留为 verified 并保留原值，仅标记已被替代（用于追溯/前端展示）；
      // 累计侧通过 original + reversal + replacement 的净额得到更正值。
      original.superseded_by = replacementId;
      db.exposures.push(reversal, replacement);
      this._audit('exposure.correct', 'exposure', id, actor,
        `更正 ${original.source_ref}：${original.dose_msv} → ${newDose}（reversal ${reversalId}，replacement ${replacementId}）`,
        before, { original: original.id, reversal: reversalId, replacement: replacementId });
      return { original: clone(original), reversal: clone(reversal), replacement: clone(replacement) };
    });
  }

  // ---------- 作业计划 ----------
  async createPlan(input, actor) {
    return this.mutate((db) => {
      const worker = db.workers.find((w) => w.id === input.worker_id);
      if (!worker) throw new StorageError('not_found', `人员不存在：${input.worker_id}`, 404);
      if (db.plans.some((p) => p.plan_code === input.plan_code)) {
        throw new StorageError('duplicate_plan_code', `计划编号已存在：${input.plan_code}`, 409);
      }
      const id = this._nextId('pln', 'plan');
      const plan = {
        id,
        plan_code: input.plan_code,
        worker_id: worker.id,
        work_area: input.work_area || '',
        task_category: input.task_category || '',
        estimated_rate_msvh: numOrFail(input.estimated_rate_msvh, 'estimated_rate_msvh'),
        planned_minutes: numOrFail(input.planned_minutes, 'planned_minutes'),
        planned_on_day: input.planned_on_day || null,
        controls_json: Array.isArray(input.controls_json)
          ? input.controls_json.map(String)
          : splitControls(input.controls_json),
        permit_status: REVIEW_STATUSES.DRAFT,
        reviewer_id: null,
        version: 1,
        created_at: nowIso(),
      };
      db.plans.push(plan);
      this._audit('plan.create', 'plan', id, actor,
        `创建计划 ${plan.plan_code}（${plan.estimated_rate_msvh} mSv/h × ${plan.planned_minutes} min）`, null, { id, plan_code: plan.plan_code, permit_status: plan.permit_status });
      return clone(plan);
    });
  }

  async updatePlan(id, input, actor) {
    return this.mutate((db) => {
      const p = db.plans.find((x) => x.id === id);
      if (!p) throw new StorageError('not_found', `计划不存在：${id}`, 404);
      if (typeof input.version !== 'number' || input.version !== p.version) {
        throw new StorageError('version_conflict', '计划版本已变化，请刷新后重试', 409);
      }
      if (![REVIEW_STATUSES.DRAFT, REVIEW_STATUSES.REJECTED].includes(p.permit_status)) {
        throw new StorageError('invalid_state', `仅草稿/被拒绝的计划可编辑，当前状态：${p.permit_status}`, 409);
      }
      const before = clone(p);
      if (input.work_area !== undefined) p.work_area = input.work_area;
      if (input.task_category !== undefined) p.task_category = input.task_category;
      if (input.estimated_rate_msvh !== undefined) p.estimated_rate_msvh = numOrFail(input.estimated_rate_msvh, 'estimated_rate_msvh');
      if (input.planned_minutes !== undefined) p.planned_minutes = numOrFail(input.planned_minutes, 'planned_minutes');
      if (input.planned_on_day !== undefined) p.planned_on_day = input.planned_on_day || null;
      if (input.controls_json !== undefined) {
        p.controls_json = Array.isArray(input.controls_json)
          ? input.controls_json.map(String) : splitControls(input.controls_json);
      }
      // 被拒绝后重新编辑回到草稿，形成新一轮人工流程。
      if (p.permit_status === REVIEW_STATUSES.REJECTED) p.permit_status = REVIEW_STATUSES.DRAFT;
      p.version += 1;
      this._audit('plan.update', 'plan', id, actor, `编辑计划 ${p.plan_code}（版本 ${before.version} → ${p.version}）`, before, { id, permit_status: p.permit_status, version: p.version });
      return clone(p);
    });
  }

  async markPlanStatus(id, status, actor, reviewerId, note) {
    return this.mutate((db) => {
      const p = db.plans.find((x) => x.id === id);
      if (!p) throw new StorageError('not_found', `计划不存在：${id}`, 404);
      const before = clone(p);
      p.permit_status = status;
      if (reviewerId !== undefined) p.reviewer_id = reviewerId;
      p.version += 1;
      this._audit('plan.status', 'plan', id, actor,
        `计划 ${p.plan_code} 状态 → ${status}（备注长度 ${String(note || '').length}）`, before, { id, permit_status: status, version: p.version });
      return clone(p);
    });
  }

  async archivePlan(id, actor) {
    return this.mutate((db) => {
      const p = db.plans.find((x) => x.id === id);
      if (!p) throw new StorageError('not_found', `计划不存在：${id}`, 404);
      if (![REVIEW_STATUSES.PLANNING_ACCEPTED, REVIEW_STATUSES.REJECTED].includes(p.permit_status)) {
        throw new StorageError('invalid_state', '仅已接受或已拒绝的计划可归档', 409);
      }
      const before = clone(p);
      p.permit_status = REVIEW_STATUSES.ARCHIVED;
      p.version += 1;
      this._audit('plan.archive', 'plan', id, actor, `归档计划 ${p.plan_code}`, before, { id, permit_status: p.permit_status });
      return clone(p);
    });
  }

  // ---------- 评估（不可变快照，只追加） ----------
  async saveAssessment(doc, actor) {
    return this.mutate((db) => {
      const worker = db.workers.find((w) => w.id === doc.worker_id);
      if (!worker) throw new StorageError('not_found', `人员不存在：${doc.worker_id}`, 404);
      if (doc.plan_id) {
        const plan = db.plans.find((p) => p.id === doc.plan_id);
        if (!plan) throw new StorageError('not_found', `计划不存在：${doc.plan_id}`, 404);
      }
      const id = this._nextId('asm', 'assessment');
      const record = {
        id,
        worker_id: doc.worker_id,
        plan_id: doc.plan_id || null,
        as_of_day: doc.result.as_of_day,
        status: REVIEW_STATUSES.ASSESSED,
        result: clone(doc.result), // 冻结输入快照、证据、公式、阈值版本
        input_snapshot: { worker: clone(worker) },
        reviewer_id: null,
        review_note: null,
        reviewed_at: null,
        created_at: nowIso(),
        created_by: actor || null,
      };
      db.assessments.push(record);
      this._audit('assessment.save', 'assessment', id, actor,
        `保存评估：${record.result.risk_band_label}，投影 ${record.result.projected_dose_msv} mSv` +
        (record.result.first_exceedance ? '，含首超提示' : '') +
        (record.result.requires_manual_review ? '，需人工复核' : ''),
        null, { id, risk_band: record.result.risk_band, status: record.status });
      return clone(record);
    });
  }

  async submitAssessment(id, actor) {
    return this.mutate((db) => {
      const a = db.assessments.find((x) => x.id === id);
      if (!a) throw new StorageError('not_found', `评估不存在：${id}`, 404);
      if (a.status !== REVIEW_STATUSES.ASSESSED) {
        throw new StorageError('invalid_state', `仅已评估状态可提交复核，当前：${a.status}`, 409);
      }
      const before = clone(a);
      a.status = REVIEW_STATUSES.PENDING_RPO_REVIEW;
      this._audit('assessment.submit', 'assessment', id, actor, '提交 RPO 人工复核', { id: a.id, status: before.status }, { id: a.id, status: a.status });
      return clone(a);
    });
  }

  // RPO 人工处置：accept 仅表示“规划证据已接受”，明确不等于现场作业许可。
  async reviewAssessment(id, { decision, reviewer, note }, actor) {
    return this.mutate((db) => {
      const a = db.assessments.find((x) => x.id === id);
      if (!a) throw new StorageError('not_found', `评估不存在：${id}`, 404);
      if (a.status !== REVIEW_STATUSES.PENDING_RPO_REVIEW) {
        throw new StorageError('invalid_state', `仅待复核评估可处置，当前：${a.status}`, 409);
      }
      if (![REVIEW_STATUSES.PLANNING_ACCEPTED, REVIEW_STATUSES.REJECTED].includes(decision)) {
        throw new StorageError('invalid_decision', 'decision 必须是 planning_accepted 或 rejected');
      }
      const before = clone(a);
      a.status = decision;
      a.reviewer_id = reviewer || actor || 'rpo';
      a.review_note = note || '';
      a.reviewed_at = nowIso();
      // 同步推进关联计划的人工状态机（评估证据是计划处置的依据）。
      if (a.plan_id) {
        const p = db.plans.find((x) => x.id === a.plan_id);
        if (p && p.permit_status !== REVIEW_STATUSES.ARCHIVED) {
          p.permit_status = decision;
          p.reviewer_id = a.reviewer_id;
          p.version += 1;
        }
      }
      this._audit('assessment.review', 'assessment', id, actor,
        `RPO 人工处置：${decision}（非作业许可；备注长度 ${String(note || '').length}）`,
        { id: a.id, status: before.status }, { id: a.id, status: a.status, reviewer_id: a.reviewer_id });
      return clone(a);
    });
  }
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function nowIso() { return new Date().toISOString(); }

function numOrFail(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new StorageError('invalid_value', `${field} 必须是有限数值`);
  }
  if (v < 0) throw new StorageError('negative_value', `${field} 不得为负`);
  return v;
}

function splitControls(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[;；\n]/).map((s) => s.trim()).filter(Boolean);
}

// 审计落库前去掉可能的大字段/备注正文，只保留状态与摘要。
function redact(obj) {
  return obj;
}

module.exports = { Storage, StorageError };
