# 辐射作业个人剂量预算控制

`radiation-dose-budget-control` 是面向辐射防护计划人员的离线 ALARA 规划系统。它维护最小化人员授权概况、作业假设和已确认暴露记录，形成可重放的剂量预算证据，并由 RPO 人工复核。

> 系统不是剂量计、医疗系统或作业许可控制器，不接入实时设备，不输出“允许作业”结论。所有结果仅用于规划，不能替代法规、现场许可、辐射防护负责人或医疗意见。

## Docker 快速启动

Docker Compose 是首选运行方式，三个服务会在当前中文目录中直接构建和启动：

```bash
cp .env.example .env
# 同时修改 .env 中 POSTGRES_PASSWORD、DB_DSN 内密码和 JWT_SECRET
docker compose up -d --build
docker compose ps
```

`docker compose ps` 中 `postgres`、`backend`、`frontend` 均应为 `healthy`。

访问地址：

- 前端：`http://localhost:18530`
- 后端健康：`http://localhost:19530/healthz`
- 后端就绪：`http://localhost:19530/readyz`
- 前端反代健康：`http://localhost:18530/api/healthz`
- PostgreSQL：`localhost:57530`

停止并删除本项目数据卷：

```bash
docker compose down -v --remove-orphans
```

## 测试账号

| 角色 | 用户名 | 密码 | 权限边界 |
| --- | --- | --- | --- |
| planner | `planner` | `Planner#530` | 维护人员、暴露草稿和计划，运行/提交评估 |
| rpo_reviewer | `rpo` | `RPO#Review530` | 核验/更正记录，接受或拒绝规划情景，查看审计 |
| admin | `admin` | `Admin#530` | planner 与 RPO 能力的并集 |

账号仅用于本地演示。生产环境应替换种子认证方案和所有默认密钥。

## 核心功能

- 人员概况：维护人员编号、授权级别、行政控制值、法规规划限值、统计周期和乐观锁版本。
- 暴露台账：新记录先进入 `pending`；RPO 核验后才能计入期间累计。
- 不可变更正：原值禁止覆盖；一次更正事务创建负值 reversal 和新 replacement，完整保留链路。
- 作业计划：使用统一 mSv/mSv/h 单位维护剂量率、分钟数和具体控制措施。
- 剂量评估：冻结人员/计划版本、期间记录 ID、公式、阈值版本和控制措施，结果追加写入而非覆盖。
- 情景比较：对同一人员的多个计划做时间加权投影并比较风险带，不落库、不改变状态。
- 人工状态机：`draft -> assessed -> pending_rpo_review -> planning_accepted | rejected -> archived`。
- 操作审计：记录 request ID、操作者、参数摘要与前后状态；普通 API 不提供删除能力。

## 公式、周期与阈值

所有剂量统一使用 `mSv`，剂量率使用 `mSv/h`：

```text
计划增量 = estimated_rate_msvh × planned_minutes ÷ 60
投影累计 = 期间已核验剂量合计 + 计划增量
行政余量 = max(0, administrative_limit_msv - 投影累计)
法规余量 = max(0, annual_limit_msv - 投影累计)
```

- 期间采用半开区间 `[period_start, period_end)`，边界有表驱动测试。
- 仅 `quality_flag=verified` 的记录参与汇总；pending/rejected 会写入排除证据。
- 更正链按原始值 + reversal + replacement 求和，链循环、跨人员关联和重复 `source_ref` 会被拒绝。
- `near_legal` 默认从法规限值的 90% 开始；阈值版本默认 `ALARA-2026.1`。
- 负余量、负累计和非有限值会被阻断或钳制，不会返回 NaN。
- 超行政值或法规值只产生人工升级提示，风险带不会被 RPO 的规划处置改写。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Angular 17、TypeScript、Angular Material、RxJS、Angular CLI/esbuild |
| 后端 | Go 1.22、Gin、GORM、validator/v10、JWT、slog |
| 正式数据库 | PostgreSQL 16 |
| 自包含测试 | GORM SQLite，仅用于单测和 `runtime_smoke.py` |
| 部署 | Docker 多阶段构建、Nginx、Docker Compose V2 |

## 项目结构

```text
.
├── backend/
│   ├── cmd/server/                 # 启动与优雅停机
│   └── internal/
│       ├── config/                 # PostgreSQL/SQLite、环境和种子数据
│       ├── constants/              # 角色、计划状态、剂量风险带
│       ├── dosebudget/             # 周期、更正、投影、阈值、证据
│       ├── dto/                    # 请求与响应
│       ├── handler/                # Gin HTTP 边界
│       ├── middleware/             # request ID、日志、恢复、JWT/RBAC、限流
│       ├── model/                  # GORM 实体
│       ├── repository/             # 数据访问与条件更新
│       ├── router/                 # 按实体拆分路由
│       └── service/                # 事务、状态机、审计
├── frontend/src/app/
│   ├── api/                        # 按实体拆分 API 客户端
│   ├── components/common/          # 风险带、证据、安全边界
│   ├── hooks/                      # useAuth、useBudgetAssessment
│   ├── pages/                      # workers/plans/exposures/budgets/audit
│   ├── router/                     # 登录、认证与 RPO 守卫
│   ├── stores/                     # 按领域拆分信号状态
│   ├── types/                      # 前端共享枚举和实体
│   └── utils/                      # API 错误和 UTC 转换
├── scripts/api_smoke.sh            # 可重复的 PostgreSQL API 主链
├── docker-compose.yml
├── go.work
└── runtime_smoke.json              # 仅包含 SQLite 服务启动 manifest
```

## API

统一前缀为 `/api/v1`，响应包含 `request_id`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 登录并签发 JWT |
| GET/POST/PUT | `/workers[/:id]` | 人员列表、详情、创建和乐观锁更新 |
| GET/POST/PUT | `/plans[/:id]` | 计划列表、详情、创建和 draft 更新 |
| POST | `/plans/:id/archive` | 归档已复核计划 |
| GET/POST | `/exposures[/:id]` | 暴露列表、详情和 pending 记录创建 |
| POST | `/exposures/:id/verify` | RPO 核验或拒绝来源 |
| POST | `/exposures/:id/correct` | RPO 创建不可变 reversal/replacement 链 |
| GET/POST | `/assessments[/:id]` | 列表、详情和不可变评估 |
| POST | `/assessments/compare` | 同一人员多计划情景比较 |
| POST | `/assessments/:id/submit` | 提交 RPO 人工复核 |
| POST | `/assessments/:id/review` | RPO 记录规划接受或拒绝 |
| GET | `/audit` | RPO/admin 查询审计 |

错误统一为 `error.code`、`error.message` 和 `request_id`。常见冲突包括 `duplicate_source_ref`、`correction_chain_conflict`、`invalid_state`、`version_conflict` 和 `forbidden`。

## 枚举位置

### PermitStatus

值：`draft | assessed | pending_rpo_review | planning_accepted | rejected | archived`。

- 数据库/model：`backend/internal/model/work_permit_plan.go`
- 后端常量/状态机：`backend/internal/constants/permit.go`
- 后端 DTO/service/handler：`backend/internal/dto/work_permit_plan.go`、`backend/internal/service/work_permit_plan.go`、`backend/internal/service/dose_budget_assessment.go`、`backend/internal/handler/work_permit_plan.go`
- 前端类型/store/component/page：`frontend/src/app/types/permit.ts`、`stores/plans.store.ts`、`components/common/budget-evidence-panel.component.ts`、`pages/plans.page.ts`、`pages/budgets.page.ts`、`pages/audit.page.ts`

`planning_accepted` 的含义仅为“规划证据已由 RPO 记录处置”，不等于现场许可。

### DoseBand

值：`within_admin | above_admin | near_legal | above_legal | invalid`。

- 数据库/model：`backend/internal/model/dose_budget_assessment.go`
- 后端常量/算法：`backend/internal/constants/dose.go`、`backend/internal/dosebudget/threshold.go`
- 后端 DTO/service/handler：`backend/internal/dto/dose_budget_assessment.go`、`backend/internal/service/dose_budget_assessment.go`、`backend/internal/handler/dose_budget_assessment.go`
- 前端类型/store/component/page：`frontend/src/app/types/dose.ts`、`stores/budget.store.ts`、`components/common/dose-band-badge.component.ts`、`components/common/budget-evidence-panel.component.ts`、`pages/budgets.page.ts`、`pages/audit.page.ts`

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `radiation-dose-budget-control` | 稳定 Compose/容器/卷名称 |
| `FRONTEND_PORT` / `BACKEND_PORT` / `POSTGRES_PORT` | `18530 / 19530 / 57530` | 宿主端口 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | 见 `.env.example` | PostgreSQL 初始化 |
| `DB_DRIVER` / `DB_DSN` | `postgres` / PostgreSQL DSN | 正式数据库连接 |
| `DB_AUTO_MIGRATE` | `true` | 启动时迁移表 |
| `JWT_SECRET` / `JWT_TTL_MINUTES` | 本地密钥 / `480` | JWT 签名与有效期 |
| `CORS_ORIGIN` | `http://localhost:18530` | 本地开发源 |
| `RATE_LIMIT_PER_MINUTE` | `240` | 单进程 IP 限流 |
| `DEFAULT_PERIOD_DAYS` | `365` | 默认统计周期配置 |
| `DEFAULT_ANNUAL_LIMIT_MSV` | `20` | 默认法规规划值 |
| `DEFAULT_ADMIN_LIMIT_MSV` | `12` | 默认行政控制值 |
| `NEAR_LEGAL_RATIO` | `0.90` | 接近法规值的比例 |
| `THRESHOLD_VERSION` | `ALARA-2026.1` | 冻结进评估证据的版本 |

## 本地开发与验证

需要 Go 1.22、Node.js 20、npm 和 CGO 可用的 SQLite 工具链。

```bash
go work sync
go build ./backend/...
go vet ./backend/...
go test -race ./backend/...

npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run build



```

启动 Compose 后可运行真实 PostgreSQL API 主链：

```bash
scripts/api_smoke.sh
```

脚本会创建带低阈值的隔离测试人员，并验证重复来源、核验、更正链、投影、超阈值、比较、状态机、RBAC 和审计。

## 安全与隐私边界

- 人员档案只保存规划所需的编号、显示名、授权概况和限值，不保存诊断、治疗或病历。
- API 和结构化访问日志不记录 JWT、密码、完整请求体或 RPO 备注正文；审计仅记录备注长度。
- planner 不能执行 RPO 复核，RPO 不能创建人员或计划；权限同时由后端中间件、路由守卫和按钮显隐实施。
- 多步更正、评估、提交和复核使用数据库事务；状态变化使用条件更新与版本检查。
- 不包含排班预约、工单、财务、计费、库存、绩效、设备接入或实时采集能力。

## 常见问题

- **后端不健康**：执行 `docker compose logs backend postgres`，确认 `POSTGRES_PASSWORD` 与 `DB_DSN` 中密码一致。
- **前端 API 404**：通过 `http://localhost:18530` 访问；Nginx 会保留 `/api/v1` 路径代理到 `backend:8080`。
- **409 duplicate_source_ref**：来源引用全局唯一。不得覆盖旧记录，应由 RPO 使用 correction API。
- **409 version_conflict**：其他操作已推进计划版本；重新加载后基于最新输入生成新评估。
- **风险带没有因接受而变绿**：这是预期行为。RPO 处置不改变客观投影或阈值证据。

## License

MIT
