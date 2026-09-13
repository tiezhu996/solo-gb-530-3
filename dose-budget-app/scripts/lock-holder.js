'use strict';

// 测试辅助：一个独立的持锁进程。
// 用法：node scripts/lock-holder.js <数据文件路径> <模式>
//   hold  —— 获取排他锁后一直持有，直到收到 SIGTERM/SIGINT 才释放（干净退出，用于锁等待测试）
//   crash —— 获取锁后输出 READY，然后自我 SIGKILL（模拟持锁进程崩溃，留下陈旧锁文件）
//
// 注意：本文件位于 scripts/ 且命名不含 test 字样，不会被 node --test 当作测试用例收集。
const { FileLock } = require('../server/lock');

async function main() {
  const dataFile = process.argv[2];
  const mode = process.argv[3] || 'hold';
  if (!dataFile) throw new Error('缺少数据文件路径参数');
  const lock = new FileLock(`${dataFile}.lock`, { timeoutMs: 5_000, staleMs: 15_000 });
  const { release } = await lock.acquire();

  let finished = false;
  const cleanExit = async () => {
    if (finished) return;
    finished = true;
    await release();
    process.exit(0);
  };
  process.on('SIGTERM', cleanExit);
  process.on('SIGINT', cleanExit);

  if (mode === 'crash') {
    process.stdout.write('READY\n');
    process.kill(process.pid, 'SIGKILL'); // 无法捕获/清理，锁文件必然遗留
  }
  // hold 模式：保持事件循环存活，直到信号到来
  setInterval(() => {}, 1_000_000);
}

main().catch((err) => { console.error(err); process.exit(1); });
