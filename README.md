# IM-Training-Agent

> 面向挑战杯“领域知识个性化生成与多智能体协同决策系统研究”赛题的多智能体个性化训练项目。

IM-Training-Agent 的目标不是做一个通用聊天机器人，也不是简单堆叠多个大模型 API，而是面向垂直领域技能训练，探索“学习者差异识别—多智能体协同决策—专业内容生成与校验—交互反馈—动态调整”的完整训练闭环。

## 1. 项目定位

挑战杯赛题要求系统能够：

- 根据不同学习者背景和先验知识形成差异化训练；
- 由至少 3 个职责明确的智能体完成“分析—生成—校验—决策”协作；
- 结合学习者画像与领域专业知识，动态生成个性化学习资源；
- 展示多智能体协作过程、个人学情与资源匹配情况；
- 根据学习反馈继续调整解释难度、训练路径和后续任务；
- 通过交叉验证、审核、知识溯源等机制降低专业内容幻觉。

因此，本项目最终应围绕下面的业务主链建设：

```text
学习者输入 / 学情数据
        ↓
学情诊断与任务理解
        ↓
多智能体协同决策
        ↓
领域知识检索 / 工具调用
        ↓
个性化资源生成
        ↓
审核、评估与迭代修正
        ↓
学习交互与测试反馈
        ↓
学习状态更新 / 下一轮训练决策
```

## 2. 当前代码底座

当前仓库已经具备一套可运行的通用多智能体编排底座，主要包括：

### 多智能体核心

`src/core/`

- Agent 基础抽象；
- 消息、上下文与类型系统；
- Agent 执行接口与错误处理。

### 协作与通信

`src/collaboration/`、`src/communication/`

- 串行协作；
- 并行协作；
- 专家组；
- 辩论、审核等协作模式；
- 多种 Agent 通信结构。

### 深度规划与协同执行

`src/orchestration/`

当前核心链路为：

```text
DeepPlanner
   ↓
任务拆解 / Agent 分工 / 依赖关系
   ↓
AgentCluster
   ↓
并行或依赖驱动执行
   ↓
工具调用 + 共享记忆
   ↓
DeepEvaluator
   ↓
质量不足时重新规划与迭代
   ↓
最终综合输出
```

这部分是真实代码能力，不是前端演示动画。

### 多模型运行时

`src/models/`

- 多模型 Provider 注册；
- 模型路由；
- 按任务复杂度和能力选择模型；
- OpenAI-compatible 模型接入。

### 共享记忆与工具

`src/memory/`、`src/tools/`

- Agent 间共享任务信息；
- 工具注册和调用；
- Agent-as-Tool 等扩展能力。

### 动态工作流

`src/workflow/`

支持自动生成并运行多阶段协作流程，包括流水线、并行处理、预算控制和结构化结果。

### 学习产品服务端

`server/`

- Express API；
- Cookie 登录与学习者数据隔离；
- 学习路径、证据、资源、笔记与作答持久化；
- 多智能体学习任务执行与消息轮询。

### 前端

`web/`

当前是 Next.js 前端，产品入口只保留三个工作台：

- 学习路径：查看知识树、画像和证据驱动的学习建议；
- 协同学习：引用路径节点，观察检索、生成、审核与发布过程；
- 学习资源：阅读讲义、做分层习题、记笔记并回传反馈。

## 3. 当前阶段必须认清的边界

现有代码底座的强项是“通用多智能体编排”，但挑战杯作品不能停留在这里。

比赛真正需要继续产品化和领域化的是：

1. **学习者画像层**：把学历、先验测试、知识点掌握度、学习历史等变成真实状态，而不是一次性 Prompt 文本；
2. **领域知识层**：建立可检索、可引用、可审核的专业知识库；
3. **个性化资源层**：生成讲义、实操指南、分阶测试等不同资源，并和学习者能力匹配；
4. **反馈学习层**：根据答题、交互和资源使用结果更新学习状态；
5. **比赛创新层**：把多智能体交叉验证、审核、争议处理与决策依据做成可解释机制，而不是只展示“有几个 Agent”；
6. **评测层**：围绕幻觉率、资源难度适配率、核心知识覆盖率等比赛指标做真实评估。

换句话说：

```text
通用 Multi-Agent Runtime ≠ 最终挑战杯产品
```

通用底座应该成为比赛领域内核的基础设施，而不是最终叙事本身。

## 4. 品牌约定

项目统一名称：

```text
IM-Training-Agent
```

代码包名使用 npm 合法的小写形式：

```text
im-training-agent
```

新的运行环境变量优先使用：

```text
IM_TRAINING_AGENT_LEARNING_DB
IM_TRAINING_AGENT_DATASET_DB
IM_TRAINING_AGENT_METROPT_CSV
```

## 5. 本地运行

### 环境要求

- Node.js 18+
- 可用的大模型 API Key

### 安装依赖

```bash
pnpm install
```

### 模型配置

默认主模型为通义千问 `qwen-plus`，通过 DashScope 的 OpenAI-compatible API 调用。真实密钥放在本地 `.env`：

```bash
DASHSCOPE_API_KEY=your-dashscope-api-key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

也可以在根目录 `models.config.ts` 扩展其他 Provider。

### 启动后端

```bash
pnpm server
```

默认地址：`http://localhost:3001`

### 启动前端

另开终端：

```bash
pnpm --dir web dev
```

默认地址：`http://localhost:3000`

### 平台基础设施：PostgreSQL + Redis（挑战杯主线）

技术总规见 `docs/挑战杯技术开发总规.md`。PostgreSQL 16 + pgvector 是唯一业务数据源，Redis 7 只负责 BullMQ 队列、锁与 run 事件分发。两者以 Docker 容器运行（数据落在 Docker 的数据磁盘中）：

```bash
docker compose up -d postgres redis   # 启动数据库与队列
pnpm db:migrate                       # 应用 PostgreSQL schema 迁移
pnpm migrate:sqlite-to-pg --dry-run   # 只读校验源 SQLite：各表指纹与行数
pnpm migrate:sqlite-to-pg             # 幂等迁移：表级事务、分批 COPY、行数/时间边界校验、迁移报告
pnpm migrate:sqlite-to-pg --cutover   # 全部校验通过后标记切换运行数据源
```

`.env` 中配置 `DATABASE_URL` 与 `REDIS_URL`（见 `.env.example`）。注意：若本机 5432/6379 已被原生服务占用，在 `.env` 中改用 `POSTGRES_PORT`/`REDIS_PORT` 指定空闲端口。迁移完成并通过校验前，运行时数据源保持 SQLite；迁移全程只读源库，SQLite 仅作可恢复备份。

### 同时启动

```bash
pnpm dev:full
```

### 准备完整 MetroPT-3 数据（可选）

仓库默认包含 AI4I CSV、MetroPT-3 字段/故障窗口说明和知识卡，因此不下载大文件也能运行。需要完整的 151 万行 MetroPT-3 时序训练时，在 Windows 执行：

```bash
pnpm data:metropt
```

脚本从 UCI 官方地址下载约 208 MB 的 CC BY 4.0 数据包、校验 SHA256，并只解出 CSV。CSV 被 Git 忽略；后端下次启动时会自动导入 SQLite。也可以通过 `IM_TRAINING_AGENT_METROPT_CSV` 指向已有文件。

## 6. 目录结构

```text
IM-Training-Agent/
├─ src/
│  ├─ core/              # Agent 核心抽象
│  ├─ orchestration/     # 深度规划、Agent 集群与质量评估
│  ├─ collaboration/     # 多智能体协作模式
│  ├─ communication/     # Agent 通信结构
│  ├─ models/            # 多模型注册、路由与客户端
│  ├─ memory/            # 共享记忆
│  ├─ tools/             # 工具系统
│  └─ workflow/          # 动态工作流
├─ server/               # Express 学习产品服务
├─ web/                  # Next.js 前端
├─ models.config.ts      # 模型配置
└─ 挑战杯.md             # 官方赛题与评分要求
```

## 7. 开发原则

后续开发应遵循以下原则：

- 测试通过只是底线，不等于产品完成；
- 所有比赛展示功能必须有真实后端状态和数据链路支撑；
- 不通过堆叠 Agent 名称包装创新；
- 不把一次 Prompt 生成伪装成持续学习；
- 多智能体过程要能够实时、自然地展示，而不是任务结束后一次性回放；
- 用户可见内容优先使用中文，技术协议、代码标识和第三方标准名按需要保留英文；
- 任何“高准确率、低幻觉率、个性化有效”等结论都应由可复现评测支撑。

## 8. 比赛目标

最终作品应能够在一次完整演示中清晰呈现：

```text
不同背景学习者
   ↓
差异化学情诊断
   ↓
多智能体实时协作与决策
   ↓
专业知识约束与交叉校验
   ↓
个性化学习资源
   ↓
学习 / 作答反馈
   ↓
学习状态更新
   ↓
下一轮个性化训练
```

这条闭环才是 IM-Training-Agent 作为挑战杯项目最重要的产品主线。
