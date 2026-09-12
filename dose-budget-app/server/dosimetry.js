'use strict';

// 剂量预算核心算法（纯函数，不做持久化、不做 HTTP）。
// 单位约定：剂量 mSv，剂量率 mSv/h，时间 min。
// 周期采用半开区间 [periodStart, periodEnd)，日期一律按 UTC 当日零点比较。
// 重要边界：本模块只做规划计算与人工复核提示，任何输出都不是作业许可。

const DAY_MS = 24 * 60 * 60 * 1000;

// 默认限值/阈值（GB 18871 职业照射年平均有效剂量 20 mSv 的规划取值；
// 行政控制值由单位 ALARA 计划自行设定，默认 12 mSv）。
const DEFAULTS = Object.freeze({
  ANNUAL_LIMIT_MSV: 20,
  ADMIN_LIMIT_MSV: 12,
  PERIOD_DAYS: 365,
  NEAR_LEGAL_RATIO: 0.9,
  THRESHOLD_VERSION: 'ALARA-2026.1',
  ROUND_DIGITS: 4,
});

const RISK_BANDS = Object.freeze({
  WITHIN_ADMIN: 'within_admin', // 未超行政控制值
  ABOVE_ADMIN: 'above_admin',   // 超过行政控制值，但未接近法规限值
  NEAR_LEGAL: 'near_legal',     // 达到法规限值的 nearLegalRatio（含）
  ABOVE_LEGAL: 'above_legal',   // 超过法规限值
  INVALID: 'invalid',           // 非有限值等非法输入
});

const RISK_BAND_LABELS = Object.freeze({
  within_admin: '行政控制值内',
  above_admin: '超行政控制值',
  near_legal: '接近法规限值',
  above_legal: '超法规限值',
  invalid: '数据无效',
});

// 暴露记录质量状态
const QUALITY_FLAGS = Object.freeze({
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded', // 被更正替代的原始记录
});

const ENTRY_TYPES = Object.freeze({
  ORIGINAL: 'original',
  REVERSAL: 'reversal',     // 冲销
  REPLACEMENT: 'replacement', // 替代
});

// 评估/计划的人工处置状态（永远不存在“自动批准”）
const REVIEW_STATUSES = Object.freeze({
  DRAFT: 'draft',
  ASSESSED: 'assessed',
  PENDING_RPO_REVIEW: 'pending_rpo_review',
  PLANNING_ACCEPTED: 'planning_accepted', // 仅表示 RPO 记录了规划证据处置，不等于现场许可
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
});

const REVIEW_STATUS_LABELS = Object.freeze({
  draft: '草稿',
  assessed: '已评估',
  pending_rpo_review: '待 RPO 人工复核',
  planning_accepted: '规划证据已接受（非作业许可）',
  rejected: '规划被拒绝',
  archived: '已归档',
});

class DosimetryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DosimetryError';
    this.code = code;
  }
}

// 'YYYY-MM-DD' -> UTC 当日零点毫秒数；非法日期抛错（避免 new Date('x') 静默 NaN）。
function dayToMs(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new DosimetryError('invalid_date', `日期格式应为 YYYY-MM-DD：${String(day)}`);
  }
  const [y, m, d] = day.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new DosimetryError('invalid_date', `非法日历日期：${day}`);
  }
  return ms;
}

function msToDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 剂量/限值校验：有限、非负。
function assertDose(v, field) {
  if (!isFiniteNumber(v)) {
    throw new DosimetryError('non_finite_value', `${field} 必须是有限数值`);
  }
  if (v < 0) {
    throw new DosimetryError('negative_value', `${field} 不得为负：${v}`);
  }
  return v;
}

// 计划分钟数/剂量率校验：有限、非负。
function assertNonNegative(v, field) {
  if (!isFiniteNumber(v)) {
    throw new DosimetryError('non_finite_value', `${field} 必须是有限数值`);
  }
  if (v < 0) {
    throw new DosimetryError('negative_value', `${field} 不得为负：${v}`);
  }
  return v;
}

function round4(v) {
  if (!isFiniteNumber(v)) return v; // 调用方应先拦截
  return Math.round((v + Number.EPSILON) * 1e4) / 1e4;
}

// 计算滚动统计周期：以 periodStartDay 为锚点，长度 periodDays，半开区间 [start, end)。
// 返回 UTC 毫秒。asOfDay 缺省为今天（由调用方传入，保持纯函数可测）。
function currentPeriod(periodStartDay, periodDays, asOfDay) {
  const anchor = dayToMs(periodStartDay);
  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new DosimetryError('invalid_period', `统计周期天数必须为正整数：${periodDays}`);
  }
  const asOf = asOfDay ? dayToMs(asOfDay) : Date.now();
  if (asOf < anchor) {
    // 早于首个周期锚点：返回锚点开始的第一个周期（期间累计自然为 0）。
    return { startMs: anchor, startDay: msToDay(anchor), endMs: anchor + periodDays * DAY_MS, endDay: msToDay(anchor + periodDays * DAY_MS) };
  }
  const elapsedDays = Math.floor((asOf - anchor) / DAY_MS);
  const index = Math.floor(elapsedDays / periodDays);
  const startMs = anchor + index * periodDays * DAY_MS;
  const endMs = startMs + periodDays * DAY_MS;
  return { startMs, startDay: msToDay(startMs), endMs, endDay: msToDay(endMs) };
}

// 半开区间成员判断：occurredAt(YYYY-MM-DD) ∈ [startDay, endDay)
function inPeriod(occurredAt, period) {
  const t = dayToMs(occurredAt);
  return t >= period.startMs && t < period.endMs;
}

// 计划增量 = rate(mSv/h) * minutes / 60
function plannedIncrement(rateMsvh, minutes) {
  assertNonNegative(rateMsvh, 'estimated_rate_msvh');
  assertNonNegative(minutes, 'planned_minutes');
  return round4((rateMsvh * minutes) / 60);
}

// 判断一条暴露记录是否参与某个周期的核验累计。
// 返回 { included: boolean, reason: string }。
// 更正链采用规范会计求和：原始记录（即使已标记 superseded_by）+ 负值 reversal + replacement
// 三者都计入，净额即为更正后的值（10 + (-10) + 9 = 9），且原记录完整保留。
function classifyEntry(entry, period) {
  if (entry.quality_flag !== QUALITY_FLAGS.VERIFIED) {
    return { included: false, reason: `质量状态为 ${entry.quality_flag}，未经核验` };
  }
  if (!inPeriod(entry.occurred_at, period)) {
    return { included: false, reason: `发生日期 ${entry.occurred_at} 不在周期 [${period.startDay}, ${period.endDay}) 内` };
  }
  if (!isFiniteNumber(entry.dose_msv)) {
    return { included: false, reason: '剂量为非有限值' };
  }
  const chainNote = entry.superseded_by ? '（原始值，已被更正，与冲销/替代同时保留）'
    : entry.correction_of_id ? `（${entry.entry_type}，更正链）` : '';
  return { included: true, reason: `计入${chainNote}` };
}

// 累计周期内经核验的有效剂量；同时返回证据明细。
// 更正链求和 = original(未被替代时) + reversal(负值) + replacement。
function accumulatePeriod(exposures, period) {
  const included = [];
  const excluded = [];
  let sum = 0;
  for (const e of exposures) {
    const c = classifyEntry(e, period);
    const item = {
      exposure_id: e.id,
      source_ref: e.source_ref,
      occurred_at: e.occurred_at,
      dose_msv: e.dose_msv,
      entry_type: e.entry_type,
      quality_flag: e.quality_flag,
      correction_of_id: e.correction_of_id || null,
      reason: c.reason,
    };
    if (c.included) {
      sum += e.dose_msv;
      included.push(item);
    } else {
      excluded.push(item);
    }
  }
  if (!Number.isFinite(sum)) {
    throw new DosimetryError('non_finite_value', '周期累计结果为非有限值');
  }
  return { periodDoseMsv: round4(sum), included, excluded };
}

// 风险带判定（基于投影累计）。
function classifyRiskBand(projected, adminLimit, annualLimit, nearLegalRatio) {
  if (!isFiniteNumber(projected) || !isFiniteNumber(adminLimit) || !isFiniteNumber(annualLimit) ||
      !isFiniteNumber(nearLegalRatio) || adminLimit < 0 || annualLimit <= 0 ||
      nearLegalRatio <= 0 || nearLegalRatio > 1) {
    return RISK_BANDS.INVALID;
  }
  if (projected > annualLimit) return RISK_BANDS.ABOVE_LEGAL;
  if (projected >= annualLimit * nearLegalRatio) return RISK_BANDS.NEAR_LEGAL;
  if (projected > adminLimit) return RISK_BANDS.ABOVE_ADMIN;
  return RISK_BANDS.WITHIN_ADMIN;
}

// 首超提示：投影后将越过哪条限值、越过多少。
// 同一时刻双线被越过时，优先提示更严重的法规限值；未越过返回 null。
function firstExceedance(periodDose, increment, adminLimit, annualLimit) {
  const total = periodDose + increment;
  if (total > annualLimit && isFiniteNumber(annualLimit)) {
    return {
      limit: 'annual_limit_msv',
      limit_label: '法规规划年限值',
      limit_value_mSv: round4(annualLimit),
      projected_mSv: round4(total),
      overage_mSv: round4(total - annualLimit),
    };
  }
  if (total > adminLimit && isFiniteNumber(adminLimit)) {
    return {
      limit: 'administrative_limit_msv',
      limit_label: '行政控制值',
      limit_value_mSv: round4(adminLimit),
      projected_mSv: round4(total),
      overage_mSv: round4(total - adminLimit),
    };
  }
  return null;
}

// 年度分桶（自然年，UTC），用于五年平均：verified 记录按更正链净额计入
// （original + reversal + replacement，与周期累计一致），pending/rejected 不计。
// 缺失年份按 0 参与平均，并在结果中标注年份覆盖情况。
function yearlyVerifiedDoses(exposures, years) {
  const buckets = new Map(years.map((y) => [y, 0]));
  for (const e of exposures) {
    if (e.quality_flag !== QUALITY_FLAGS.VERIFIED) continue;
    const y = Number(String(e.occurred_at).slice(0, 4));
    if (buckets.has(y)) buckets.set(y, buckets.get(y) + e.dose_msv);
  }
  const perYear = years.map((y) => ({ year: y, dose_msv: round4(buckets.get(y) || 0) }));
  return perYear;
}

// 五年平均（截至 asOfYear 的最近 5 个日历年）。平均分母始终为 5（GB 18871
// 对连续 5 年平均的约束；数据不全时按 0 计并提示覆盖年份）。
function fiveYearAverage(exposures, asOfYear) {
  if (!Number.isInteger(asOfYear)) {
    throw new DosimetryError('invalid_year', `年份必须为整数：${asOfYear}`);
  }
  const years = [];
  for (let i = 4; i >= 0; i--) years.push(asOfYear - i);
  const perYear = yearlyVerifiedDoses(exposures, years);
  const total = perYear.reduce((s, x) => s + x.dose_msv, 0);
  const coveredYears = perYear.filter((x) => x.dose_msv > 0).map((x) => x.year);
  return {
    years,
    per_year: perYear,
    average_msv: round4(total / 5),
    total_msv: round4(total),
    covered_years: coveredYears,
    note: coveredYears.length < 5
      ? `近五年中仅 ${coveredYears.length} 个年度存在已核验记录，其余按 0 参与平均`
      : '近五年均存在已核验记录',
  };
}

// 生成人工复核提示（review prompts）。任何风险都只提示人工升级，不产生许可结论。
function buildReviewPrompts({ riskBand, firstOver, five, pendingCount, rejectedCount, hasUnverifiedInPeriod, annualLimit }) {
  const prompts = [];
  if (riskBand === RISK_BANDS.ABOVE_LEGAL) {
    prompts.push({ level: 'mandatory_escalation', message: '投影累计超过法规规划年限值：必须升级 RPO 与辐射防护负责人人工复核，不得仅依据规划结果安排作业。' });
  } else if (riskBand === RISK_BANDS.NEAR_LEGAL) {
    prompts.push({ level: 'mandatory_escalation', message: `投影累计已达到法规限值的 ${DEFAULTS.NEAR_LEGAL_RATIO * 100}%：必须人工复核并按 ALARA 复审控制措施。` });
  } else if (riskBand === RISK_BANDS.ABOVE_ADMIN) {
    prompts.push({ level: 'rpo_review', message: '投影累计超过行政控制值：需 RPO 人工复核后方可作为规划证据接受。' });
  }
  if (firstOver) {
    prompts.push({ level: 'first_exceedance', message: `首超提示：该计划执行后将首次越过「${firstOver.limit_label}」(${firstOver.limit_value_mSv} mSv)，投影 ${firstOver.projected_mSv} mSv，超出 ${firstOver.overage_mSv} mSv。` });
  }
  if (isFiniteNumber(five?.average_msv) && five.average_msv > annualLimit) {
    prompts.push({ level: 'mandatory_escalation', message: `近五年平均剂量 ${five.average_msv} mSv 超过 ${annualLimit} mSv 的连续年限约束，必须人工合规复核。` });
  }
  if (hasUnverifiedInPeriod) {
    prompts.push({ level: 'data_integrity', message: '当前统计周期内存在尚未核验或被拒绝的暴露记录：未计入累计，结论可能随核验结果变化。' });
  }
  if (pendingCount > 0) {
    prompts.push({ level: 'data_integrity', message: `共有 ${pendingCount} 条暴露记录待核验。` });
  }
  if (rejectedCount > 0) {
    prompts.push({ level: 'data_integrity', message: `共有 ${rejectedCount} 条暴露记录被拒绝，已排除在累计之外。` });
  }
  return prompts;
}

// 一次完整评估。asOfDay 缺省由调用方传入固定值（服务端传今天），保证可重放。
function assess({
  worker, plan, exposures, asOfDay,
  nearLegalRatio = DEFAULTS.NEAR_LEGAL_RATIO,
  thresholdVersion = DEFAULTS.THRESHOLD_VERSION,
}) {
  if (!worker || typeof worker !== 'object') {
    throw new DosimetryError('invalid_input', '缺少人员档案');
  }
  const annualLimit = worker.annual_limit_msv;
  const adminLimit = worker.administrative_limit_msv;
  assertDose(annualLimit, 'annual_limit_msv');
  assertDose(adminLimit, 'administrative_limit_msv');
  if (adminLimit > annualLimit) {
    throw new DosimetryError('invalid_limits', '行政控制值不得高于法规规划年限值');
  }
  const periodDays = worker.period_days || DEFAULTS.PERIOD_DAYS;
  const period = currentPeriod(worker.period_start_day, periodDays, asOfDay);

  const acc = accumulatePeriod(exposures || [], period);

  let increment = 0;
  let planPart = null;
  if (plan) {
    increment = plannedIncrement(plan.estimated_rate_msvh, plan.planned_minutes);
    planPart = {
      plan_id: plan.id,
      plan_code: plan.plan_code,
      estimated_rate_msvh: plan.estimated_rate_msvh,
      planned_minutes: plan.planned_minutes,
      planned_on_day: plan.planned_on_day || null,
      controls: plan.controls_json || [],
      formula: 'estimated_rate_msvh × planned_minutes ÷ 60',
      increment_msv: increment,
    };
  }

  const projected = round4(acc.periodDoseMsv + increment);
  if (!Number.isFinite(projected)) {
    throw new DosimetryError('non_finite_value', '投影累计为非有限值');
  }
  const remainingAdmin = round4(Math.max(0, adminLimit - projected)); // 余量钳制到 0，不返回负值
  const remainingLegal = round4(Math.max(0, annualLimit - projected));
  const riskBand = classifyRiskBand(projected, adminLimit, annualLimit, nearLegalRatio);
  const firstOver = firstExceedance(acc.periodDoseMsv, increment, adminLimit, annualLimit);

  const asOfYear = Number((asOfDay || period.endDay).slice(0, 4));
  const five = fiveYearAverage(exposures || [], asOfYear);

  const pendingCount = (exposures || []).filter((e) => e.quality_flag === QUALITY_FLAGS.PENDING).length;
  const rejectedCount = (exposures || []).filter((e) => e.quality_flag === QUALITY_FLAGS.REJECTED).length;
  const hasUnverifiedInPeriod = acc.excluded.some(
    (x) => (x.quality_flag === QUALITY_FLAGS.PENDING || x.quality_flag === QUALITY_FLAGS.REJECTED) &&
      x.reason.includes('周期'),
  );

  const prompts = buildReviewPrompts({
    riskBand, firstOver, five, pendingCount, rejectedCount, hasUnverifiedInPeriod, annualLimit,
  });

  // 只要不是完全绿色，或者存在待核验数据，就要求人工复核（系统永远不自动批准）。
  const requiresManualReview =
    riskBand !== RISK_BANDS.WITHIN_ADMIN || pendingCount > 0 || hasUnverifiedInPeriod || Boolean(plan);

  return {
    as_of_day: asOfDay || period.endDay,
    period: { start_day: period.startDay, end_day: period.endDay, days: periodDays },
    period_dose_msv: acc.periodDoseMsv,
    plan: planPart,
    planned_increment_msv: increment,
    projected_dose_msv: projected,
    remaining_admin_msv: remainingAdmin,
    remaining_legal_msv: remainingLegal,
    risk_band: riskBand,
    risk_band_label: RISK_BAND_LABELS[riskBand],
    first_exceedance: firstOver,
    five_year: five,
    requires_manual_review: requiresManualReview,
    automatic_approval: false, // 恒定：系统不输出作业许可
    review_prompts: prompts,
    evidence: {
      included_entries: acc.included,
      excluded_entries: acc.excluded,
      formulas: {
        planned_increment: 'estimated_rate_msvh × planned_minutes ÷ 60',
        projected: 'period_dose_msv + planned_increment_msv',
        remaining_admin: 'max(0, administrative_limit_msv − projected_dose_msv)',
        remaining_legal: 'max(0, annual_limit_msv − projected_dose_msv)',
      },
      threshold_version: thresholdVersion,
      near_legal_ratio: nearLegalRatio,
      limits: { annual_limit_msv: annualLimit, administrative_limit_msv: adminLimit },
    },
  };
}

module.exports = {
  DAY_MS,
  DEFAULTS,
  RISK_BANDS,
  RISK_BAND_LABELS,
  QUALITY_FLAGS,
  ENTRY_TYPES,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  DosimetryError,
  dayToMs,
  msToDay,
  isFiniteNumber,
  assertDose,
  assertNonNegative,
  round4,
  currentPeriod,
  inPeriod,
  plannedIncrement,
  classifyEntry,
  accumulatePeriod,
  classifyRiskBand,
  firstExceedance,
  yearlyVerifiedDoses,
  fiveYearAverage,
  buildReviewPrompts,
  assess,
};
