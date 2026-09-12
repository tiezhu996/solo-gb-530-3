'use strict';

// 表驱动单元测试：周期边界（半开区间）、计划增量、累计、风险带、首超、五年平均。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dos = require('../server/dosimetry');

test('currentPeriod 半开区间滚动周期边界', () => {
  const cases = [
    { asOf: '2026-01-01', wantStart: '2026-01-01', wantEnd: '2027-01-01' }, // 锚点当天 = 第 0 周期
    { asOf: '2026-12-31', wantStart: '2026-01-01', wantEnd: '2027-01-01' }, // 结束日前一天仍在周期内
    { asOf: '2027-01-01', wantStart: '2027-01-01', wantEnd: '2028-01-01' }, // 结束日当天滚入下一周期
    { asOf: '2025-12-31', wantStart: '2026-01-01', wantEnd: '2027-01-01' }, // 早于锚点返回首个周期
  ];
  for (const c of cases) {
    const p = dos.currentPeriod('2026-01-01', 365, c.asOf);
    assert.equal(p.startDay, c.wantStart, `${c.asOf} start`);
    assert.equal(p.endDay, c.wantEnd, `${c.asOf} end`);
  }
});

test('inPeriod 边界：含起始日、不含结束日', () => {
  const p = dos.currentPeriod('2026-01-01', 365, '2026-06-01');
  assert.equal(dos.inPeriod('2026-01-01', p), true);
  assert.equal(dos.inPeriod('2026-12-31', p), true);
  assert.equal(dos.inPeriod('2027-01-01', p), false);
  assert.equal(dos.inPeriod('2025-12-31', p), false);
});

test('plannedIncrement 表驱动换算与防护', () => {
  const cases = [
    { rate: 0.3, min: 60, want: 0.3 },
    { rate: 1.2, min: 30, want: 0.6 },
    { rate: 0, min: 90, want: 0 },
    { rate: 2.5, min: 12, want: 0.5 },
  ];
  for (const c of cases) assert.equal(dos.plannedIncrement(c.rate, c.min), c.want);
  assert.throws(() => dos.plannedIncrement(-1, 10), /不得为负/);
  assert.throws(() => dos.plannedIncrement(NaN, 10), /有限/);
});

test('accumulatePeriod 只计 verified 且处理更正链与排除原因', () => {
  const period = dos.currentPeriod('2026-01-01', 365, '2026-09-01');
  const exposures = [
    { id: 'e1', source_ref: 'S1', occurred_at: '2026-02-01', dose_msv: 3, entry_type: 'original', quality_flag: 'verified' },
    { id: 'e2', source_ref: 'S2', occurred_at: '2026-03-01', dose_msv: 2, entry_type: 'original', quality_flag: 'pending' },
    { id: 'e3', source_ref: 'S3', occurred_at: '2026-04-01', dose_msv: 5, entry_type: 'original', quality_flag: 'rejected' },
    { id: 'e1b', source_ref: 'S1', occurred_at: '2026-02-01', dose_msv: -3, entry_type: 'reversal', quality_flag: 'verified', correction_of_id: 'e1' },
    { id: 'e1c', source_ref: 'S1', occurred_at: '2026-02-01', dose_msv: 1.2, entry_type: 'replacement', quality_flag: 'verified', correction_of_id: 'e1' },
    { id: 'e0', source_ref: 'S0', occurred_at: '2025-12-31', dose_msv: 9, entry_type: 'original', quality_flag: 'verified' },
  ];
  // 模拟原记录已被替代
  exposures[0].superseded_by = 'e1c';
  const r = dos.accumulatePeriod(exposures, period);
  // e2 pending、e3 rejected、e0 周期外被排除；原(3)+冲销(-3)+替代(1.2) 净额 1.2
  assert.equal(r.periodDoseMsv, 1.2);
  const ids = r.included.map((x) => x.exposure_id).sort();
  assert.deepEqual(ids, ['e1', 'e1b', 'e1c']);
  const reasons = Object.fromEntries(r.excluded.map((x) => [x.exposure_id, x.reason]));
  const includedReason = Object.fromEntries(r.included.map((x) => [x.exposure_id, x.reason]));
  assert.match(includedReason.e1, /已被更正/); // 原记录保留且在求和中，标注已被更正
  assert.match(reasons.e2, /未经核验/);
  assert.match(reasons.e0, /不在周期/);
});

test('classifyRiskBand 阈值顺序表驱动', () => {
  const cases = [
    { proj: 12, band: dos.RISK_BANDS.WITHIN_ADMIN },
    { proj: 12.01, band: dos.RISK_BANDS.ABOVE_ADMIN },
    { proj: 17.99, band: dos.RISK_BANDS.ABOVE_ADMIN },
    { proj: 18, band: dos.RISK_BANDS.NEAR_LEGAL },   // >= 20 * 0.9
    { proj: 20, band: dos.RISK_BANDS.NEAR_LEGAL },
    { proj: 20.01, band: dos.RISK_BANDS.ABOVE_LEGAL },
  ];
  for (const c of cases) {
    assert.equal(dos.classifyRiskBand(c.proj, 12, 20, 0.9), c.band, String(c.proj));
  }
  assert.equal(dos.classifyRiskBand(NaN, 12, 20, 0.9), dos.RISK_BANDS.INVALID);
});

test('firstExceedance 优先报告法规限值', () => {
  assert.equal(dos.firstExceedance(19, 1.5, 12, 20).limit, 'annual_limit_msv'); // 20.5 越过双线，优先法规
  const a = dos.firstExceedance(11, 1.5, 12, 20);
  assert.equal(a.limit, 'administrative_limit_msv');
  assert.equal(a.overage_mSv, 0.5);
  assert.equal(dos.firstExceedance(10, 1, 12, 20), null);
});

test('五年平均：缺年按 0，更正链按替代记录发生年', () => {
  const exposures = [
    { id: 'a', source_ref: 'A', occurred_at: '2023-05-01', dose_msv: 10, entry_type: 'original', quality_flag: 'verified' },
    { id: 'b', source_ref: 'B', occurred_at: '2025-05-01', dose_msv: 5, entry_type: 'original', quality_flag: 'verified' },
    { id: 'p', source_ref: 'P', occurred_at: '2024-05-01', dose_msv: 8, entry_type: 'original', quality_flag: 'pending' },
  ];
  const r = dos.fiveYearAverage(exposures, 2026);
  assert.deepEqual(r.years, [2022, 2023, 2024, 2025, 2026]);
  assert.equal(r.total_msv, 15);
  assert.equal(r.average_msv, 3);
  assert.deepEqual(r.covered_years, [2023, 2025]);
});

test('assess 端到端计算与人工复核语义', () => {
  const worker = {
    id: 'w', annual_limit_msv: 20, administrative_limit_msv: 12,
    period_start_day: '2026-01-01', period_days: 365,
  };
  const plan = { id: 'p', plan_code: 'P1', estimated_rate_msvh: 1.5, planned_minutes: 120, controls_json: [] };
  const exposures = [
    { id: 'e1', source_ref: 'S1', occurred_at: '2026-03-01', dose_msv: 10, entry_type: 'original', quality_flag: 'verified' },
    { id: 'e2', source_ref: 'S2', occurred_at: '2026-04-01', dose_msv: 2, entry_type: 'original', quality_flag: 'pending' },
  ];
  const r = dos.assess({ worker, plan, exposures, asOfDay: '2026-09-01' });
  assert.equal(r.planned_increment_msv, 3);       // 1.5 × 120 / 60
  assert.equal(r.period_dose_msv, 10);           // pending 不计
  assert.equal(r.projected_dose_msv, 13);
  assert.equal(r.remaining_admin_msv, 0);        // 钳制
  assert.equal(r.remaining_legal_msv, 7);
  assert.equal(r.risk_band, dos.RISK_BANDS.ABOVE_ADMIN);
  assert.equal(r.first_exceedance.limit, 'administrative_limit_msv');
  assert.equal(r.automatic_approval, false);
  assert.equal(r.requires_manual_review, true);
  assert.ok(r.review_prompts.some((p) => p.level === 'first_exceedance'));
  assert.ok(r.review_prompts.some((p) => p.level === 'data_integrity'));
});

test('assess 非法限值组合被拒绝', () => {
  assert.throws(() => dos.assess({
    worker: { id: 'w', annual_limit_msv: 10, administrative_limit_msv: 12, period_start_day: '2026-01-01' },
    exposures: [], asOfDay: '2026-09-01',
  }), /行政控制值不得高于法规/);
});
