# 辐射作业个人剂量预算（离线版）

一个零依赖的 Node.js 全栈小应用，用于辐射防护（ALARA）规划：维护**人员限值**、**离线暴露记录**和**作业计划**；暴露经录入与人工核验后按统计周期累计，叠加计划增量，给出**行政/法规余量、风险带、首超提示**；评估结果可保存、可回读。

> **安全边界**：本系统不是剂量计、医疗系统或作业许可控制器，不接入任何实时设备。所有结果只做**人工复核提示**，系统**不会自动批准任何作业**；不能替代法规、现场许可、辐射防护负责人（RPO）或医疗意见。

## 启动

需要 Node.js ≥ 18（无需 `npm install`，零第三方依赖）：

```bash
node server/server.js
# 或 npm start
```

默认监听 `http://localhost:8080`。可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_FILE` | `data/db.json` | 持久化数据文件（原子写入） |

浏览器打开 `http://localhost:8080` 即可使用。

## 主要功能

1. **人员限值**：人员编号、授权级别、法规规划年限值（默认 20 mSv）、行政控制值（默认 12 mSv）、统计周期锚点与天数；乐观锁版本。
2. **暴露台账**：录入后为 `pending`（待核验），**同一来源 `source_ref` 只能保存一次**（重复返回 `409 duplicate_source_ref`）；RPO 核验通过才计入累计，也可拒绝。**更正不覆盖原值**——一次更正事务保留原始记录，并追加等值负值冲销（reversal）与替代记录（replacement），累计净额 = 原 + 冲销 + 替代。
3. **作业计划**：剂量率（mSv/h）、时长（min）、控制措施；计划增量 = `剂量率 × 分钟 ÷ 60`。
4. **剂量预算评估**：
   - 半开区间 `[周期开始, 周期结束)` 的滚动统计周期累计（边界含首日、不含末日）；
   - `投影累计 = 期间已核验剂量 + 计划增量`；
   - `行政余量 = max(0, 行政控制值 − 投影)`，`法规余量 = max(0, 年限值 − 投影)`（余量不为负、不出现 NaN）；
   - 风险带：`within_admin / above_admin / near_legal(≥年限值90%) / above_legal / invalid`；
   - **首超提示**：计划执行后将首次越过哪条限值、超出多少（双线被越过时优先报告法规限值）；
   - 近 5 个自然年平均剂量（缺年按 0 并标注覆盖年份）；
   - 输入证据（计入/排除的每条记录及原因）、公式、阈值版本 `ALARA-2026.1`；
   - 评估**不可变、只追加**，冻结人员快照，可随时回读；多计划情景比较只计算不落库。
5. **人工状态机**：计划/评估 `draft → assessed → pending_rpo_review → planning_accepted | rejected → archived`。`planning_accepted` 仅表示“规划证据经 RPO 人工接受”，**不等于现场作业许可**；越级操作返回 `409 invalid_state`。所有核验/更正/复核动作必须填写复核人姓名。
6. **审计**：记录操作者、动作、摘要与前后状态（备注正文不入库），普通 API 不提供删除能力。

## HTTP API（前缀 `/api/v1`，响应含 `request_id`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` `/readyz` `/api/v1/meta` | 健康/就绪/枚举与默认值 |
| GET/POST/PUT | `/workers[/:id]` | 人员限值列表/创建/乐观锁更新 |
| GET/POST | `/exposures[?worker_id=]` | 暴露列表/录入（pending） |
| POST | `/exposures/:id/verify` `/reject` `/correct` | 核验 / 拒绝 / 不可变更正 |
| GET/POST/PUT | `/plans[/:id]` | 计划列表/创建/草案编辑 |
| POST | `/plans/:id/archive` | 归档 |
| POST | `/assessments[?preview=1]` | 试算（不落库）或计算并保存不可变评估 |
| GET | `/assessments[/:id]` | 列表 / 回读快照 |
| POST | `/assessments/compare` | 多计划情景比较（不落库） |
| POST | `/assessments/:id/submit` `/review` | 提交 RPO / RPO 人工接受或拒绝 |
| GET | `/audit[?entity=]` | 审计查询 |

请求需可带 `X-Actor` 头标识操作者（默认 `local_planner`）。错误统一为 `{request_id, error:{code,message}}`。

## 测试

```bash
npm test
```

- `test/dosimetry.test.js`：周期边界、单位换算、更正链、风险带顺序、首超、五年平均的表驱动单测；
- `test/e2e.test.js`：真实启动服务（临时数据文件），覆盖建限值→录入→重复来源拒绝→核验→更正保留原记录→计划→评估/首超/风险带→保存→越级拒绝→RPO 人工接受→审计→**杀掉进程重启后从磁盘完整回读**。

## 目录结构

```text
dose-budget-app/
├── package.json
├── server/
│   ├── dosimetry.js   # 纯算法：周期/累计/投影/风险带/首超/五年平均
│   ├── storage.js     # JSON 原子写入存储、唯一约束、更正事务、审计
│   └── server.js      # HTTP API + 静态托管
├── public/            # 零构建中文单页（index.html / app.js / styles.css）
├── data/db.json       # 运行后生成
└── test/              # node:test 单测与端到端冒烟
```

## License

MIT
