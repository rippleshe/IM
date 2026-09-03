[ERROR] - (starship::print): Under a 'dumb' terminal (TERM=dumb).

# 2026-09-03：11 条产品反馈闭环（完成）

# 2026-09-03：学习状态、PPT 说明与资源阅读器反馈收口（完成）

- 修正学习页切换工作台后的状态恢复：服务端活动运行继续轮询，未完成节点不再被默认映射为成功，终态提示仅在实际终态运行存在时显示。
- 删除资源阅读器的通用阅读提示、选区引用卡和教师式 PPT 说明；学习者仍可在右栏直接写笔记并保存。
- PPT 议程页不再渲染章节串底注，流程页和练习页不再渲染泛化动作尾注；旧资源中的泛化“本页聚焦 / 学习者复述”说明会被清理，并由页面类型对应的说明兜底。
- 美化资源数据表与“误区 / 正确理解”内容，PPT 放映切换到沉浸式全屏布局，并将资源生成提示词收紧为“新增信息—前后关系—依据—判断边界”，不再要求每页硬塞动作。
- 学习进度恢复服务端 `skipped` 状态为“未适用”，完成计数包含已跳过的非适用步骤，发布未通过或无隐私资料时不会显示假待处理节点。
- `pnpm typecheck`、`pnpm --dir web build`、`git diff --check` 和界面规则扫描通过；浏览器确认资源页无旧提示、PPT 可进入并退出放映，未新增测试逻辑。

- 模型连接探测的等待窗口从 20 秒调整为 45 秒；确认同一配置约 25 秒后成功，问题属于上游响应偏慢叠加本地等待过短，不是页面 API Key 缺失。
- 学习页改为读取服务端活动运行，切换工作台不再把未完成任务渲染成绿色或“已结束”；返回页面会继续读取当前运行节点。
- 路径对话加入时间顺序与最新输出跟随，可拖拽调整对话栏宽度；填空 / 简答提交后可再次作答。
- PPT 增加放映模式，讲解词改为用户可读的“本页说明”；PPT 与知识脉络右栏均提供笔记编辑与保存。
- `pnpm typecheck`、`pnpm --dir web build`、`git diff --check` 通过；浏览器已确认路径分栏、PPT 放映、知识脉络笔记和习题二次作答，未新增测试逻辑。

# 2026-09-03：失败资源交付语义与阅读密度收口（完成）

- 资源库与资源读取接口只返回通过发布门禁的成品；失败草稿不再进入学习者的资源、阅读、笔记、反馈和导出路径。
- 学习工作台把旧历史文案和新任务结果统一成“暂未交付 / 系统已收起”，验证工作台只作为系统处理追踪，不把复核动作交给用户。
- 资源页顶部元数据一行化，移除警告横幅、日期、笔记数量和反馈提示；浏览器真实检查确认基础账号 26 份资源、无旧警告文案，控制台无错误。
- 仅执行 `pnpm typecheck`、`pnpm --dir web build` 与 `git diff --check`；未添加或运行测试套件。

# 2026-09-03：资源阅读区去头部（完成）

- 按浏览器反馈移除资源阅读区整块标题、类型、难度、知识点与标签编辑面板，避免重复左侧资源目录信息。
- 清理对应组件、标签保存逻辑与 CSS，保留章节目录、导出和正文阅读功能；浏览器确认正文直接前移，资源目录仍有 26 份资源。

# 2026-09-03：挑战杯产品化界面与启动收口

- 已先将改动前基线 `2791a9a` 推送到 `origin/main`；保留工作区原有的技术开发总规删除状态，不混入本轮。
- 已完整读取挑战杯原文、技术开发总规、作品介绍、设计实现方案和部署说明；本轮围绕作品完整性、协同可视化、资源可读性与用户体验打磨，不改动真实业务闭环。
- 已完成 PostgreSQL / Redis 迁移与数据引导；AI4I 10000 行、知识卡 593 个切片可用，三组演示画像幂等种子完成；API :3001、worker 和 Web :3000 已启动。
- 前端新增统一工作台头部与产品识别，补足路径空状态快捷目标，验证页拓宽桌面布局；移动端路径、学习、资源改成单列滚动，修复固定侧栏把主内容压窄的问题。
- `pnpm typecheck`、`pnpm --dir web build` 通过；界面规则扫描的彩色状态文字对比度提示已收紧；浏览器真实页面导航、路径快捷入口和移动端布局检查通过，控制台无错误；未新增或运行测试逻辑。

# 2026-09-03：三组挑战杯演示账号真实流程核对

- 三组账号均已在运行中的本地产品登录成功：基础学习者资源库 26 份，进阶学习者 12 份，在职运维 6 份；三组均保留差异化 15 节学习路径。
- 逐组核对了路径、学习、资源、验证工作台，确认账号隔离、资源目录与验证记录都能从当前 PostgreSQL 状态读取。
- 在职运维账号通过学习工作台真实发起一份“现场晨会三步诊断”PPT，完整经历画像、检索、生成、审查和三轮返修；最终未发布，成品草稿与验证依据只保留在系统追踪中，没有伪装成已通过资源。
- 侧边栏浏览器已打开本地工作台，当前服务仍为 Web `:3000`、API `:3001`、worker、PostgreSQL 和 Redis；本轮没有新增开发测试逻辑。

# 2026-09-02：重启后继续收口资源生成质量

- 关机后已恢复前端、后端和 worker；3000、3001 端口正常，前端页面留在资源阅读区。
- 修复代表性数据表与兜底代码的数据集串台：当前查询命中的结构化行优先，来源按 `sourceId` 聚合；通用工具词不再误选 AI4I。新增混合数据集回归测试，确认空压机任务不出现 `Machine failure` 表头。
- 强化零基础教学契约：统一要求白话术语表、生活化问题、最小跟做动作、即时检查、迁移提示；教学例子中的日期、数值、比例和行数也不得凭空编造。
- 浏览器真实回归：最新 MetroPT-3 PPT 通过 3 轮审核后入库，内容页共 12 页；第 2 页先解释时间戳/缺失值/重复值，末页提供找空值练习。习题已完成真实提交与自评；讲义、知识脉络的严格门禁会把无依据内容保留为待复核，不冒充已通过资源。
- 完成 `pnpm test`（26 文件 / 203 用例）、`pnpm typecheck`、`pnpm lint`、`pnpm --dir web lint`、`pnpm --dir web build`，并同步更新技术总规与提交包中的测试基线。

# 阅读进度

> 说明：本文保留历史实现记录；当前运行时已收敛为 PostgreSQL 16 + pgvector，历史条目中的本地文件数据库描述不代表现行架构。

## 2026-09-02 文档单一维护源收口（完成）

- 深度核对 README、`docs/`、提交包和代码引用：保留 `docs/挑战杯技术开发总规.md` 作为唯一技术基线，移除已完成阶段性的可信协同升级计划。
- 技术基线改为当前事实，不再保留旧日期排期、六类资源和 95/115 项测试口径；明确四类资源、四个工作台、当前边界与提交前验收方法。
- README 增加文档职责边界；提交包的作品介绍、设计实现方案、单元测试说明、评测方案与结果报告、系统部署说明和提交说明同步到 26 个测试文件 / 203 项用例与 2026-09-02 状态。
- 清理源码注释和内部记录中的失效规划引用；升级计划进入回收站，其他用户已有删除状态未处理。
- 回归通过：`pnpm test -- --run`（26 文件 / 203 项）、`pnpm typecheck`、`pnpm lint`、`pnpm --dir web lint`、`pnpm --dir web build`；未发生网络下载或 live 模型调用。

## 2026-09-01 Ponytail 可信性能收口（完成）

- 以真实运行记录审计性能：已发布运行平均约 69 秒；拒绝发布的运行平均约 484 秒，主要时间用于最多三轮的生成、审核、质询与裁决返修链；队列没有积压。未通过时不再把问题误称为“未入库故障”。
- 修复运行事件并发序号竞争：`appendRunEvent` 改为同一 PostgreSQL 事务内“先 advisory lock、再取最大 seq、再插入”。24 路并发受控验证得到连续且唯一的 1–24 序号，避免根节点并行启动时偶发重复事件序号和后续任务失败。
- 验证页直接呈现已有运行记录中的“等待执行、实际处理、单步骤耗时”，不新增埋点、队列或数据表；用户可据此判断慢点，而不是把模型生成、排队和规则检查混为一谈。
- 修正 Claim 门禁误判：教学假设、可由精确行数推出的数量下界、字段类型操作不再被当成无依据事实；真正字段含义断言与未经证据支持的数值/因果仍保持 fail-closed。
- 产品与提交文档统一为“智能体自动审核”：修订预算用尽后自动拒绝发布、保留追溯记录、由后续智能体补充核验；普通学习者不承担资料审核职责。内部历史兼容状态名不再作为用户文案。
- 文档测试基线同步为 26 个测试文件 / 194 个用例；已完成 `pnpm test`、`pnpm typecheck`、`pnpm lint`、前端生产构建和差异检查。

## 2026-09-01 挑战杯针对性技术深审（进行中）

- 已修复路径助手的伪流式根因：后端改为消费真实模型流，界面只收到公开答复增量；完整结构化结果校验成功后才允许更新学习路径。模型本身不支持流时仅一次性呈现真实调用结果，不再模拟逐字输出。
- 已把正式评测报告与提交包副本从“六类资源”改为四类真实交付口径；两份文件 SHA-256 一致。实操指南与挑战任务作为下一轮独立资产能力，不再提前计入评测。
- 已将 A2/A3 改为固定真实运行队列：三画像导出包经 SHA-256、运行标识与离线回放校验后参与统计，初稿 25.0% → 终稿 0%，难度校准 33/33 入区间；日常使用不再改写比赛数字。
- 后续三项硬升级：六类可验收资源资产、知识库嵌入/许可证运维闭环、可取消模型调用与按指标配置并发。
- 回归：根 TypeScript、191 项单测、lint、前端生产构建均通过；`git diff --check` 无内容错误。

## 2026-09-01 挑战杯材料复核（完成）

- 重新执行 `pnpm evaluate`：60 个离线案例全部通过，难度适配与知识覆盖均为 100%；离线模式没有模型声明，幻觉率明确记录为 N/A。
- 重新执行 `pnpm ablation`：动态编排分化 3 种学习计划（固定仅 1 种）；20 次已发布运行的初稿幻觉率 6.9% → 终稿 0、5 次触发修订；难度校准 34/34 在目标区间，固定 0.42 为 2/34。
- 《评测方案与结果报告》已同步当前聚合数字，并把单个三轮演示案例与聚合统计分开说明；自动生成的评测/消融 JSON 已加入忽略规则，避免污染提交材料。
- 提交包内的作品介绍、设计实现方案、单元测试说明、评测报告与部署说明已逐份同步并核对 SHA-256 一致；新增《提交说明》明确视频必须是待录制的真实系统画面，防止脚本被误当成提交成品。

## 2026-08-31：知识库与网络资料沉淀成熟化启动

- 已读取根目录《知识库升级方案》，确认不新建 GraphRAG、独立向量数据库或外部付费检索服务；继续以 PostgreSQL 16、pgvector、RRF 与可选本地 reranker 为主线。
- 已安全清点并接入 `资数据收集料.zip`：19 个文件（11 PDF、8 Markdown），无路径穿越条目；全部已进入受管候选区，未写入正式知识库。
- 已应用 `0012_knowledge_source_governance`：新增受管来源、不可变版本和导入任务账本，并为既有 `document_chunks` 补充版本、章节、页码、类型、顺序、哈希与启用字段（既有资料保持兼容）。
- 首次导入任务 `archive-12167e264ee48604db2c1877` 已完成：19/19 资料解析成功，PDF 使用本地 `pdftotext`，Markdown 保留原始文本；原件以 SHA-256 保存于本地受管目录，许可证均暂标为待核，审核前不可参与正式检索。
- 已验证重复导入同一压缩包产生 `newCandidateVersions: 0`；数据库保持 19 个来源、19 个候选版本、0 个由候选资料生成的正式切片。混合检索已补上“旧资料兼容 / 新资料必须审核通过且版本启用”的范围门禁。
- README 已加入资料候选库的实际运行命令、目录边界与重复导入口径。
- 已清理根目录重复 ZIP；`data/knowledge/imports/12167e264ee48604db2c18778a277909653f18fdf1784f99ee55411284a0dd49.zip` 为哈希核验一致的唯一受管资料包副本。
- 已建立目标数据流规格 `knowledge-upgrade-dataflow.json`，用于约束资料包、既有数据和 SearXNG 候选在“受管来源、质量门禁、版本、证据图、混合检索”之间的边界。
- 已完成第二阶段收敛：设置页移除资料库管理员面板，普通学习者不再承担候选资料审核职责；审核与晋升统一由服务端 `knowledge-curator` 负责。
- 用户上传资料默认只作为当前任务临时参考；只有用户明确勾选同意，且智能策展通过相关性、质量、重复风险与隐私门禁，才会写入受管来源并生成可追溯正式切片；失败或模型不可用时正文不沉淀。
- 现有 19 份真实资料仍全部保持候选状态，后续由内部策展任务按同一门禁处理，不进入普通用户设置页。
- 隐私审计接口已按当前登录学习者隔离，清除操作只删除自己的审计记录；运行失败、取消或完成后都会清理运行请求中的上传正文。
- 已完成 SearXNG 结果的受限候选登记：每次最多三个规范化 URL，保存标题、短摘要、哈希和来源元数据；候选不写入 `document_chunks`，且登记失败不影响当前 EvidencePack。
- 仅有搜索摘要的候选会被 `pnpm knowledge:curate` 明确保留为候选，等待正文抓取和许可证确认；下一步再接入安全正文抓取与可选的本地 reranker。

## 2026-08-31 仓库清理与提交材料归档（完成）

- 根目录报名表与提交包内 `参赛报名表.pdf` SHA-256 一致，保留提交包归档副本，移除根目录重复 PDF。
- 移除 `server*.log`、`web*.log`、`worker.log` 等过期运行日志；未触碰 `.im-training-agent/`、`data/`、`dist/`、`node_modules/` 等运行或构建目录。
- `docs/挑战杯技术开发总规.md` 作为当前代码唯一技术基线被项目文档和源码注释引用；阶段性升级计划完成使命后不再作为长期维护文档。提交材料文档同步到当前测试与评测口径，并记录报名表归档位置。

## 2026-08-31 SearXNG 可选 Web 补全检索（完成）

- 新增 `server/search/searxng.ts`：环境开关、低覆盖/时效资料/Claim 复核触发、JSON 结果规范化、超时降级和敏感检索词阻断。
- 网络结果仅以 `web_search` 低可信临时线索进入 EvidencePack，并在证据规则、运行事件、Claim 反证和资源提示词中明确“不能替代本地交叉验证”。
- 新增 Compose `search` profile、`deploy/searxng/settings.yml`、环境变量与状态接口；本机 SearXNG 已实测 JSON API 200、适配器成功规范化 3 条结果。
- 回归通过：`pnpm typecheck`、`pnpm test`（24 文件 / 185 项）、`pnpm lint`、`pnpm build`、前端生产构建、Compose 配置检查；API/worker/SearXNG 已重新启动。

## 2026-08-31 普通用户界面文案收敛（完成）

- 学习路径节点不再直接展示掌握概率、置信度和补强阈值，改为“建议补强 / 保持节奏 / 可进阶”等可执行建议。
- 学习页的处理步骤、助手名称、历史记录和错误提示统一为中文；“反方质询、证据裁决、DAG、revision”等内部术语只在验证记录中保留必要的审计语义。
- 设置页的思考档位、任务分工、隐私保护与服务操作改为用户语言；模型能力与上下文仍由服务端实时读取和约束，不在普通界面暴露内部字段。
- 回归通过：`pnpm typecheck`、`pnpm test`（22 文件 / 178 项）、`pnpm --dir web build`；前端 `:3000`、API `:3001` 均返回 200。

## 2026-08-31 资料采集清单精简（完成）

- 将给队员的资料任务收敛为“下载核心讲义/说明页 → 统一压缩包”，不再要求队员清洗、建表或处理数据库。
- 方法与培训资料全部保留；压缩机、车辆气压、轴承和液压只保留核心说明与小型资料。
- 明确暂不下载 MIMII、NASA 等 100 GB 级原始包，也不重复下载项目已有 MetroPT-3 CSV。
- 核对当前 PostgreSQL：数据库约 398 MB，`metro_readings` 约 355 MB，`document_chunks` 约 9.4 MB；原始文件不直接入库，只入库元数据、抽取文本、结构化样本和向量。

## 2026-08-31 SQLite 运行时退役（完成）

- 删除本地 SQLite 存储、证据检索、知识导入、表格导入、Metro 查询、迁移脚本、SQLite 类型声明及对应测试夹具；共享类型与规则已保留在无存储依赖的模块中。
- `server/study-context.ts`、设置接口、评测器、嵌入回填脚本和启动文档统一使用 PostgreSQL；移除数据源回退开关与 `migration_state` 遗留表。
- 清理 `.im-training-agent/` 下 6 个 SQLite 数据库文件；删除前核对 PostgreSQL：MetroPT-3 1,516,948 行、AI4I 10,000 行、知识切片 616 条、学习资产 41 条。
- 校验通过：22 个测试文件 / 178 项、typecheck、lint、后端构建、前端构建；API `:3001`、前端 `:3000`、PostgreSQL 与 Redis 已启动。

## 2026-08-30 模型能力自发现与教学质量重构（完成）

- 已复核服务商设置、模型注册、上下文打包、资源提示词、草稿解析和讲义组装链路。
- 已用当前服务商真实 `models` 接口验证：可发现 `mimo-v2.5`，但响应只含模型 ID/归属等身份信息，不含上下文窗口或最大输出。
- 已定位讲义质量的关键原因：生成载荷遗漏用户任务与路径节点；提示词的篇幅规范和 schema 相互冲突；解析与组装最多只保留 6 节；低质量草稿只有弱结构校验且不会自动返修；缺导语时展示系统流水线话术而不是学习导语。
- 已完成通用模型目录读取、常见能力字段解析、15 分钟缓存和安全预算兜底；设置页删除上下文/输出/服务 ID，改为“连接服务 → 读取模型 → 选择模型 → 保存验证”。
- 已将上下文打包与所有模型输出统一受当前模型能力约束；当前 OpenCode Go / `mimo-v2.5` 真实调用返回 `OK`，内部预算保持 100 万上下文、32768 输出，普通设置响应不再暴露这些字段。
- 已按角色、任务、输入、输出契约、证据纪律、质量自检统一核心提示词；资源生成补齐原始任务、路径节点、学情和难度校准，讲义支持 8 节、自然段拆分、学习目标和学习者导语。
- 已增加跨四种资源的可交付质量门槛，讲义重点检查节数、正文长度、节内展开、代码、记忆点、误区和自测；不达标自动完整返修一次。
- 回归通过：`pnpm lint`、`pnpm typecheck`、`pnpm test`（22 文件 / 178 项）、`pnpm build`、`pnpm --dir web build`；前后端已按 PostgreSQL 主线启动于 3000/3001，页面与 API 均返回 200/成功。

## 2026-08-30 提交材料按用户要求收敛：12 份 → 7 份

- 对照赛题「作品提交形式」重新梳理必要集：材料文档（设计实现方案/作品介绍/视频）、软件模块（源代码/部署说明/单元测试用例）、测试数据（知识库切片 + 三画像数据包）。
- 删除 6 份非必要文档（多智能体可信协同协议 / 幻觉治理与知识溯源说明 / 数据合规与隐私说明 / 领域迁移指南 / 用户使用手册 / 答辩问答准备），其内容压缩并入《作品设计实现方案》对应章节；《提交检查清单》并入 submission/README.md。
- 重命名：部署与故障排查说明 → 部署说明；演示视频脚本与分镜 → 演示视频脚本。
- 新增：单元测试说明.md（对应赛题"单元测试用例"要求，指向仓库内 23 文件/163 用例）、README.md（提交物 ↔ 仓库对应物映射 + 项目迭代后需刷新的提交物清单 + 精简核对）。
- 升级计划文档中里程碑 H 的文档清单同步更新为 7 份；无孤儿引用。
- 最终状态：typecheck 0 错、22 文件 / 163 测试全过。

## 2026-08-29 里程碑 H 完成：比赛材料与提交包（+ 全计划收尾）

- 历史重复提交文档已于 2026-09-01 清理；比赛材料现在只维护在根目录提交包，避免源码文档与归档副本漂移。
- 三画像提交数据包重新生成（新协议口径）：foundation / advanced / maintenance 各一次真实运行并导出 `data/exports/{persona}-run-export.json`（374KB / 365KB / 455KB）；三包全部通过 `pnpm verify:export` 八项完整性校验（产物散列、DAG 闭合、事件 seq、inputRefs、Claim—Evidence、裁决只紧不松、发布 fail-closed、敏感字段）+ manifest 在线对照一致。
- 最硬的门禁增益证据：maintenance 包离线回放 `pnpm replay:run` —— 初稿幻觉率 25.0% → 终稿 0.0%（门禁净增益 25 个百分点），三轮回放与在线裁决完全一致；foundation/advanced 各含 1 次修订后放行。
- 新增运行列表端点 GET /api/learning/runs（验证页运行选择区，learner 隔离）。
- 最终回归：typecheck 0 错误、23 文件 / 163 测试全过、web tsc + 生产构建通过；api(3001)/worker/web(3000) 运行中。
- 完成定义（升级计划 §8.4）对照：11 项中 10 项达成；第 7/8 项中的"60 案例全量 live"按计划自身约束需用户授权调用量后执行 `pnpm evaluate --live`（报告口径已支持分层 + 如实标注），当前以"离线全量 + 分层 live + 存量运行 + 离线回放"四层证据如实呈现。
- 全程流量约束遵守：未下载任何依赖/数据/模型；live 模型调用仅限产品正常运行的协同生成（3 画像数据包 + 冒烟验证），`IM_TRAINING_AGENT_ALLOW_LIVE_EVAL` 评测开关保持 false。

## 2026-08-29 里程碑 G 完成：前端验证页与三工作台轻量增强

- 新增 `web/src/components/validation-workbench.tsx`（验证页）：运行选择区（GET /runs 列表）、可信摘要（证据数/事实声明/终稿无证据/待复核/修订轮数/发布结论）、协同链（按节点折叠展示 actor、公开结论、输入引用、产物散列、生产者）、声明证据表（claimTrace 聚组表格：类型/轮次/终稿结论/证据定位/质询议题）、前后对照（各修订轮计数与裁决）、离线校验（POST /verify 七项 checks + 回放对照）、导出入口；支持 localStorage 预填 runId。
- page.tsx 顶部视图新增 `validation`；四个页面导航统一加入「验证」项。
- 学习页：运行结束后显示"查看验证记录"入口（携带 runId 跳验证页）。
- 路径页：节点详情新增"依据"面板——最近一次持久化学习决策（触发来源、BKT 前后值、理由、系统决策与推荐资源）。
- 资源页：新增可信溯源条（门禁状态、难度校准、来源 runId、"查看验证记录"跳转）。
- 画像弹窗：新增"最近一次状态变化"区块（触发来源、BKT before/after、理由、下一步）；难度曲线注明预测值与实际作答口径。
- 修复历史缺陷（冒烟发现）：修订环被调度器误跳过——裁决未放行进入修订轮后，dispatch 的 skipRemaining 把刚入队的修订节点跳过并错误收尾为 succeeded（这正是 G10"20 个历史运行零修订"的根因）；修复为按 adjudication.outcome 区分 revised/rejected，rejected 路径补齐 publication_decision 产物 + generation_end 快照 + manifest；audit 跳过 evidence 块（定位信息不是事实声明）。
- 端到端冒烟（2 个临时账号 + 3 次真实运行，完成后清理）：修订轮机械链路 1→2→3 走通；unsupported 声明 3→2→1 收敛（修订环增益可见）；预算用尽 fail-closed 后 19 产物 + 双快照 + manifest + POST /verify 七项全过；learner-advanced 的一次完整运行保留为演示产物。
- 验证：根 typecheck 0 错、163 测试全过；web tsc 0 错、生产构建通过；api:3001 / worker / web:3000 重启后健康。
- 冒烟临时账号与数据已按表清空（0 残留、0 孤儿产物）；未发生计划外网络下载。

## 2026-08-29 里程碑 F 完成：离线回放、指标与消融

- 新增 `server/runs/metrics.ts`：官方三项指标口径（幻觉率 non_factual 不入分母、空分母 N/A；难度适配/覆盖率判定函数）+ 补充指标（初稿/终稿幻觉率、门禁净增益、有效质询率）+ verifyExportIntegrity（七项完整性校验：artifact hash 重算、DAG 闭合、事件 seq 连续、inputRefs、Claim—Evidence 悬空、裁决只紧不松、发布 fail-closed、敏感字段扫描）+ replayExport（按轮次重算规则门禁与在线裁决对照）。
- 新增脚本：`pnpm verify:export`（导出包完整性校验）、`pnpm replay:run`（离线回放，退出码语义化）、`pnpm gold:export`（黄金标注导出）；新增 `scripts/export-gold-labels.ts` 并生成 data/evaluation/{gold-cases,gold-knowledge-points,personas}.json 三个固定黄金标注文件。
- 指标口径修正（evaluation.ts）：hallucinationRate 改为官方口径（review 在分母、non_factual 排除、空分母 null）+ 新增 draftFinalHallucinationRates（修 G10）；evaluate.ts live 覆盖率改为证据边口径（资源块绑定知识点 × supported Claim 的 evidence edge，修 G9），报告显式区分 resultScope（offline_rule_60 / stratified_live_N + offline_full_60）。
- 消融 A2 重写（修 G10）：按 attempt 轮次统计初稿/终稿幻觉率与门禁净增益（non_factual 排除），历史 20 次运行 A1 分化 3 种计划、A2 终稿幻觉率 0、A3 33/33 入区间全过。
- API：POST /api/learning/runs/:runId/verify（离线规则复算，返回完整性 checks + manifest 对照 + replay 轮次明细）；export 重构为共享构建器 buildRunExportPayload。
- 验证：typecheck 0 错误；23 文件 / 163 测试全过（新增 metrics 13 用例：篡改 hash 发现、悬空 evidence edge 发现、裁决放松发现、seq 缺口、敏感字段、fail-closed 发布校验、口径与净增益）；pnpm evaluate 离线 60 案例全过；pnpm ablation 三组全过。
- 未发生网络下载与 live 模型调用。

## 2026-08-29 里程碑 E 完成：反馈驱动的持久化学习决策

- 新增 `src/learning/decision.ts`：学习决策纯函数（remediate/continue/advance/collect_more_evidence 四态；低掌握或连续错误→补强、掌握高但置信不足→同级采样、双达标→进阶、反馈冲突或证据不足→先追问；先修缺口大优先讲义、补强资源轮换避免重复）+ decisionToRecommendationLevel 路径建议映射；理由携带真实 BKT 前后值。
- schema/迁移 0010：`learning_decisions` 表（learner/run/asset/kp/trigger/input_snapshot_id/decision/推荐资源/rationale），CHECK 约束 + 双索引，已应用。
- 新增 `server/decision-service.ts`：recordLearningDecision（先固化 feedback_update 学情快照→纯函数决策→落库+learning_event，fail-open 不阻断作答主流程）、listDecisions（learner 隔离）、latestDecisionByKnowledgePoint、latestBktUpdate/assetAttemptStats/prereqGapFor 查询辅助。
- 端点接入：quiz-attempts 与 asset feedback 提交后自动记录决策（PG 模式）；新增 GET /api/learning/decisions。
- 路径建议改造（G12）：pg-store getRecommendationEvidence 增载每知识点最近持久化决策，recommendationForNode 优先消费（level 映射 + 理由合并），缺失时回退 computeNodeRecommendation。
- StudyRunRequest 新增 sourceDecisionId（parse/校验、design_constraints 产物记录），形成"反馈→决策→下一运行"链。
- 验证：typecheck 0 错误；21 文件 / 152 测试全过（新增决策 9 用例：四态全覆盖、资源轮换、冲突追问、BKT 前后值可追溯）。
- 未发生网络下载与 live 模型调用。

## 2026-08-29 里程碑 D 完成：声明级幻觉治理与独立质询裁决

- audit.ts 升级：新增 ClaimType 分类（numeric/field_meaning/method_step/causal/risk_advice/non_factual，确定性启发式可单测）与 claimLogicalKey（跨修订轮稳定键，规范化文本）；auditResource 产出 claimType/logicalKey，汇总口径排除 non_factual（不进分母、不阻断发布）。
- 新增 `src/learning/claim-verification.ts`：确定性核验纯函数——数值逐个与绑定证据比对、字段含义对 dataset_fields 字典、越界因果规则（绝对化表述无限定词 fail closed）、引用越界检查；结论只能比输入更严（supported→review→unsupported），绝不放松。
- executor 集成：runAuditClaims 逐条 verifyClaims（字段字典取自 PG dataset_fields）；persistClaims 写 runId/attempt/claimType/logicalKey/supersedesClaimId（按上一轮同 logicalKey 匹配）；裁决计数与修订回退列表排除 non_factual；裁决 Agent 输入补充反证检索结果（不读生成端对话）。
- 反证检索（里程碑 D 第 7 条）：批评 Agent 可提出 counterevidence_request（迁移 0009 扩展 CHECK），executor 在已有知识库/数据中执行反证检索（复用混合检索，不联网），命中项并入合并证据包供下一轮修订引用，结果写入 challenge_set 产物并如实展示未命中/失败。
- 新增 `server/runs/claim-trace.ts`：logicalKey 聚组的声明追溯链（初稿→质询→裁决→修订→终稿）+ hallucinationRateFromTrace（空分母返回 null 的 N/A 语义，修 G10 一部分）；已接入 GET /runs/:runId/trace。
- 验证：typecheck 0 错误；20 文件 / 143 测试全过（新增 11 个故障注入用例：错数字、数字一致、越界因果、字段含义写错、引用越界、无证据建议、核验只严不松、逻辑键稳定、non_factual 口径）；迁移 0009 已应用。
- 未发生网络下载与 live 模型调用。

## 2026-08-29 里程碑 C 完成：真实学情信号与检索后策略修正

- 新增 `server/runs/policy.ts`：taskFactRisk 纯函数（数值/因果/操作密度 + 资源类型风险）、deriveVerificationPolicy 纯函数（sparse 禁强事实/冲突从严/数值因果核验/低置信难度质询/降级如实记录，门禁只增不减）、defaultVerificationPolicy、deriveRiskLevelWithTaskRisk。
- 运行前信号（修 G5）：profile-insights 新增 computeRunLearnerSignals（profileUncertainty=1-目标+先修加权置信度、knowledgeRisk=0.5×近期错误率+0.3×先修缺口+0.2×掌握不确定性）与 prereqClosureOf（前置闭包 BFS）+ computePlannerKnowledgeSignals；routes 的 derivePlannerSignals 改为真实 BKT 信号驱动，planner 风险等级纳入 taskRisk。
- planner 输入固化：POST /runs 创建运行后立即写 design_constraints artifact（signals + 任务风险理由，producer=rule），不再只存在于 plan JSON。
- 检索后修正：analyze.domain 完成后由实际证据产物推导 policy；amended 时写 verification_policy_json + design_constraints（post_retrieval_policy）artifact + 追加 `plan.amended` 事件（protocol 已加事件类型）；生成端消费 forbidStrongFactualClaims（sparse 时 prompt 追加禁强事实约束）；裁决端消费 conflictMode/strength（partial 亦不放行）。
- 验证：typecheck 0 错误；19 文件 / 132 测试全过（新增 policy 测试矩阵 11 用例：空证据 sparse、冲突从严、降级门禁不减、低置信难度质询、高置信不放松、先修缺口计算、无先修权重回退、taskRisk 升级风险等级）。
- 未发生网络下载与 live 模型调用。

## 2026-08-29 里程碑 B 完成：VACP 产物层与起止快照

- schema/迁移：`collaboration_artifacts`（唯一键 run+node+attempt+type+actor）、`run_state_snapshots`（run_start/generation_end/feedback_update）两表落地；claims 补 run_id/attempt/draft_artifact_id/claim_type/logical_key/supersedes_claim_id，study_run_nodes 补 actor_key/primary_artifact_id，study_runs 补 start_snapshot_id/verification_policy_json/execution_manifest_hash；迁移 0008 全部 nullable/带默认值，历史行保留，已应用到 PG 并核对表结构。
- 新增 `server/runs/artifacts.ts`：ActorKey（10 执行者）与节点映射、ArtifactType、PublicRationale 契约、递归排序稳定序列化 + SHA-256、确定性产物 ID、幂等持久化（onConflict 回读）、运行产物链读取、execution manifest 散列、producer 元数据（model/promptHash/settingsHash）。
- 新增 `server/runs/snapshots.ts`：run_start 快照在 createStudyRun 时固化并回写 start_snapshot_id（修 G7 导出语义）；generation_end 快照在发布收尾固化。
- executor 改造：十个节点全部在成功前持久化主产物（learner_snapshot/evidence_set/domain_brief/resource_draft/claim_audit/challenge_set/adjudication/privacy_decision/publication_decision），下游 inputRefs 引用上游产物 ID；修订轮走 attempt+1 产物不覆盖旧轮；上传正文只存文件名/字节数/散列；发布收尾计算 execution manifest hash。claims 落库带 runId/attempt/draftArtifactId。
- 路由：新增 `GET /api/learning/runs/:runId/trace`（DAG+artifact+Claim 图+质询+裁决+快照，learner 双重校验）；export 修正——initialLearnerState 取 run_start 快照（历史运行回退现查并如实标注 source）、artifact 清单+散列+producer、Claim 按 attempt 分组、EvidencePack 快照、执行清单散列、上传正文替换为审计元数据（脱敏）。
- 验证：typecheck 0 错误；测试 18 文件 / 121 用例全过（新增 artifacts 契约 6 用例：稳定序列化、单字符变化散列必变、产物 ID 确定性、执行者覆盖）；pnpm db:migrate 应用成功。
- 未发生网络下载与 live 模型调用。

## 2026-08-29 里程碑 A 完成：基线冻结与流量保护

- 工作区改动确认（`git status --short`）：用户未提交改动为 findings.md / progress.md / task_plan.md（升级规划记录）、删除早期计划文件、形成阶段性可信协同计划；本轮未覆盖无关改动。
- 服务与数据状态：PostgreSQL / Redis 容器 healthy（15432 / 16379），api(3001) 与 web(3000) 常开运行中；MetroPT-3 数据与嵌入已在库，未重新拉镜像、未重新导数据。
- 基线验证：`pnpm typecheck` 0 错误（5.5s）；`pnpm test` 17 个测试文件 / 115 用例全部通过（3.2s）；`pnpm-lock.yaml` 无变化。
- 流量保护约定落位：`.env.example` 新增 `IM_TRAINING_AGENT_ALLOW_LIVE_EVAL=false`（默认关闭），并注明打开前必须先说明预计案例数与调用量、取得用户授权；本轮未发生任何网络下载与 live 模型调用。
- 下一步：里程碑 B（VACP 产物层与起止快照）——schema 增补 `collaboration_artifacts` / `run_state_snapshots`、新增 `server/runs/artifacts.ts` 与 `server/runs/snapshots.ts`、executor 节点产物化、Claim 补 attempt/draft 关联前置。

## 2026-08-29 挑战杯可信协同升级阶段记录

- 完整重读 `挑战杯.md`：确认满分要求集中在完整闭环（30）、技术创新（25）、用户体验（15）和实用价值（30）；实用价值高分线要求 ≥3 画像、完整测试方案、幻觉率 <5%、难度适配 ≥85%、核心知识覆盖 ≥90%，且低档说明明确提到测试用例不足 50 组会扣分。
- 复核当前实际代码：动态 DAG、BullMQ、SSE、BKT、难度校准、混合检索、Claim 审核、独立批评、证据裁决、六类资源均已落地；当前 115 个测试与 TypeScript 检查通过。
- 明确主要缺口：`context_json` 会覆盖修订轮中间产物；Claim 缺 attempt/draft 关联；运行前画像快照语义不正确；planner 运行时信号较粗；覆盖率仍有关键词判定；现有 live 报告仅 9 个分层案例；消融报告没有初稿幻觉率与真实修订增益。
- 形成核心创新：VACP 可验证 Agent 协同协议，以及“学情图—声明证据图—协同运行链”架构；通过不可变 artifact、公开理由、输入引用、内容散列、离线 replay、反事实画像对照和消融实验形成可供第三方验证与借鉴的方法。
- 前端方案锁定为小改：保留现有三个工作台，顶部新增“验证”页面；路径页补决策依据，学习页补节点公开产物，资源页补 provenance 和反馈影响，画像补 before/after。
- 形成详细阶段执行计划，覆盖硬约束、差距审计、目标协议、数据/API、八个里程碑、测试矩阵、指标口径、材料清单、风险与完成定义；其已落地内容现归并到技术基线、提交包和内部进度记录。
- 流量约束已写入计划：本次规划未联网、未安装依赖、未下载数据或模型、未执行 live 模型评测。

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

- 按早期阶段规划产出唯一技术总规 `docs/挑战杯技术开发总规.md`：现状审计（D1-D7 缺陷含 selectedAgentIds 假交互、difficulty 0.42 硬编码、进程内 Run 无持久化）、目标架构、API 契约、九组领域表、BKT/难度校准/苏格拉底/混合检索算法、迁移流程、任务顺序与量化验收。
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
- 已完成：用户上传资料默认只作为当前会话临时参考；用户明确同意且智能策展通过门禁后才写入版本化知识来源，否则只记录文件名、大小和哈希审计信息，不保存原文。
- 已完成：模型服务支持多服务入口、模型自定义名称、low / medium / high / max 思考深度；系统默认执行模型与深度可核验，输入框不再重复设置。
- 已完成：按模式职责配置选择学习 Agent，包含交叉验证与合规审计角色，不再从通用 Agent 数组按顺序截取。
- 已完成：设置弹窗顶部保留三页：模型服务、协同编排、数据与隐私。协同编排固定六个职责角色，逐角色可继承明确的系统默认模型/深度或指定覆盖；资料审核不再暴露为用户设置项，隐私角色为发布前固定关卡。
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

# 2026-08-30 用户反馈收口

- 设置与隐私：移除 SQLite 静态描述，改为展示实际 PostgreSQL 数据源、记录数量、导出入口和审计清理操作。
- 画像与头像：头像可直接点击更换；画像更新无新增学习证据时保持不变，更新按钮居中并展示结果。
- 协同与路径：公开协同事件在运行完成后继续保留；路径页协同活动默认展开，展示可审计的动作摘要。
- 资源与验证：资源类型收敛为讲义、习题、PPT、知识脉络，新增资源问答；验证页三张辅助卡片明确说明前后对照、离线校验和证据包导出的用途。
- 验证：类型检查、测试、前端生产构建、浏览器回归通过；3000/3001 服务保持运行。

# 2026-08-30 验证页与头像稳定性

- 验证页去掉运行 UUID 和页眉重复标题；导出区改成更克制的说明，前后对照改为轮次与快照状态指标。
- 验证策略展示证据覆盖、校验强度和附加约束数量，数据来自当前运行产物。
- 修复头像更新接口未附带 `diagnosticCompleted` 导致主页面误切回诊断流程的问题；补充图片格式、大小、解析和尺寸校验。
- 回归通过：`pnpm typecheck`、`pnpm --dir web build`，未登录访问设置/学习接口返回 401 且服务保持运行。

# 2026-08-30 学习空间与资源体验打磨

- 学习证据回流：讲义掌握反馈、习题提交和资源完成记录会广播证据更新事件；路径页与学习页在事件、窗口聚焦和运行结束时重新读取路径/画像，推荐状态不再停留在旧快照。
- 协同方式说明：指定角色模式增加实际使用场景与保留审核/检索关卡的说明；左侧“本次配置”改为目标节点、产物、角色数和运行状态等动态信息。
- PPT 闭环：生成提示明确按幻灯片组织，资源页提供逐页演示阅读和 PPT 下载；服务端导出 PowerPoint 可打开的演示稿文件。
- 阅读体验：资源目录改为更接近知识库的文件树层级，讲义与智能体消息支持标题、列表、引用、加粗和行内代码；笔记面板说明记录价值、显示字数，并保留到资源级笔记。
- 回归通过：`pnpm test`（163 项）、`pnpm typecheck`、`pnpm --dir web build`、`git diff --check`。

# 2026-08-30 验证页导航统一

- 验证页顶部导航与路径、学习、资源页统一：设置与画像回到中间导航，退出回到右侧独立入口，避免验证页出现另一套布局和位置跳变。
- 画像弹窗在验证页恢复可用，并沿用头像入口和用户状态更新逻辑。
- 回归通过：验证页浏览器抽查、`pnpm typecheck`、`pnpm --dir web build`。

# 2026-08-30 验证信息与画像标签调整

- 验证页“比赛证据包”改为“证据包”，移除不必要的比赛语境。
- 画像关键词改为从自述中提取短标签，并结合已记录知识点；不再把整段自述或“专业知识学习”这类泛化文案当作关键词。
- 协同运行状态继续保留在学习对话流中，运行结束后仍可复盘。
- 协同过程持久化：学习页刷新或从其他页面返回后，会从最近一次运行的 trace 恢复节点状态和公开摘要，不再只依赖当前页面挂载状态。

# 2026-08-30 提示词体系重写与富文本渲染升级

- 新增 `server/prompts.ts` 作为全部对模型系统提示词的唯一事实源：资源生成（按讲义/PPT/习题/知识脉络分型 + 修订轮变体 + 证据稀疏约束）、学情分析、领域分析、独立批评、证据裁决、路径页协同对话、资源问答、苏格拉底追问（提问/评价）、首次建档路径规划。所有提示词统一了 JSON 契约、数字纪律（数字必须能在证据原文定位，否则 Claim 核验拦截）与中文风格约束。
- 四种资源全部接入 LLM 结构化生成（此前习题/知识脉络走固定模板）：讲义 = 导语 + 4-6 节 Markdown 正文 + 代码示例 + 记忆点 + 常见误区 + 自测问题；PPT = 封面页 + 6-8 页要点 + 每页讲解词；分层习题 = L1/L2/L3 情境化单选题 6-9 道 + 依据引用解析；知识脉络 = Mermaid 图 + 节点解读 + 推荐阅读路径。`resource-builder` 新增 `parseLlmResourceDraft`/`buildLlmResourceDocument` 分型解析与组装，结构不达标自动回退确定性模板；生成 token 预算按类型提升至 3600-6000。
- 资源问答升级：选中资源优先注入、上下文限长、回答预算 2000，回答按“直接结论 → 依据来源 → 下一步建议”结构输出 Markdown。
- 苏格拉底追问：后续轮次同样携带证据摘要，提问基于上一轮回答递进。
- 前端新增共享富文本组件 `rich-text.tsx`（围栏代码块带复制、Markdown 表格、多级标题、有序/无序列表、引用、行内格式），讲义正文、资源问答、协同群聊统一接入；讲义阅读器章节自动编号 + 渐变色标题锚点 + 学习目标卡；PPT 阅读器重做：封面页版式、要点条目、讲解词分区、页码指示；Mermaid 图改用 base 主题配色并居中展示。
- 新增 `src/learning/resource-builder.test.ts` 13 项测试：四种资源解析校验、块组装与证据绑定、生成→Claim 审核联动（数字一致过门禁、编造数字被拦截、模板兜底）。
- 回归通过：`pnpm typecheck`、`pnpm test`（176 项）、`pnpm build`（server）、`pnpm --dir web build`。

# 2026-08-30 低价值静态小字清理

- 全前端清理硬编码的说明性小字（约 20 处）：这类"系统会如何如何"的静态解释不携带动态信息、干扰视线，全部删除或压缩为一句。
  - 资源页：侧栏"工作区"标签、讲义笔记与阅读反馈的功能说明、通用资源页学习记录说明、空状态两行并一行。
  - 学习页：空状态系统编排流程长段、"指定角色"功能说明块（保留角色 chips）、运行收尾说明句简化。
  - 验证页：前后对照/离线校验/证据包三个区块的副标题、底部重复说明段、空状态与"暂无主产物"文案缩短。
  - 设置弹窗：协同编排页顶部说明横幅删除、思考深度说明压缩为"低更快，高更稳。"。
  - 画像弹窗：画像描述空文案、区块标题里的流程性括号注释删除（保留"目标成功率 65%–80%"这类解释数字的注释）。
  - 诊断完成页元说明、苏格拉底弹窗底部轮次说明与输入框占位符、注册表单说明句删除。
- 保留原则：动态数据、错误提示、带操作引导的一句话空状态全部保留。
- 回归通过：`pnpm --dir web build`、`pnpm typecheck`、`pnpm test`（176 项）。

# 2026-08-30 UI 组件打磨

- 删除路径页左下角"服务正常/服务未连接"状态条及其轮询逻辑（服务状态对学习者无操作价值，异常时接口报错本身就有提示）。
- 习题作答升级：选项卡片改为方形字母 chip + hover 阴影过渡；提交后当场标出对错（正确答案绿色高亮、错选红色），题号导航同步；诊断流程选项样式统一为同款。
- 讲义阅读器新增顶部阅读进度条（随滚动填充渐变色细条）。
- 路径树节点卡片加 hover/选中阴影层级。
- 回归通过：`pnpm --dir web build`、`pnpm typecheck`、`pnpm test`（176 项）。

# 2026-08-30 模型切换 OpenCode MiMo 与内容质量修复

- 模型配置：接入 OpenCode Zen（https://opencode.ai/zen/v1）provider，模型 mimo-v2.5-free，设为默认执行模型；所有智能体角色继承默认；思考深度保持 max。端点连通性与鉴权已实测通过。
- 根因修复（"生成模型不可用，已使用内置结构模板"）：资源生成此前受 30 秒调用超时与角色路由输出上限双重挤压，推理模型必然超时回退模板。现拆分 callResourceGeneration 专用通道：超时 200 秒、token 预算按类型 8000-12000（讲义最长）、失败原因写 console.warn 可排障；各节点超时放宽（生成 240 秒、其余 90 秒）；批评/裁决/追问/问答/对话的调用预算与超时同步放宽（推理模型思维段占用输出预算）。
- 讲义升格：提示词要求 6-8 节、每节 400-700 字、全文正文 3000 字以上、至少 2 段可运行代码、按完整教学脉络组织。
- 分层习题三题型：QuizQuestion 增加 type（choice/blank/short_answer）；选择/填空（多候选规范化判分，src/learning/quiz.ts 共享纯函数）/简答（对照参考答案自评）；LLM 生成 9-12 题（每层 3-4 道混合三题型），模板兜底同步扩为 9 题三题型；前端按题型渲染作答界面（填空输入框、简答参考答案对照自评），判分 API 支持 selfAssessed。
- 资源页证据卡清理：结构化数据证据不再逐条输出原始 JSON"数据样本"卡（数据摘录表格已覆盖），只保留领域文档说明卡。
- Mermaid 双保险：生成端清洗节点/边标签内的半角危险字符；前端识别 "Syntax error" 错误图，降级为源码展示不再出现大红错误块。
- 学习页协同状态条置顶 sticky：智能体发言按时间顺序在状态条下方实时追加，跑完不用回翻；路径页对话升级为与学习页一致的卡片样式（头像 + 富文本渲染 + 协同过程卡）。
- 智能体发言更具体：资源生成气泡按类型报告结构（N 节正文约 X 字 / N 页 / N 道题三题型 / 图+解读+路径）。
- 回归通过：`pnpm typecheck`、`pnpm test`（177 项）、`pnpm build`、`pnpm --dir web build`；3000/3001/worker 已重启生效。

# 2026-08-30 界面精简与体验打磨（第二轮）

- 学习页三栏重排：协同运行状态条从中间栏移到左栏（与"当前节点"上下排布），中间栏恢复为纯消息流正常滚动；删除"学情快照""本次配置"两块腾出空间；相应清理 profile/Metric 死代码与冗余接口调用。
- 彻底移除"指定角色"协同模式：下拉、角色 chips、前端校验与请求字段全部删除，协同编排统一交由顶层编排（自动编排即唯一路径，后端默认 auto 兼容）。
- 画像弹窗：删除"移除头像"按钮（点头像即换）；难度匹配曲线/知识盲区标签中文降级链（静态表 → 路径节点标题 → ID），补齐 compressor-diagnosis-evidence 映射，不再出现英文 ID。
- 资源页侧栏删除类型列表头（与类型导航重复）；学习路径节点 description 支持「；」分隔要点自动渲染为无序列表（提示词同步要求 LLM 按 2-3 个要点输出）。
- Code review 收尾：修复 3 处 eslint no-useless-escape；清理全部死代码残留（grep 验证零残留；后端对已删请求字段默认 auto 兼容）。
- 回归通过：`pnpm lint`（0 错）、`pnpm typecheck`、`pnpm test`（177 项）、`pnpm --dir web build`；浏览器实测学习页三栏、画像弹窗、资源页均符合预期。

# 2026-08-31 学习空间交互收敛

- 已完成：产品内上下文清理确认、学习页路径调整预填跳转、输入工具条整理、资源问答同步改造。
- 已完成：处理进度去重；浏览器回归确认学习页与资源问答均能打开确认面板，路径调整会预填到路径页。
- 验证：`pnpm test` 185 项通过、`pnpm typecheck`、`pnpm --dir web build`、界面规则检测均通过。
# 2026-08-31 本轮完成

- 路径图节点点击现在会稳定更新右侧当前节点详情，点击态、标题同步与详情滚动位置都有明确反馈；学习页保留任务进度、处理过程折叠、节点操作和画像刷新逻辑。
- 资源工作区收窄左侧文件栏，统一正文/演示稿/知识脉络工具栏，增加 Markdown、纯文本、JSON（PPT 另含 PowerPoint）导出菜单，并重做章节目录与 PPT 翻页控件。
- 历史 Mermaid 内容先做安全归一化；无法渲染时展示结构化关系路径和可选源码，不再把 Mermaid 报错当成正文。
- 验证：`pnpm typecheck`、`pnpm test`、`pnpm --dir web build`、Impeccable detector、`git diff --check` 均通过；`pnpm --dir web lint` 仍受仓库既有 React hooks 规则报错影响，未作为本轮质量门禁。

# 2026-09-01 协同流式与路径联动收口

- 学习运行的公开 Agent 结论写入同一条 Run SSE 事件流；前端按角色逐步呈现结论和处理状态，明确不展示模型隐藏思维链。
- 路径调整新增“一键更新路径”，服务端会结合画像、学习记录与证据重新评估；路径助手的结构化 `reply` 仅流式输出可见答复，revision 仍在服务端校验后落库。
- 学习页手动输入 `@节点` 时立即同步当前节点与右侧路径焦点；资源生成卡片标明“AI 生成 / 模板兜底 / 来源已记录”和未发布原因，避免把规则兜底误称为模型生成。
- 资源问答新增“当前资源 / 整个资源库”范围切换，回答正文通过 SSE 增量渲染并按 Markdown 富文本展示。
- 回归通过：`pnpm test -- --run`（189 项）、`pnpm typecheck`、`pnpm lint`、`pnpm --dir web build`、Impeccable detector；本地 3000/3001 服务保持运行。

# 2026-09-01 多助手公开输出可见性补强

- 学习对话恢复为自然的左侧聊天流：每个助手以独立头像、角色名、来源标签和消息气泡连续发言，不再把协同结论集中到顶部摘要。
- 运行中消息气泡按增量逐步显字并显示“正在输出”光标，完成后保留完整公开结论；左侧任务进度只承担节点状态与检查摘要。
- 路径调整也将学习规划、资料检索、内容检查三个助手的公开结论作为独立对话消息持久化，并通过 SSE 增量显字。
- 历史“进入人工复核”文案统一显示为“等待智能体补充核验”，与当前自动检查流程保持一致。
- 路径调整期间不再显示低价值的“已读取当前路径……”状态横幅，仅保留聊天内容与发送中状态，避免打断对话。
- 回归通过：`pnpm typecheck`、`pnpm lint`、`pnpm --dir web build`、Impeccable detector；浏览器页面正常加载且无控制台错误。

# 2026-09-01 路径助手模型答复兜底修复

- 修复部分推理模型只返回 `reasoning_content`、没有可见 `content` 时被错误判定为连接失败的问题；路径助手现在校验可见 JSON 答复后再应用路径变更。
- 路径助手输出预算提升到适合当前路径上下文的安全范围；主模型无可见答复或超时/异常时自动切换已配置的备用模型，失败时保持路径不变并给出可操作的设置提示。
- 回归验证：真实浏览器请求成功返回路径检查结论，未修改节点；测试对话记录已清理。

# 2026-09-01 路径与学习能力实测

- 浏览器实测路径节点点击、当前节点详情同步、路径方向切换和“更新路径”按钮状态；真实发送一次保持节点不变的检查请求，学习规划、资料检索、内容检查三个助手按顺序流式输出，路径助手返回连贯性结论，测试记录已清理。
- 浏览器实测学习页节点切换与“引用到问题”：选择时间字段节点后，任务上下文、路径焦点和输入框中的 `@节点` 同步；历史任务中可见学习规划、资料检索、专业分析、学习材料、内容检查、隐私保护等助手的公开结论及任务进度。
- 路径与学习交互后控制台错误数为 0；`pnpm typecheck`、`pnpm lint`、`pnpm test -- --run`（189 项）、`pnpm --dir web build`、界面规则检测均通过。

# 2026-09-01 学习运行稳定性与速度修复

- 根因修复：`dev:full` 现在同时启动 API、前端和学习任务 worker；此前 worker 未启动会让学习任务长期停在排队状态。
- 根因修复：运行事件序号使用 run 级数据库事务锁分配；并发检索节点不再争抢同一序号。节点外层超时增加收尾缓冲，避免模型超时降级与队列重试同时发生，造成重复修订和状态交叠；已收尾运行也不会再被迟到任务改写。
- 性能修复：新任务只传入最近且有意义的学习者意图，历史草稿、审核和辩论记录不再反复喂回模型；路径调整答复的输出预算收敛到实际所需范围。
- 可见性修复：路径更新最终帧携带已落库的助手消息，页面即使错过中途帧也会补全；助手消息先展示，路径助手再流式给出结论，刷新后仍完整保留。
- 浏览器回归：路径更新后“学习规划 → 资料检索 → 内容检查 → 路径助手”顺序与刷新回放均正常。学习回归任务已完整跑通并行检索、画像、专业分析、三轮生成/审核/质询/裁决并正常收尾；每个节点每轮仅一条记录，没有重复执行。
- 进一步收敛：规则已明确判定“缺少依据”时跳过无权放宽结论的裁决模型调用，直接进入针对性修订；审核强度不变，后续同类运行减少一段无效等待。
- 同样地，规则已找到未绑定证据的硬性问题时不再额外调用批评模型重复确认；独立批评端仍用于规则未拦截时发现遗漏风险。
- 验证：`pnpm typecheck`、`pnpm lint`、`pnpm test -- --run`（189 项）、`pnpm --dir web build` 均通过。

# 2026-09-01 自动发布状态与审核误判修复

- 验证页最近任务不再把所有未生成资产的任务笼统标为“未入库”：等待执行、生成中、已取消、处理失败、未通过自动发布检查和资源已入库分别呈现，避免把正常运行或已取消任务误报为入库故障。
- 自动审核继续保持证据从严：精确行数可支持可验证的保守中文下界（如 1516948 行支持“超过 150 万行”），日期、单位和具体数值仍要求原样可定位；练习中的假设日期不再被误当作数据事实。
- 字段字典核验仅检查“字段含义/表示”等语义断言，不再将字段类型确认或格式转换操作误判为字段释义；修订提示明确要求删去未证实事实，并禁用凭空的日期、行数和字段事实示例。
- 回归通过：`pnpm test -- --run`（191 项）、`pnpm typecheck`、`pnpm --dir web build`；浏览器实测验证页状态与最近历史一致，后台 worker 已重启加载规则。

# 2026-09-02 生产级体验与业务闭环加固

- 已完成：四类资源路由收敛、异步加载乱序防护、资源阅读状态隔离、路径节点引用联动和前端 lint 清零。
- 已验证：26 个测试文件 / 194 项通过；根项目 lint 与类型检查通过；前端生产构建通过；浏览器实测 PPT 切换、学习页 `@节点` 联动和无错误提示。

# 2026-09-02 四类资源真实生成与内容质量回归

- 通过真实浏览器任务分别生成讲义、PPT、分层习题、知识脉络，并核对资源库实际落库结果，不以聊天中的“完成”作为验收依据。
- 讲义落库为 31 个内容块、10 个章节、约 4485 字；PPT 为 9 页、28 个内容块、约 2998 字；分层习题为 9 题，L1/L2/L3 各 3 题且选择/填空/简答各 3 题；知识脉络为 23 个内容块、16 个 Mermaid 节点、3 条阅读路径、约 2350 字。
- 四类新资源正文均围绕当前 MetroPT-3 空压机数据和真实字段生成，渲染正文不再带入旧的“泽火革”或 AI4I 样本内容；证据定位仍保留在审计链路。
- 端到端验证习题提交、判分、解析和再次作答：首次错误答案正确判错，改答后正确计为 1/9。
- 发现并修复一次 PPT 任务启动前节点焦点回退问题后补测：当前节点稳定保持为“数据清洗与时间字段”，检索 19 条数据证据，模型生成 8 页内容（资源阅读器含封面共 9 页），经过 3 轮审核后 49/49 条声明有依据并成功入库。
- 回归通过：根目录 26 个测试文件 / 197 项，类型检查、根目录 lint、前端 lint、服务端构建、前端生产构建均通过；后端与 worker 已按最新代码重启。
