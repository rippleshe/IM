# 阅读进度

# 2026-08-29 总规阶段一~五主体执行：PG 单数据源 + 诊断/画像/苏格拉底 + 混合检索/批评裁决 + 评测交付

- 阶段一A/B：未提交的用户自传头像工作收口——PATCH /api/auth/avatar-image、users.avatar_image（SQLite ensureColumn + PG 迁移 0003）、共享 ProfileDialog，三个工作台顶栏统一 AvatarBubble 消费 avatarImage；清理一次性脚本与根目录旧 .next；前端 .next 缓存损坏导致的 GET / 404 已排查修复（清缓存重启）。
- 阶段一D（核心）：PostgreSQL 单数据源切换落地。新增 server/db/pg-store.ts（PgIdentityStore + PgLearningStore，与 SQLite 版逐方法等价：BKT/诊断/路径/资产/反馈/画像/证据/隐私审计，jsonb 显式序列化避免数组转 PG 数组字面量的坑）与 server/db/pg-evidence.ts（PgEvidenceService + 结构化数据集查询 + 干净环境引导导入）；study-context.ts 数据源开关（DATABASE_URL 即 PG，IM_TRAINING_AGENT_DATA_SOURCE=sqlite 回退）；全部存储调用点补 await（await 对同步实现 no-op，双实现兼容），routes.ts requireLearner 异步化修复 learner_id=undefined 的门禁绕过隐患；IdentityStore 新增 getByLoginName 公共 API 替换 demo-seed 的内部 hack 查询。
- 关键修复：ESM import 提升 + dotenv 时序问题——study-runtime 在 index.ts 的 dotenv.config() 之前求值，DASHSCOPE_API_KEY 为空导致模型 provider 未注册，服务内所有 LLM 调用一直静默走兜底模板；study-runtime/study-context 顶部前置 import 'dotenv/config' 后修复。
- 阶段一C：Compose 全链路补齐——新增 bootstrap 服务（scripts/db-bootstrap.ts：迁移→Metro 目录→AI4I→知识卡→可选 Metro CSV，全部幂等，实测跑通）、web 服务（web/Dockerfile standalone 构建）；tsup 增加 db-bootstrap 入口，Dockerfile 携带迁移 SQL 与引导数据；compose config 校验通过（镜像构建因 docker.io 网络不可达暂缓，待代理重试）。
- --cutover 标记已写入：PostgreSQL 为唯一业务数据源，SQLite 仅作只读备份；PG 实测端到端：注册→建档→诊断→证据→Run 十节点 DAG→门禁发布入库→assets/作答/画像全链路；demo:seed 直接种入 PG（三账号差异化 BKT/LLM 路径/画像）。
- 阶段二A：建档后强制 12 题入学诊断——新增 web/src/components/diagnostic-flow.tsx（逐题作答自动前进、服务端判分、维度小结与逐题解析）；/api/auth/me、login、register、onboarding 统一携带 diagnosticCompleted。
- 阶段二B：GET /api/learning/profile 扩展 blindSpots（BKT 掌握×作答证据排序）/difficultyCurve（难度校准推导，预计成功率落 65-80% 教学区间）/resourceMatch（六类资源适配建议）；新增 GET /api/learning/bkt-updates 审计端点；server/profile-insights.ts 确定性洞见模块；画像弹窗新增盲区/难度曲线/资源匹配三区块。
- 阶段二C：苏格拉底启发式追问全链路——guidance_sessions/guidance_turns PG 表（迁移 0004）、src/learning/socratic.ts 纯函数（关键度×(1-置信度) 选题、终止条件、确定性兜底）、server/guidance-service.ts 编排（LLM 逐轮提问与公开评价、每轮 BKT 更新、置信≥0.8 或 5 轮终止出决策）、两个 API 端点、前端 guidance-dialog.tsx + 路径页节点详情入口；实测 LLM 生成式追问 + BKT 0.357→0.5 实时更新。
- 阶段三A：运行时混合检索——src/learning/retrieval/hybrid.ts（纯 RRF，k=60）+ server/db/pg-retrieval.ts（tsvector 全文路与 pgvector cosine 向量路各 top-20、RRF 融合 top-8）；查询向量 DashScope text-embedding-v4，嵌入失败降级纯 FTS 并把降级原因写入 EvidencePack.hybrid 与 Run 事件/群聊气泡；bootstrap 重导后向量重回填（缓存复用 616/616 零成本）。
- 阶段三B：独立批评 Agent + 裁决 Agent——debate_issues 加 source 列（迁移 0005）；反方质询升级为规则兜底 + LLM 独立批评（检测无证据/冲突/越界因果/难度失配，失败静默回退）；裁决升级为规则裁决 + 裁决 Agent 独立判决取更严者（门禁只能收紧不能放松），rationale 记录双轨；实测批评 Agent 补充 3 条高质量议题（量化支持缺失/未验证因果/难度失配）、双轨裁决一致。
- 阶段四：六类资源端到端扫描全部 succeeded 且门禁通过入库（auditStatus passed + difficultyCalibration 落库）；concept_map 的 Mermaid flowchart 文本在资源页客户端渲染（web 新增 mermaid 依赖动态导入，失败回退代码块）；阅读反馈→预填→作答→BKT→节点建议闭环此前已验证。
- 阶段五：三账号证据包导出 data/exports/{persona}-run-export.json（画像+诊断+DAG 节点+22-23 事件+声明图+裁决+最终资产，差异化任务产出差异化资源）；scripts/ablation.ts 消融实验三组全过——A1 动态 DAG 三画像分化 3 种计划（固定 1 种）、A2 发布资源幻觉率 0（4 次运行）、A3 BKT 校准难度成功率 33/33 落 65-80% 区间（固定 0.42 仅 2/33）；evaluate 支持 --stride 分层采样；pnpm evaluate --live 分层子集验证真实生成幻觉率；findings.md §6 演示分镜按当前产品更新。
- 踩坑记录：node-postgres 会把 JS 数组序列化为 PG 数组字面量导致 jsonb 列写入报错（需显式 JSON.stringify）；drizzle select 返回数组而非 {rows}；export 脚本 grep 节点状态误判运行终态（须锚定 run 对象）；本机 5432 被 PG 占用继续沿用 15432/16379；docker.io 直连不可达影响镜像构建。
- 验证：typecheck 0 错、115 测试全过、前端 tsc/standalone 构建通过；PG 模式全链路冒烟与冒烟数据清理完成。

# 2026-08-28 BullMQ 动态 DAG 全链路 + 个性化算法层（8/30-9/3 日程主体完成）

- 模型运行时与数据层引导抽为共享模块：server/study-runtime.ts（模型注册/角色路由/发布门禁）、server/study-context.ts（SQLite 打开与存储实例），api 与 worker 进程同源不再复制；index.ts 两段纯搬移并验证启动。
- runs 模块落地：queue.ts（BullMQ，jobId=runId:nodeKey:attempt 幂等、重试≤2、指数退避）、service.ts（study_runs/nodes/run_events 持久化，jsonb 原子合并 context，单条 SQL 原子分配单调 seq）、executor.ts（十节点执行器：双路检索并行→领域分析→生成→Claim 审核→反方质询→证据裁决→隐私→发布；修订环最多 2 轮；裁决落 audit_decisions，质询落 debate_issues，Claim 落 claims/claim_evidence）、worker.ts（独立进程，并发 4，优雅退出）。
- SSE 事件流：GET /api/learning/runs/:runId/events 支持 Last-Event-ID 断点续传（PostgreSQL 回放 + Redis 实时分发）；POST /runs 返回 202+plan；快照/取消接口齐备；门禁角色 custom 模式下真实裁剪且不可移除。
- 前端切换：学习页 submit 改 POST /api/learning/runs，EventSource 驱动实时节点状态条（运行中/成功/失败/修订中），终态拉全量历史替换；旧 study/chat、activeStudyRuns、进程内 executeStudyRun 同批删除；指定角色补"资源生成"并校验 ≥3 业务角色。
- 个性化算法层（纯函数+测试）：bkt.ts（贝叶斯修正+学习转移+证据量置信度，n=9 过 0.80 门限）、difficulty.ts（成功率模型 p̂=readiness+support·(1-d)−0.2d，目标 72%，区间 65-80%）、diagnostic.ts（12 题五维固定题集+判分+BKT 初始状态）。初稿难度模型在"初学者×高脚手架"方向反了，已重导并按教学原则重定评测区间。
- 存储层：SQLite 补 BKT 参数列/bkt_updates/诊断表/资产难度列（ensureColumn 迁移兼容）；submitQuizAttempt 的启发式更新替换为 BKT；新增 applySkillObservation/getSkillState(s)/saveDiagnosticSession；saveAsset 落 difficulty+calibration。
- D2 修复完成：资源构建链接 calibrateDifficulty（executor 按资源类型定脚手架、按路径边算先修就绪度），实测"初学者×习题"校准难度 0（原 0.42 硬编码），rationale 完整落库。
- 诊断 API：GET /api/learning/diagnostic（不下发答案）、POST /api/learning/diagnostic-attempts（服务端判分→BKT→诊断会话落库→解析回放）。
- 三账号种子：pnpm demo:seed 幂等创建 learner-foundation/advanced/maintenance，确定性诊断作答（5/12、10/12、8/12）驱动差异化 BKT 初始状态；密码只从 IM_TRAINING_AGENT_DEMO_PASSWORD 注入。
- 证据包导出：GET /api/learning/runs/:runId/export 单文件 JSON（画像+诊断+DAG 节点+事件+结论+声明图+资源+反馈）。
- 评测器：pnpm evaluate 离线模式 60 案例（三画像×20，确定性生成）→ 难度适配 100%、核心知识覆盖 100%（教学区间独立设定、覆盖按知识库包含检查）；幻觉率需 --live 模式执行真实运行；结果落 evaluation_cases/results，报告写 data/。阈值不达标退出码 1。
- 踩坑记录：本机原生 PostgreSQL 占 5432 导致容器连接串认错服务（改 15432/16379）；新旧 worker 进程并存抢任务导致看到旧代码产物（全杀重启后验证通过）；drizzle-kit migrate 静默退出改用编程式 migrator。
- 验证：typecheck 0 错、115 测试全过、tsup（含 worker 入口）与 Next 构建通过；端到端两次真实运行（讲义 10 节点全过资产入库；习题校准难度落库）；SSE 续传实测 id 21/22 精确回放；服务 3000/3001 已重启。

# 2026-08-28 挑战杯总规落地：平台基础设施与 SQLite→PostgreSQL 迁移（8/28-29 日程提前完成）

- 按 sol 的第一份计划产出唯一技术总规 `docs/挑战杯技术开发总规.md`：现状审计（D1-D7 缺陷含 selectedAgentIds 假交互、difficulty 0.42 硬编码、进程内 Run 无持久化）、目标架构、API 契约、九组领域表、BKT/难度校准/苏格拉底/混合检索算法、迁移流程、任务顺序与量化验收。
- 新增 docker-compose.yml（pgvector/pg16 + redis7，api/worker 为 full profile）+ Dockerfile + deploy/db/init 扩展脚本；用户已将 Docker Desktop 安装至 D:\ZPan\docker（数据盘随之在 D 盘）。
- 本机原生 PostgreSQL 占用 5432 导致连接串认错服务，容器端口改映射 15432/16379 并写入 .env；PostgreSQL + Redis 容器 healthy 运行。
- drizzle：server/db/schema.ts 落地九组领域表（含 document_chunks 1024 维 vector + GIN 全文 + HNSW 索引、study_runs/study_run_nodes/run_events、claims/debate_issues/audit_decisions、evaluation_cases/results）；drizzle-kit migrate 在本机静默退出，改用编程式 migrator（scripts/db-migrate.ts）。
- 新增幂等迁移程序 scripts/migrate-sqlite-to-pg.ts：源库只读、指纹幂等跳过、分批 COPY（5000 行/批）、表级行数校验、Metro 时间边界校验、源 CSV SHA256（缺失时如实标注数据准备状态）、迁移报告 JSON、--dry-run/--force/--cutover。
- 真实迁移完成：26 表全部校验通过，metro_readings 1,516,948 行（47 秒），时间边界源目标一致；幂等重跑 26 表全部跳过；claims.learner_id 由 learning_assets 回填成功。
- 新增 server/runs 协议与动态 DAG 编排器：StudyRunRequest/StudyRunPlan/RunEvent/SSE 帧格式；planStudyRun 纯函数（auto 全链路 + 风险信号从严；custom 模式 selectedAgentIds 真实裁剪业务节点、业务角色 ≥3 且资源生成不可取消、四个门禁节点不可移除）；validatePlan 校验依赖闭合/无环/门禁齐全；6 个单元测试。
- isLearningResourceType 收口到 src/learning/types.ts 作为唯一定义；tsconfig typecheck 范围扩至 server/db、server/runs、scripts（server/index.ts 存量严格模式错误不在本轮范围）。
- 验证：类型检查 0 错误、101 测试全过、tsup 与 Next 构建通过；3001/3000 服务已重启正常；迁移后运行数据源仍为 SQLite，`--cutover` 待人工确认执行。

# 2026-08-28 产品边界与旧包袱收口完成

- 前端入口从 3745 行旧通用工作台收敛为精简产品壳，只保留登录、路径、协同学习和资源学习；移除不可达代码与 `@ts-nocheck`。
- 服务端移除旧 `/api/sessions/*`、通用聊天/澄清、WebSocket、会话文件存储及对应测试；通用多智能体模块继续作为内部库保留，不再暴露未鉴权产品入口。
- `/api/learning/*` 与 `/api/settings/*` 统一要求 Cookie 登录；证据列表按 learnerId 经 EvidencePack 关系过滤，并新增隔离测试。
- pnpm workspace 正式纳入根项目与 `web`，删除两份 npm lockfile；补齐 `tsx`、esbuild 与 sharp 的 pnpm 构建声明。
- 增加 `pnpm data:metropt`：从 UCI 官方源下载并校验 MetroPT-3，仅解出被 Git 忽略的 CSV；后端发现 CSV 后自动导入 SQLite。没有完整数据时保留 AI4I 与 MetroPT-3 文档证据运行能力。
- 验证：根/前端 TypeScript 检查通过，95 个测试通过，后端 tsup 与前端 Next 生产构建通过；3000/3001 服务已重启。匿名访问学习/设置接口返回 401，旧 sessions 接口返回 404。

- 已完成：项目文件初步盘点；确认前端入口、工作流、编排、记忆、会话存储和测试目录。
- 已完成：阅读项目说明、`CLAUDE.md`、前端入口、服务端路由、会话存储、深度规划、Agent 集群、评估器、记忆和工具层。
- 已完成：确认当前系统的真实能力边界与学习产品缺口。
- 已完成：整理最小学习闭环、页面职责和后续开发顺序。
- 已完成：核对用户提供的六大资源架构；确认其中 SQLite、EvidencePack、Claim 审计等属于目标设计，当前代码尚未完整落地。
- 已完成：检查数据包样本；确定 MetroPT-3 作为首个主数据源，AI4I 作为可解释基准，用户上传资料默认只做临时参考。
- 已完成：收敛 RAG 分层：CSV/时间窗口走 DuckDB，文档走全文/向量检索，统一输出 EvidencePack，再驱动资源生成和审计。
- 已完成：当前实现使用 SQLite 持久化学习资产、学习事件、路径节点和画像快照；MetroPT-3 通过 SQLite 精确查询，文档通过 FTS5 检索。
- 已完成：学习任务会调用模型生成路径并替换右侧“路径”数据，同时保存讲义、分层练习和知识图谱三类资产。
- 已完成：输入框保留临时参考文件与协同方式；模型与 low / medium / high / max 思考深度由设置中的系统默认和角色覆盖统一控制。
- 已完成：左侧智能体卡片和中间过程消息支持展开，展示任务、状态和工具调用记录。
- 已完成：画像支持 SQLite 快照、关键词、雷达指标，以及学习时间、资产数、今日资产数、正确率等代码统计指标。
- 验证：后端类型检查、tsup 打包、前端 Next 生产构建、93 个自动化测试均通过；本地服务保持运行在 3000 / 3001。
- 已完成：三栏增加左右拖动分隔线，左侧协同栏可收起到屏幕边缘，右栏横向溢出已隐藏。
- 已完成：RAG 统一输出 EvidencePack；CSV 走 SQLite 精确查询，MetroPT-3 PDF 走 FTS5 文档检索，并保留数据集、字段和页码定位。
- 已完成：交叉验证位于“检索 → 生成 → Claim 审核 → 保存资产”之间；同时检查双来源、定位完整、声明覆盖和数字一致性，未通过的资源不标记为已审核资产。
- 已完成：用户上传资料只作为当前会话临时参考，记录文件名、大小和哈希审计信息，不写入系统知识库、不保存原文；证据右栏展示来源、方法、可信度和定位。
- 已完成：模型服务支持多服务入口、模型自定义名称、low / medium / high / max 思考深度；系统默认执行模型与深度可核验，输入框不再重复设置。
- 已完成：按模式职责配置选择学习 Agent，包含交叉验证与合规审计角色，不再从通用 Agent 数组按顺序截取。
- 已完成：设置弹窗顶部切换四页：模型服务、协同编排、学习资产、本地数据。协同编排固定六个职责角色，逐角色可继承明确的系统默认模型/深度或指定覆盖；检索职责覆盖 CSV 查询与 PDF 检索，审核与隐私角色为发布前固定关卡。
- 已完成：交叉验证与 Claim 审核固定为发布前关卡，未通过的资源不入库；学习资产页真实控制任务后自动生成讲义、分层习题、知识图谱三类产物；本地数据页展示并可清除不含原文的临时资料审计记录。
- 已完成：右栏固定为计划、流程、任务、结果、路径、画像、资产、证据八个入口；协同方式移至输入框控制，避免与系统执行模型重复。
- 验证：后端类型检查、tsup 打包、前端生产构建、93 个自动化测试、API EvidencePack 检索与资源 Claim 审核均通过；服务继续运行在 3000 / 3001。
- 已完成：从产品经理视角收敛首期垂直场景、用户旅程、动态 Agent DAG、资源渲染与 SQLite/JSON/文本数据分层；后续实现以首次诊断、当前行动、作答事件和路径动态调整为主线。
- 已完成：真实账号注册、登录会话和首次画像建档；建档后由路径规划智能体生成第一棵可分叉知识路径，节点与边、用户“学完/掌握”状态均持久化至本地 SQLite。
- 已完成路径页第一版重构：当前页明确为路径页，左侧是路径调整对话，右侧上方按真实边关系绘制知识树、下方展示选中节点详情；节点点击带入对话，学完/掌握/新增前置或分支均进入真实交互链路。
- 已确认学习页下一版职责：三栏分别是总控 Agent 与动态子 Agent、协同对话与资源生成过程、与路径页共用的当前学习路径；资源正文不在学习页展开，统一转入资源页。
- 已完成学习页第一版：三栏可调宽度；总控 Agent 和按任务生成的子 Agent 可展开查看任务、工具和结果摘要；中栏通过显式 `@` 引用路径节点，选择六类资源后走真实检索、资源生成、Claim 审核、交叉验证和隐私关卡；已审核资源持久化后可导出 MD、TXT、JSON。
# 2026-08-27 资源页实施中

- 已确认资源页的数据缺口：分页笔记、习题尝试与掌握等级需要新增 SQLite 实体和受账户隔离的接口。
- 正在实现讲义阅读与习题作答两个子界面；其它四类资源先使用同一资产目录入口，避免先做无法使用的展示页。

# 2026-08-27 资源页第一版完成

- 资源页已作为第三个主页面接入：左侧可收起的资源类型/目录，中间阅读或作答区，右侧随当前讲义页或当前题变化的笔记/解析区。
- 讲义支持章节跳转、前后翻页、页级笔记、三档掌握反馈、MD 导出和资产删除。
- 习题支持题号跳转、后端判分、答案解析、逐次尝试历史与实际耗时记录；判分会更新知识点的练习次数、正确次数、掌握度和置信度。
- SQLite 已新增 `learning_asset_page_notes` 与 `learning_quiz_attempts`，既有旧习题在读取时会兼容为可交互的选择题格式。

# 2026-08-28 路径节点建议闭环完成

- 修复闭环断点：学习资产的知识点 ID 不再硬编码为 compressor-diagnosis-evidence，学习页按节点生成的资源会绑定当前路径节点的 knowledgePointId，作答数据因此能落到对应节点的技能状态上。
- 路径节点新增证据驱动的 recommendation：确定性规则从 learner_skill_states（作答次数、正确率、掌握度）与讲义掌握反馈推导“建议补强 / 保持节奏 / 可进阶 / 暂无记录”，理由携带真实数字；节点用户状态仍只由用户手动标记，符合既定设计。
- 路径页与学习页的知识树节点显示建议标记点，节点详情展示建议徽标与理由，路径页图例同步更新。
- 验证：后端类型检查、99 个测试（新增 computeNodeRecommendation 6 个用例）、前端生产构建通过；API 冒烟验证“注册→建档→挂节点生成习题→6 次作答→节点建议升级为可进阶、未学节点保持暂无记录”全链路，冒烟账号与数据已清理。

# 2026-08-28 数据层范式与讲义升级完成

- 数据层做成可替换范式：data/knowledge/*.md 丢弃式知识卡自动入库（首批 14 张：Python/pandas/清洗/时序/统计/可视化/AI4I 字段与故障机理/证据边界/阈值法）；tabular.ts 提供 importCsvDataset（SHA256 校验和，文件变更自动重导入）+ dataset_rows 通用表格层 + 按标签抽代表性样本。
- AI4I 2020（1 万行、6 个故障标签字段）作为入门教学数据集接入 data/datasets/ai4i/；MetroPT-3 仍是时序主数据，两者共存于同一证据层。
- 修复存量检索 bug：FTS 虚表查询引用了不存在的 source_id 列导致一直在走 LIKE 兜底，旧卡永久挤占检索名额；现回联原表并按 bm25 相关度排序。
- 讲义模板升级：新增 code 块（pandas 代码示例）与 table 块（代表性数据摘录，主标签列在前、带可回溯定位，按主题关键词自动选数据集）；资源页渲染器与 MD 导出同步支持；audit 对 code/table 免 Claim 审核。
- 根治前端构建对 Google Fonts 的网络依赖（改为系统字体栈），离线可构建。
- 验证：类型检查 0 错误、99 测试全过、前端生产构建通过；冒烟验证 Python 主题讲义（此前必被门禁拒发）现在通过审核入库，含 AI4I 故障样本摘录表；压缩机主题仍走 MetroPT-3 时序摘录。冒烟账号已清理。
- findings.md 精简为决策记录，写入三组差异化测试账号方案与 10 分钟视频分镜脚本。

# 2026-08-28 学习页真实多智能体群聊协同完成

- 承认并替换了旧的假协同：study/chat 原来一次请求内用固定文案冒充智能体活动、资源纯模板生成、没有任何模型调用。
- 新协同 Run：总控编排 → 双检索实例真实并行（SQLite 结构化 + FTS 文档）→ 学情与路径智能体（LLM 读真实画像/技能状态，失败回退确定性文案）→ 领域诊断（LLM，引用证据）→ 资源生成（讲义/实操走 LLM 正文 + buildLlmResourceDocument 组装章节/代码/数据摘录/证据块）→ 逐条 Claim 审核 → 隐私合规 → 总控收尾。每个智能体的发言真实写入聊天记录，前端 1.2 秒轮询逐条冒泡呈现。
- 新增审核回退环：第一轮门禁未过（数字无法核对）→ 审核打回 → 生成端按 failedClaims 修订 → 复审；修订后仍不过用内置模板兜底，保证有证据时演示必出资产。冒烟已验证“第一轮打回 → 修订 → 复审 23/23 全支持”真实发生。
- 同类智能体多实例落地：知识检索 Agent · 结构化 / · 文档两个实例各自汇报命中与定位。
- 学习页三栏重定义：左栏=任务上下文（当前节点+建议徽标+学情快照+本次任务配置）；中栏=协同群聊（用户右侧深色气泡，智能体带角色头像逐条冒泡，进行中指示器，历史完整回放）；右栏=路径树+节点详情（不变）。
- 资源页讲义分页升级：标题块开启新页并跟随正文，代码/表格/证据/习题独立成页；标题块获得渲染样式。
- 验证：根类型检查 0 错、99 测试全过、Next 构建通过；端到端冒烟两次（一次触发修订环 70 秒、一次一轮通过 67 秒），资产含 LLM 章节 + Python 代码块 + AI4I 数据摘录表。冒烟账号已清理。

# 2026-08-28 设置统一入口与内容重构

- 设置入口统一为三个页面顶栏最左侧的「设置」按钮（路径/学习/资源），点击弹出设置窗口；路径页左下角的旧入口移除。
- 设置弹窗抽为共享组件 settings-dialog.tsx，四页签：模型服务（Provider 管理 + 默认执行模型/思考深度）、协同编排（六角色逐角色模型/深度路由，标注检索双实例与审核/隐私固定关卡）、学习资产（自动生成类型开关）、数据与隐私（真实接通隐私审计记录查询/清除 + 固定边界声明，原来只是静态文案）。
- 设计原则：设置只放真实改变系统行为的运行时配置；审核与隐私门禁明确标为不可关闭的固定项，不做假开关。

# 2026-08-28 资源页悬浮类型导航

- 按用户设计收敛资源页左侧交互：移除“点按钮滑出资产目录面板”方案，改为鼠标贴到屏幕最左缘自动浮现的类型导航（六类资源 + 各自数量，选中后自动收回）。
- 资产目录不再占用侧边栏：阅读区顶部新增资产选择条（类型徽标 + 同类型资产下拉 + 删除按钮），阅读器自身的章节/导出控件保持不变。

# 2026-08-28 阅读反馈接入补强闭环

- 资源页反馈区不再止步于三档掌握反馈：新增“按这份讲义/资源的薄弱点生成练习”按钮，一键携带资源标题、掌握反馈与知识点跳转到学习页。
- 学习页消费预填任务：自动填入任务草稿、切换资源类型为分层习题、按知识点自动关联路径节点，用户确认后即可发起针对性协同。
- 闭环补全：讲义反馈 → 针对性练习 → 后端判分 → 技能状态 → 路径节点建议，反馈从死胡同变成学习循环的入口。

# 2026-08-28 知识库大规模充实：官方文档抓取管线 + 切块 + 向量回填

- 针对知识库过薄的问题（此前仅 ~37 条手写切片）建立可重复的抓取管线 `scripts/ingest-docs.ts`（pnpm docs:ingest）：抓取权威公开文档 → 主内容抽取（node-html-parser 多选择器 + 去 script/侧栏/¶锚点）→ Markdown 化（node-html-markdown）→ 围栏感知逐行清洗（去图片/链接语法/导航句）→ frontmatter 卡片落盘 data/knowledge/。
- 数据来源 15 个全部入库：pandas 用户指南 6 篇（10min/索引/分组/缺失数据/时间序列/滑动窗口）、matplotlib 3 篇（pyplot/快速上手/直方图）、Python 官方教程 3 篇（控制流/数据结构/异常）、scikit-learn 离群检测（含孤立森林）、UCI API 2 个数据集（AI4I-2020、MetroPT-3：绕开页面对直接抓取的 403，改用官方 JSON API 拿结构化元数据——简介/字段表/引用论文；MetroPT-3 正确 ID 是 791）。
- 知识导入器升级（src/learning/knowledge-import.ts）：1 卡 = 1 切片改为按 `##` 章节切块（≤1200 字符装箱、代码围栏不从中截断、<160 字符碎片并入前片、切片标题携带章节锚点），幂等整体重导。
- TERM_ALIASES 新增 20+ 中文→英文检索别名（直方图/箱线图/滑动窗口/缺失值/分组/重采样/孤立森林/索引等），FTS 'simple' 分词器无法切中文的问题由别名桥接。
- `scripts/embed-documents.ts`（pnpm docs:embed）：SQLite 受管切片全量同步 PG document_chunks（含 search_text），DashScope text-embedding-v4 1024 维向量回填，按 sha256(正文) 做缓存（data/embeddings-cache.json，已 gitignore）避免重复计费。
- 结果：SQLite document_chunks 616 条（knowledge-cards 593 + metropt-3 目录 23）；PG 全量同步且 616/616 带向量。中文语义检索冒烟（"缺失值/直方图/滑动窗口/孤立森林"）余弦命中对应官方文档章节 0.63-0.78；FTS+别名路径同样全中。
- 验证：pnpm evaluate 难度匹配 100%、覆盖 100%（现在建立在真实语料上）；typecheck 0 错、115 测试全过；服务与 worker 已重启加载新语料。

# 2026-08-28 浏览器实测三演示账号 + 演示链路打磨

- 用浏览器内测工具全程 UI 实测：登录 → 建档 → 路径 → 学习页，三个演示账号全部通过。
- 修复一：demo:seed 对已存在账号原来只复用不更新密码，换环境后旧密码失效；新增 IdentityStore.resetPassword，种子时把密码幂等同步为当前 IM_TRAINING_AGENT_DEMO_PASSWORD。
- 修复二（演示主缺陷）：saveOnboarding 会把建档标志置 1，而种子不生成路径 → 账号登录后是"已建档但无路径"的死胡同。把首次路径生成逻辑（generateInitialPathGraph/fallbackPathGraph/normalizePathGraph）从 server/index.ts 抽为 server/initial-path.ts 共享模块，demo:seed 现在以 90 秒预算为每个账号预生成 LLM 个性化路径（超时回退内置 15 节点树）。
- 实测差异化（LLM 定制路径，非回退树）：foundation 13 节点从"Python 变量入门"起步；advanced 12 节点直上 FFT/tsfresh/孤立森林/LSTM 自编码器/多算法比较；maintenance 14 节点走 SQL 日志/诊断决策树/结构化报告模板。
- 浏览器实测注册流：注册 → 建档向导 → 工作台 15 节点路径，全链路通（建档端点 12 秒预算内 LLM 不及则回退内置树，现场演示即时可用；已留 live-demo 账号作为新用户全流程演示）。
- 环境注意：.env 中含 # 的值必须加引号（dotenv 把 # 当行内注释），演示密码已改为带引号的 Zbt2026-Demo-Learner。
- 验证：typecheck 0 错、115 测试全过、服务/worker 重启后登录正常。

# 2026-08-28 深度审计：旧平铺路径系统全套退役

- 审计结论：quiz 判分 BKT 链路、检索 FTS→LIKE 回退、难度校准（0.5 兜底 + calibration 覆盖）、web 组件引用、npm 依赖全部核验无误；真正的旧包袱是**旧版同步生成管线**（前端零调用）。
- 删除三个死端点：GET /api/learning/path（旧平铺路径）、POST /api/learning/context/sync（旧同步全量生成，绕过 DAG）、POST /api/learning/resources/generate（单资源旁路，绕过难度校准）。
- 删除孤儿代码：generateLearningPath/fallbackPath/normalizePathItems/GeneratedPathItem、LearningStore 的 ensureInitialPath/replacePath/getPath、LearningPathItemView 类型、resource-builder 孤儿 import。
- 数据层退役：SQLite 停建 learning_path_items 并在初始化时 DROP 遗留表；PG schema 移除 learningPathItems，新增迁移 0002_drop_legacy_path_items（DROP TABLE IF EXISTS）并已应用；sqlite→pg 迁移脚本同步移除该表映射。
- 保留项说明：socraticPriority（苏格拉底多轮功能原语，有测试）；AUTO_ASSET_TYPES（设置页在用）。
- 回归：typecheck 0 错、115 测试全过；重启后已删端点 404（无 cookie 时被登录中间件 401 先拦属预期）、path-graph/profile 正常、浏览器抽查路径页 15 节点正常渲染。
