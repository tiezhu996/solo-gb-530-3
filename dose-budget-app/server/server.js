'use strict';

// HTTP 边界层：零依赖 Node http 服务。
// - /api/v1/* JSON API（统一响应包 {request_id, data} / {request_id, error}）
// - 其他路径托管前端静态文件（SPA 回退到 index.html）
// 本地离线工具：不实现用户认证；操作者通过 actor 字段记录（默认 local_planner），
// RPO 处置动作要求显式 reviewer 姓名，作为人工复核证据。系统不自动批准任何作业。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const dos = require('./dosimetry');
const { Storage, StorageError } = require('./storage');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createServer(storage) {
  const server = http.createServer((req, res) => {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    res.setHeader('X-Request-Id', requestId);
    handle(req, res, requestId, storage).catch((err) => {
      sendError(req, res, requestId, err);
      // 最小化访问日志：不记录请求体、备注正文和剂量明细。
      console.error(JSON.stringify({ t: new Date(started).toISOString(), request_id: requestId, method: req.method, path: req.url, status: err.statusCode || 500, err: err.code || 'internal' }));
    }).then(() => {
      if (res.writableEnded) {
        console.log(JSON.stringify({ t: new Date(started).toISOString(), request_id: requestId, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Date.now() - started }));
      }
    });
  });
  return server;
}

async function handle(req, res, requestId, storage) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/healthz') return ok(res, { status: 'ok' });
  if (p === '/readyz') {
    // 就绪检查：数据文件所属存储已打开即可（构造时完成）。
    return ok(res, { status: 'ready', schema_version: storage.db.schema_version });
  }

  if (!p.startsWith('/api/v1/')) return serveStatic(p, res);

  const seg = p.split('/').slice(3); // /api/v1/<...>
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
  const q = url.searchParams;
  const actor = (req.headers['x-actor'] && String(req.headers['x-actor']).slice(0, 64)) || 'local_planner';

  // ---------- workers ----------
  if (seg[0] === 'workers') {
    if (!seg[1] && req.method === 'GET') return ok(res, { request_id: requestId, data: storage.listWorkers() });
    if (!seg[1] && req.method === 'POST') {
      validateWorker(body);
      return ok(res, { request_id: requestId, data: await storage.createWorker(body, actor) }, 201);
    }
    if (seg[1] && req.method === 'GET') return found(res, storage.getWorker(seg[1]), requestId);
    if (seg[1] && req.method === 'PUT') {
      return ok(res, { request_id: requestId, data: await storage.updateWorker(seg[1], body, actor) });
    }
    throw new HttpError(405, 'method_not_allowed', '不支持的方法');
  }

  // ---------- exposures ----------
  if (seg[0] === 'exposures') {
    if (!seg[1] && req.method === 'GET') {
      return ok(res, { request_id: requestId, data: storage.listExposures({ worker_id: q.get('worker_id') }) });
    }
    if (!seg[1] && req.method === 'POST') {
      validateExposure(body);
      return ok(res, { request_id: requestId, data: await storage.createExposure(body, actor) }, 201);
    }
    if (seg[1] && !seg[2] && req.method === 'GET') return found(res, storage.getExposure(seg[1]), requestId);
    if (seg[1] && seg[2] === 'verify' && req.method === 'POST') {
      requireReviewer(body, '核验');
      return ok(res, { request_id: requestId, data: await storage.verifyExposure(seg[1], body, actor) });
    }
    if (seg[1] && seg[2] === 'reject' && req.method === 'POST') {
      requireReviewer(body, '拒绝');
      return ok(res, { request_id: requestId, data: await storage.rejectExposure(seg[1], body, actor) });
    }
    if (seg[1] && seg[2] === 'correct' && req.method === 'POST') {
      validateCorrection(body);
      return ok(res, { request_id: requestId, data: await storage.correctExposure(seg[1], body, actor) });
    }
    throw new HttpError(405, 'method_not_allowed', '不支持的方法');
  }

  // ---------- plans ----------
  if (seg[0] === 'plans') {
    if (!seg[1] && req.method === 'GET') {
      return ok(res, { request_id: requestId, data: storage.listPlans({ worker_id: q.get('worker_id') }) });
    }
    if (!seg[1] && req.method === 'POST') {
      validatePlan(body);
      return ok(res, { request_id: requestId, data: await storage.createPlan(body, actor) }, 201);
    }
    if (seg[1] && !seg[2] && req.method === 'GET') return found(res, storage.getPlan(seg[1]), requestId);
    if (seg[1] && !seg[2] && req.method === 'PUT') {
      return ok(res, { request_id: requestId, data: await storage.updatePlan(seg[1], body, actor) });
    }
    if (seg[1] && seg[2] === 'archive' && req.method === 'POST') {
      return ok(res, { request_id: requestId, data: await storage.archivePlan(seg[1], actor) });
    }
    throw new HttpError(405, 'method_not_allowed', '不支持的方法');
  }

  // ---------- assessments ----------
  if (seg[0] === 'assessments') {
    if (!seg[1] && req.method === 'GET') {
      return ok(res, {
        request_id: requestId,
        data: storage.listAssessments({ worker_id: q.get('worker_id'), plan_id: q.get('plan_id') }),
      });
    }
    if (!seg[1] && req.method === 'POST') {
      // 即时计算（不落库）：供“试算/情景比较”使用。
      if (q.get('preview') === '1' || body.preview === true) {
        return ok(res, { request_id: requestId, data: computeAssessment(storage, body) });
      }
      validateAssessment(body);
      const result = computeAssessment(storage, body);
      const saved = await storage.saveAssessment({ worker_id: body.worker_id, plan_id: body.plan_id, result }, actor);
      return ok(res, { request_id: requestId, data: saved }, 201);
    }
    if (seg[1] && seg[1] !== 'compare' && !seg[2] && req.method === 'GET') {
      return found(res, storage.getAssessment(seg[1]), requestId);
    }
    if (seg[1] === 'compare' && req.method === 'POST') {
      // 多计划情景比较：只计算不落库、不改变任何状态。
      if (!body.worker_id) throw new HttpError(400, 'invalid_input', '缺少 worker_id');
      const planIds = Array.isArray(body.plan_ids) ? body.plan_ids : [];
      const scenarios = planIds.map((pid) => computeAssessment(storage, {
        worker_id: body.worker_id, plan_id: pid, as_of_day: body.as_of_day,
      }));
      return ok(res, { request_id: requestId, data: { note: '情景比较仅供人工分析，不落库、不构成作业许可', scenarios } });
    }
    if (seg[1] && seg[2] === 'submit' && req.method === 'POST') {
      return ok(res, { request_id: requestId, data: await storage.submitAssessment(seg[1], actor) });
    }
    if (seg[1] && seg[2] === 'review' && req.method === 'POST') {
      if (!body.decision) throw new HttpError(400, 'invalid_input', '缺少 decision');
      requireReviewer(body, 'RPO 复核');
      return ok(res, { request_id: requestId, data: await storage.reviewAssessment(seg[1], body, actor) });
    }
    throw new HttpError(405, 'method_not_allowed', '不支持的方法');
  }

  // ---------- audit ----------
  if (seg[0] === 'audit' && req.method === 'GET') {
    return ok(res, { request_id: requestId, data: storage.listAudit({ entity: q.get('entity'), actor: q.get('actor') }) });
  }

  // ---------- meta ----------
  if (seg[0] === 'meta' && req.method === 'GET') {
    return ok(res, {
      request_id: requestId,
      data: {
        today: new Date().toISOString().slice(0, 10),
        defaults: dos.DEFAULTS,
        risk_bands: dos.RISK_BAND_LABELS,
        review_statuses: dos.REVIEW_STATUS_LABELS,
        quality_flags: dos.QUALITY_FLAGS,
        disclaimer: '本系统仅用于 ALARA 规划与人工复核提示，不是剂量计或作业许可控制器，不自动批准任何作业。',
      },
    });
  }

  throw new HttpError(404, 'not_found', `未知路径：${p}`);
}

function computeAssessment(storage, body) {
  const worker = storage.getWorker(body.worker_id);
  if (!worker) throw new HttpError(404, 'not_found', `人员不存在：${body.worker_id}`);
  let plan = null;
  if (body.plan_id) {
    plan = storage.getPlan(body.plan_id);
    if (!plan) throw new HttpError(404, 'not_found', `计划不存在：${body.plan_id}`);
    if (plan.worker_id !== worker.id) throw new HttpError(400, 'cross_worker', '计划与人员不匹配');
  }
  const exposures = storage.listExposures({ worker_id: worker.id });
  try {
    return dos.assess({ worker, plan, exposures, as_of_day: body.as_of_day || todayDay() });
  } catch (err) {
    if (err instanceof dos.DosimetryError) throw new HttpError(422, err.code, err.message);
    throw err;
  }
}

// ---------- 校验 ----------
function requireString(v, field) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'invalid_input', `缺少 ${field}`);
  return v.trim();
}
function requireNum(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new HttpError(400, 'invalid_input', `${field} 必须是非负有限数值`);
  }
  return v;
}
function requireDay(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new HttpError(400, 'invalid_input', `${field} 必须为 YYYY-MM-DD`);
  }
  try { dos.dayToMs(v); } catch { throw new HttpError(400, 'invalid_date', `${field} 不是合法日期`); }
  return v;
}
function validateWorker(b) {
  requireString(b.worker_code, 'worker_code');
  requireString(b.display_name, 'display_name');
  requireNum(b.annual_limit_msv, 'annual_limit_msv');
  requireNum(b.administrative_limit_msv, 'administrative_limit_msv');
  requireDay(b.period_start_day, 'period_start_day');
  if (b.period_days !== undefined && (!Number.isInteger(b.period_days) || b.period_days <= 0)) {
    throw new HttpError(400, 'invalid_period', 'period_days 必须为正整数');
  }
  if (b.administrative_limit_msv > b.annual_limit_msv) {
    throw new HttpError(400, 'invalid_limits', '行政控制值不得高于法规规划年限值');
  }
}
function validateExposure(b) {
  requireString(b.worker_id, 'worker_id');
  requireString(b.source_ref, 'source_ref');
  requireDay(b.occurred_at, 'occurred_at');
  requireNum(b.dose_msv, 'dose_msv');
}
function validateCorrection(b) {
  requireNum(b.dose_msv, 'dose_msv');
  requireString(b.reviewer, 'reviewer（RPO 核验人）');
  if (b.occurred_at !== undefined && b.occurred_at !== null && b.occurred_at !== '') requireDay(b.occurred_at, 'occurred_at');
}
function validatePlan(b) {
  requireString(b.worker_id, 'worker_id');
  requireString(b.plan_code, 'plan_code');
  requireNum(b.estimated_rate_msvh, 'estimated_rate_msvh');
  requireNum(b.planned_minutes, 'planned_minutes');
  if (b.planned_on_day) requireDay(b.planned_on_day, 'planned_on_day');
}
function validateAssessment(b) {
  requireString(b.worker_id, 'worker_id');
  if (b.as_of_day) requireDay(b.as_of_day, 'as_of_day');
}
function requireReviewer(b, action) {
  if (typeof b.reviewer !== 'string' || !b.reviewer.trim()) {
    throw new HttpError(400, 'reviewer_required', `${action}属于人工复核动作，必须填写复核人姓名`);
  }
}

// ---------- HTTP 工具 ----------
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', '请求体超过 1MB');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体不是合法 JSON');
  }
}

function ok(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function found(res, data, requestId) {
  if (!data) throw new HttpError(404, 'not_found', '记录不存在');
  ok(res, { request_id: requestId, data });
}
function sendError(req, res, requestId, err) {
  const status = err.statusCode || (err instanceof StorageError ? err.statusCode : 500) || 500;
  const code = err.code || 'internal_error';
  const message = status === 500 ? '服务器内部错误' : err.message;
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ request_id: requestId, error: { code, message } }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath);
  if (rel.includes('..')) { res.writeHead(400); return res.end('bad path'); }
  let file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC_DIR, 'index.html'); // SPA 回退
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

function todayDay() { return new Date().toISOString().slice(0, 10); }

async function main() {
  const storage = await Storage.open(DATA_FILE);
  const server = createServer(storage);
  server.listen(PORT, HOST, () => {
    const actualPort = server.address().port;
    console.log(JSON.stringify({ msg: '辐射作业个人剂量预算应用已启动', url: `http://${HOST}:${actualPort}`, data_file: DATA_FILE, port: actualPort }));
  });
  const shutdown = (sig) => {
    console.log(JSON.stringify({ msg: `收到 ${sig}，优雅停机` }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { createServer, computeAssessment, HttpError, PORT, DATA_FILE };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
