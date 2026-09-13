'use strict';

// 跨进程排他文件锁。
//
// 背景：存储的数据文件被多个进程共享时，若各自基于内存快照写入再 rename，
// 就会发生“最后写入者获胜”——两进程都报告成功、生成重复编号，但重新打开后
// 只剩一个进程的数据。本锁把每个“读-改-写”事务在进程间串行化：
//
//   1) 用 O_CREAT|O_EXCL（wx）原子创建锁文件，创建成功即持锁；
//   2) 已存在则退避重试，直到超时，超时按明确失败（lock_timeout）处理，不覆盖旧数据；
//   3) 只有在“锁已陈旧（超过阈值）且持锁进程在本机已不存在”时才接管，绝不抢活锁；
//   4) 释放时校验持有者令牌，只删自己的锁。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');

class LockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LockError';
    this.code = code;
    this.statusCode = 503;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // 信号 0：只做存在性检查，不发信号
    return true; // 存在（可能 EPERM，也说明进程活着）
  } catch (err) {
    return err.code === 'EPERM';
  }
}

class FileLock {
  constructor(lockPath, options = {}) {
    this.lockPath = lockPath;
    this.timeoutMs = options.timeoutMs ?? 10_000;   // 等锁最长时间，超时返回明确失败
    this.staleMs = options.staleMs ?? 15_000;       // 锁文件超过该年龄才可能被判陈旧
    this.retryDelayMs = options.retryDelayMs ?? 25;
    this.hostname = os.hostname();
    this.token = crypto.randomBytes(12).toString('hex');
    this._held = false;
  }

  // 返回锁句柄 { release }。获取失败抛 LockError('lock_timeout')。
  async acquire() {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const meta = {
        pid: process.pid,
        hostname: this.hostname,
        token: this.token,
        acquiredAt: new Date().toISOString(),
      };
      try {
        const fh = await fsp.open(this.lockPath, 'wx', 0o600); // 原子排他创建
        try {
          await fh.writeFile(JSON.stringify(meta), { encoding: 'utf8' });
          await fh.sync(); // 元数据落盘，崩溃后仍可据此识别陈旧锁
        } finally {
          await fh.close();
        }
        this._held = true;
        return { release: () => this.release() };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (await this._isStale()) {
          if (await this._steal()) {
            this._held = true;
            return { release: () => this.release() };
          }
        }
        if (Date.now() >= deadline) {
          throw new LockError('lock_timeout', `数据文件正被其他进程写入，等待锁超时（${this.timeoutMs}ms）；本次写入未执行，旧数据未受影响`);
        }
        await sleep(this.retryDelayMs);
      }
    }
  }

  async _readMeta() {
    try {
      const raw = await fsp.readFile(this.lockPath, 'utf8');
      const st = await fsp.stat(this.lockPath);
      const parsed = JSON.parse(raw); // 可能在对方刚创建尚未写完时读到空/半截
      return { parsed, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }

  async _isStale() {
    const info = await this._readMeta();
    if (!info) return false; // 锁刚好被释放，下一轮重试会重新尝试创建
    const ageMs = Date.now() - info.mtimeMs;
    if (ageMs < this.staleMs) return false; // 保守：不到陈旧阈值绝不接管
    const { parsed } = info;
    if (parsed && parsed.hostname === this.hostname) {
      return !pidIsAlive(Number(parsed.pid)); // 同机且持锁进程已死 → 陈旧
    }
    // 异机锁（本机无法探活）：要求超过更保守的陈旧阈值才接管。
    return ageMs >= this.staleMs * 2;
  }

  // 接管陈旧锁：删除后立即重新排他创建，删除与重建之间靠 EEXIST 重试仲裁。
  async _steal() {
    try {
      await fsp.unlink(this.lockPath);
    } catch (err) {
      if (err.code === 'ENOENT') return false; // 别人抢先
      throw err;
    }
    try {
      const fh = await fsp.open(this.lockPath, 'wx', 0o600);
      const meta = {
        pid: process.pid, hostname: this.hostname, token: this.token,
        acquiredAt: new Date().toISOString(), stolen: true,
      };
      try {
        await fh.writeFile(JSON.stringify(meta), { encoding: 'utf8' });
        await fh.sync();
      } finally {
        await fh.close();
      }
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false; // 与其他接管者竞争失败，回到重试
      throw err;
    }
  }

  // 只删除仍由自己持有的锁；读不到或令牌不符则不动，交给陈旧锁检测接管。
  async release() {
    if (!this._held) return;
    this._held = false;
    let meta = null;
    try {
      meta = JSON.parse(await fsp.readFile(this.lockPath, 'utf8'));
    } catch {
      return; // 无法确认是自己的锁：宁可遗留（由陈旧检测回收），也不误删活锁
    }
    if (!meta || meta.token !== this.token) return;
    try {
      await fsp.unlink(this.lockPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

module.exports = { FileLock, LockError, pidIsAlive };
