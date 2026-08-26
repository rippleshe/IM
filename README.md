# π Multi-Agent

**Production-Grade Multi-Agent Orchestration Framework**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![npm](https://img.shields.io/npm/v/pi-multi-agent.svg)](https://www.npmjs.com/package/pi-multi-agent)

[Features](#features) · [Execution Modes](#execution-modes) · [Quick Start](#quick-start) · [Architecture](#architecture) · [API Reference](#api-reference) · [Contributing](#contributing)

---

## Overview

π Multi-Agent is a TypeScript-native framework for building production-grade multi-agent orchestration systems. It implements the complete agent lifecycle — **Goal → Plan → Execute → Evaluate → Replan → Output** — with LLM-powered task decomposition, intelligent model routing, real tool calling, and iterative quality refinement.

The framework provides three distinct execution modes to match task complexity: **Direct** for simple queries, **Deep** for research-intensive multi-agent collaboration, and **Workflow** for dynamic pipeline orchestration.

---

## Screenshots

<table align="center">
  <tr>
    <td><img src="demo.png" alt="Pi Multi-Agent Dashboard" width="400" /></td>
    <td><img src="demo1.png" alt="Pi Multi-Agent Deep Research" width="400" /></td>
  </tr>
</table>

---

## Features

- **Three Execution Modes** — Direct, Deep (Agent Cluster), and Workflow (dynamic pipeline)
- **Multi-Model Adaptive Routing** — Automatically selects the optimal LLM per task by complexity, priority, and required capabilities
- **LLM-Powered Deep Planning** — Intelligent task decomposition with dependency graphs, agent role assignment, and quality thresholds
- **Agent Cluster Execution** — Spawn 10+ specialized sub-agents with real tool calling (web search, data analysis, code execution)
- **Iterative Quality Loop** — Multi-dimensional evaluation → automated replanning → retry until quality threshold is met
- **Enhanced Shared Memory** — Inter-agent data passing, session context persistence, and output sharing
- **6 Collaboration Patterns** — Sequential, Parallel, Debate & Consensus, Expert Team, Critic-Reviewer, Hierarchical
- **6 Communication Topologies** — Single Agent, Network, Supervisor, Supervisor-as-Tool, Hierarchical, Custom
- **Dynamic Workflow Engine** — Sandboxed JavaScript execution pipeline with budget control and concurrency management
- **Real-Time Dashboard** — WebSocket-powered Next.js UI with agent status, tool calls, progress tracking, and report viewer
- **Type-Safe** — Full TypeScript with strict mode, comprehensive public API types

---

## Execution Modes

The framework exposes three execution modes, each optimized for a different task complexity spectrum.

### Direct Mode

Suitable for simple, single-step tasks that do not require multi-agent coordination. A single LLM call processes the request and returns the result. This is the default mode for greetings, Q&A, basic calculations, and short-form content generation.

**Characteristics:**
- Single LLM invocation
- Lightweight model routing (cost-optimized)
- Sub-2-second response time
- No planning or evaluation overhead

**Use cases:** Chat, Q&A, summarization, code explanation, translation

### Deep Mode (Agent Cluster)

Designed for complex, research-intensive tasks requiring multi-agent collaboration. The system performs LLM-driven task decomposition to generate a structured execution plan, then spawns a cluster of specialized agents that execute sub-tasks in parallel with real tool calling, sharing results through enhanced shared memory.

**Execution Pipeline:**

```
User Task
  → DeepPlanner: LLM-driven decomposition into N sub-tasks
    → Dependency graph construction
    → Agent role & tool assignment per sub-task
  → AgentCluster: Parallel/sequential execution
    → Tool calling (web_search, data_analyzer, etc.)
    → Shared memory inter-agent data passing
  → DeepEvaluator: 4-dimension quality assessment
    → Accuracy · Completeness · Consistency · Format
  → Quality gate: score < threshold → Replan → Retry (up to N iterations)
  → Final output synthesis
```

**Key capabilities:**
- Up to 10 sub-tasks per execution, with automatic dependency resolution
- Per-sub-task model selection (light model for simple sub-tasks, reasoning model for analysis)
- Real tool calling with input/output tracking and duration measurement
- Iterative quality improvement loop with configurable evaluation thresholds
- Real-time progress streaming via WebSocket

**Use cases:** Market research reports, technical deep-dives, comparative analysis, long-form content generation (30,000+ words), multi-source synthesis

### Workflow Mode (Dynamic Pipeline)

The most flexible execution mode. An LLM auto-generates a structured JavaScript workflow script based on the task description, then executes it in a sandboxed VM environment with controlled concurrency, token budget, and phase tracking.

**Execution Pipeline:**

```
User Task
  → LLM generates workflow script (meta + phases + agents)
    → Script validation (security: forbidden globals check)
    → VM sandbox execution
      → Phase-by-phase progress tracking
      → Concurrent agent execution (configurable concurrency limit)
      → Token budget enforcement
      → Structured output (JSON schema support)
  → Workflow snapshot (agents, phases, logs, status)
```

**Key capabilities:**
- LLM-generated execution scripts — no manual coding required
- Sandboxed `vm` execution with forbidden global protection
- Phase-based progress tracking with event callbacks
- Configurable token budget and max concurrent agents
- Structured output via JSON schema validation
- Abort support for long-running workflows

**Use cases:** Custom multi-step pipelines, batch processing, research workflows with sequential phases, automated report generation with custom logic

---

## Multi-Model Adaptive Routing

π Multi-Agent implements an intelligent model routing system that automatically assigns the most appropriate LLM to each task based on complexity analysis, required capabilities, and cost optimization.

### Architecture

```
                     ┌──────────────────────────────┐
                     │     ModelRegistry             │
                     │  (Provider + Model catalog)   │
                     └──────────┬───────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
    ┌─────────▼──────┐  ┌──────▼──────────┐  ┌───▼──────────┐
    │ ModelRouter    │  │ ModelAwareLLM   │  │ MultiModel   │
    │                │  │ Client          │  │ Client       │
    │ • Complexity   │  │ • chat()        │  │ • chat()     │
    │ • Tool support │  │ • plan()        │  │ • simple()   │
    │ • Specialty    │  │ • execute()     │  │              │
    │ • Cheapest     │  │ • evaluate()    │  │              │
    │                │  │ • simple()      │  │              │
    └────────────────┘  └─────────────────┘  └──────────────┘
```

### Routing Strategies

| Strategy | Description | Applied To |
|----------|-------------|------------|
| **Complexity-Based** | Routes based on task complexity hint (light / medium / heavy) | Default; used by all orchestration components |
| **Tool-Aware** | Prioritizes models with function calling capability | Sub-tasks requiring tool invocation |
| **Specialty-Match** | Selects models by capability tags (reasoning, coding, writing) | Agent-specific sub-tasks |
| **Cost-Optimized** | Selects the cheapest model that meets requirements | Low-priority, non-critical tasks |
| **Direct** | Uses explicitly specified model | User-overridden model selection |

### Model Selection by Execution Context

| Context | Complexity | Required Specialty | Selected Model Tier |
|---------|-----------|-------------------|-------------------|
| DeepPlanner (task decomposition) | Heavy | Reasoning, Planning | Large reasoning model |
| DeepEvaluator (quality assessment) | Heavy | Analysis | Large reasoning model |
| Agent execution (with tools) | Medium | Tool calling | Mid-tier with tool support |
| Agent execution (writing) | Medium | Writing | Mid-tier with writing capability |
| Simple chat / Q&A | Light | General | Lightweight, cost-optimized |
| Critical priority sub-task | Heavy | Any | Maximum capability |
| Low priority sub-task | Light | Any | Cost-optimized |

### Configuration

Create `models.config.ts` in the project root:

```typescript
// models.config.ts
import type { ModelProvidersConfig } from './src/models/config.js';

export const exampleModelProvidersConfig: ModelProvidersConfig = {
  providers: [
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
      isDefault: true,
    },
    // Add more providers: OpenAI, Anthropic, DashScope, etc.
  ],
  models: [
    {
      id: 'deepseek-chat',
      provider: 'deepseek',
      displayName: 'DeepSeek Chat',
      complexity: 'light',
      specialties: ['chat', 'general', 'planning'],
      tags: ['tools'],
      contextWindow: 64000,
      maxOutputTokens: 4096,
    },
    {
      id: 'deepseek-reasoner',
      provider: 'deepseek',
      displayName: 'DeepSeek Reasoner',
      complexity: 'heavy',
      specialties: ['reasoning', 'analysis'],
      contextWindow: 64000,
      maxOutputTokens: 4096,
    },
  ],
};
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        π Multi-Agent Framework                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────────┐  │
│  │  Deep Planner   │  │   Agent         │  │   Deep Evaluator       │  │
│  │  (LLM-Driven    │  │   Cluster       │  │   (4-Dim Quality       │  │
│  │   Task Decomp.) │  │   Executor      │  │    Assessment + Replan)│  │
│  └─────────────────┘  └─────────────────┘  └────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Enhanced Shared Memory                        │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐  │   │
│  │  │ Agent Outputs│  │  Session    │  │  Inter-Agent Messaging │  │   │
│  │  │ & Artifacts  │  │  Context    │  │  & Data Passing        │  │   │
│  │  └──────────────┘  └─────────────┘  └────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  6 Collaboration Patterns                        │   │
│  │  Sequential │ Parallel │ Debate │ Expert │ Critic │ Hierarchical│  │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Dynamic Workflow Engine                         │   │
│  │  LLM Script Generation → Sandboxed VM → Phase Tracking          │   │
│  │  Token Budget │ Concurrency Control │ Structured Output          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              Multi-Model Routing System                           │   │
│  │  ModelRegistry │ ModelRouter │ Complexity Estimator │ Adapters   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Tool System (Function Calling)                  │   │
│  │  web_search │ data_analyzer │ web_scraper │ code_executor        │   │
│  │  report_writer │ knowledge_base │ calculator │ agent_delegate   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8-Step Execution Lifecycle

```
[User Goal]
    │
    ▼
 1. Goal Definition
    Capture, validate, and classify task complexity
    │
    ▼
 2. Deep Planner (LLM-Driven)
    Decompose into structured sub-tasks with dependencies
    Assign agent roles, tools, and quality thresholds
    │
    ▼
 3. Model Routing
    Assign optimal model per sub-task
    (light / medium / heavy based on complexity, tools, priority)
    │
    ▼
 4. Agent Cluster Execution
    Spawn specialized agents, execute sub-tasks
    Real tool calling → Shared memory → Inter-agent data passing
    │
    ▼
 5. Deep Evaluator (4-Dimension Assessment)
    Accuracy · Completeness · Consistency · Format
    │
    ▼
 6. Quality Gate
    Score >= threshold? ──── Yes ──→ 8. Final Output
    │
    No
    ▼
 7. Replan & Retry
    Adjust strategy, re-execute failed sub-tasks
    (up to configurable max iterations)
    │
    ▼
 8. Final Output
    Synthesized report with full audit trail
```

---

## Quick Start

### Installation

```bash
npm install pi-multi-agent
```

### Prerequisites

- Node.js 18+
- A DeepSeek API key (or any OpenAI-compatible endpoint)

### 1. Configure Environment

```bash
# .env
DEEPSEEK_API_KEY=your-api-key
```

### 2. Run Deep Research (Agent Cluster)

```typescript
import { DeepPlanner, AgentCluster, ModelRegistry, loadModelProvidersConfig } from 'pi-multi-agent';

const registry = new ModelRegistry();
const config = loadModelProvidersConfig();
for (const p of config.providers) {
  if (p.apiKey) registry.registerProvider(p);
}
for (const m of config.models) {
  registry.registerModel(m);
}

const planner = new DeepPlanner({ registry });
const plan = await planner.createDeepPlan(
  'Complete a comprehensive AI Agent market research report',
  { targetWordCount: 30000, maxAgents: 8 }
);

const cluster = new AgentCluster({ registry }, 'session-1');
cluster.onEvent((event) => console.log(`[${event.type}]`, event.data));
const result = await cluster.executePlan(plan, 3);
```

### 3. Collaboration Modes

```typescript
import { LLMAgentCollaboration } from 'pi-multi-agent';

const collab = new LLMAgentCollaboration(apiKey, baseURL);

// Sequential: Researcher → Analyst → Writer
await collab.executeSequential(agents, task);

// Parallel: All agents work simultaneously
await collab.executeParallel(agents, task);

// Debate: Multi-round discussion for consensus
await collab.executeDebate(agents, topic, maxRounds);

// Expert Team: Domain specialists + integrator
await collab.executeExpertTeam(experts, task);

// Hierarchical: Supervisor → Subordinates → Synthesize
await collab.executeHierarchical(supervisor, subordinates, task);

// Critic-Reviewer: Create → Review → Iterate
await collab.executeCriticReviewer(creator, critic, task, maxRounds);
```

---

## 6 Collaboration Patterns

| Pattern | Description | Best For |
|---------|-------------|----------|
| **Sequential Handoffs** | Pipeline: Agent A → B → C | Structured workflows with clear stages |
| **Parallel Processing** | All agents work simultaneously | Independent multi-perspective tasks |
| **Debate & Consensus** | Multi-round discussion + moderator | Decision-making, strategy, consensus-building |
| **Expert Team** | Domain specialists + integrator | Complex multi-domain tasks |
| **Critic-Reviewer** | Create → Review → Iterate | Quality-critical content generation |
| **Hierarchical** | Supervisor → Subordinates → Synthesize | Large-scale task decomposition |

## 6 Communication Structures

| Structure | Description |
|-----------|-------------|
| **Single Agent** | Standalone execution, no inter-agent communication |
| **Network** | Decentralized peer-to-peer topology |
| **Supervisor** | Centralized management with task distribution |
| **Supervisor as Tool** | Advisory pattern, agents consult supervisor |
| **Hierarchical** | Multi-level management tree |
| **Custom** | User-defined topology and routing |

## Tool System

Agents invoke real tools via structured LLM function calling:

| Tool | Description |
|------|-------------|
| `web_search` | Internet search (DuckDuckGo API) |
| `data_analyzer` | Statistical analysis and data insights |
| `web_scraper` | Web content extraction |
| `code_executor` | Code snippet execution with result capture |
| `report_writer` | Report structuring and formatting |
| `knowledge_base` | Knowledge retrieval and querying |
| `calculator` | Mathematical computations |
| `agent_delegate` | Sub-task delegation to other agents |

Tool assignment is automatic per agent type:

```typescript
// Researcher → web_search, web_scraper, knowledge_base
// Analyst   → data_analyzer, calculator, knowledge_base
// Writer    → report_writer
// Coder     → code_executor, web_scraper
```

## Deep Evaluator

The evaluator applies a 4-dimensional quality assessment:

| Dimension | Assessment Focus |
|-----------|-----------------|
| **Accuracy** | Factual correctness, data validity, source reliability |
| **Completeness** | Topic coverage, depth, minimum thresholds met |
| **Consistency** | Logical coherence, cross-reference integrity |
| **Format** | Structure, readability, professional presentation |

When the composite score falls below the configured threshold, the system automatically triggers a replan-and-retry cycle with adjusted strategy.

---

## Web Dashboard

The bundled Next.js dashboard provides real-time visualization and control:

```bash
# Terminal 1: Start the backend API server
npm run server

# Terminal 2: Start the web dashboard
cd web && npm run dev
```

### Dashboard Capabilities

| Panel | Description |
|-------|-------------|
| **Agent Cluster** | Live agent status, sub-task progress, model usage |
| **Thread History** | Session management with restore and new session |
| **Plan Inspector** | Sub-task breakdown with dependencies and agent assignments |
| **Tool Call Log** | Every tool invocation with input, output, and duration |
| **Quality Dashboard** | Evaluation scores with per-dimension breakdown |
| **Report Viewer** | Final output with Markdown / HTML / TXT export |

---

## Dynamic Workflow API

```typescript
import { DynamicWorkflow } from 'pi-multi-agent';

const workflow = new DynamicWorkflow({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  tokenBudget: 200000,
  maxConcurrentAgents: 5,
});

workflow.onEvent((event) => {
  // workflow:started, phase:changed, agent:started,
  // agent:completed, agent:failed, workflow:completed
});

const result = await workflow.run(
  'Research AI market trends and generate a structured report with executive summary'
);

console.log(result.output);          // Structured output
console.log(result.snapshot);         // Full execution snapshot
console.log(result.totalTokens);      // Token consumption
```

---

## Project Structure

```
pi-multi-agent/
├── src/
│   ├── core/                          # Agent base, types, error hierarchy
│   │   ├── agent.ts                   # Agent lifecycle & execution engine
│   │   ├── types.ts                   # Core TypeScript type definitions
│   │   ├── errors.ts                  # Custom error hierarchy
│   │   └── message.ts                 # Message bus & event types
│   ├── orchestration/                 # Planning, execution, evaluation
│   │   ├── deep-planner.ts            # LLM-driven task decomposition
│   │   ├── agent-cluster.ts           # Cluster execution engine with model routing
│   │   ├── deep-evaluator.ts          # 4-dimension quality assessment
│   │   ├── orchestrator.ts            # Task scheduling & coordination
│   │   ├── planner.ts                 # Basic task planning
│   │   └── evaluator.ts               # Basic evaluation
│   ├── collaboration/                 # 6 collaboration patterns
│   │   ├── patterns.ts                # Core pattern implementations
│   │   └── llm-collaboration.ts       # LLM-powered collaboration orchestration
│   ├── communication/                 # 6 communication topologies
│   │   └── structures.ts              # Topology implementations
│   ├── memory/                        # Memory management
│   │   ├── memory.ts                  # Short-term + long-term memory
│   │   └── enhanced-shared-memory.ts  # Inter-agent shared memory
│   ├── models/                        # Multi-model routing system
│   │   ├── config.ts                  # Provider & Model type definitions
│   │   ├── registry.ts                # ModelRegistry — provider/model catalog
│   │   ├── router.ts                  # ModelRouter — 5 routing strategies
│   │   ├── client.ts                  # MultiModelClient — unified chat API
│   │   ├── loader.ts                  # Config loader (.ts / .json)
│   │   ├── adapter.ts                 # OpenAI-compatible provider adapter
│   │   ├── deepseek-compatible-client.ts  # DeepSeek API bridge
│   │   ├── complexity-estimator.ts    # Task complexity → model mapping
│   │   └── model-aware-client.ts      # High-level routing API for orchestration
│   └── tools/                         # Tool system
│       ├── index.ts                   # 8 core tools + agent-as-tool
│       └── agent-as-tool.ts           # Agent delegation via tool calling
├── workflow/                          # Dynamic workflow engine
│   ├── workflow.ts                    # Workflow definition & script generation
│   ├── runtime.ts                     # Sandboxed VM execution engine
│   ├── types.ts                       # Workflow type definitions
│   └── budget.ts                      # Token budget management
├── server/                            # Backend API server
│   ├── index.ts                       # Express + WebSocket server
│   └── session-store.ts               # File-based session persistence
├── web/                               # Next.js dashboard
│   └── src/app/page.tsx               # Real-time dashboard UI
├── examples/                          # Usage examples
│   ├── deep-research.ts               # Deep research (Agent Cluster)
│   └── collaboration-modes.ts         # All 6 collaboration patterns
├── models.config.ts                   # Multi-model configuration
├── models.config.example.ts           # Example config with all providers
└── package.json
```

---

## API Reference

### DeepPlanner

```typescript
const planner = new DeepPlanner({ registry? | apiKey?, baseURL?, strategy? });
const plan = await planner.createDeepPlan(goal, options?);
// options: { targetWordCount?: number, maxAgents?: number, depth?: number }
// Returns: DeepPlan { id, goal, subTasks, collaborationMode, qualityThresholds }
```

### AgentCluster

```typescript
const cluster = new AgentCluster({ registry?, apiKey?, baseURL? }, sessionId);
cluster.onEvent((event: ClusterEvent) => { /* WebSocket streaming */ });
const result = await cluster.executePlan(plan, maxIterations?);
// Returns: ClusterExecutionResult { success, finalOutput, evaluationScore,
//          iterations, totalTokensUsed, modelUsage, progress }
```

### LLMAgentCollaboration

```typescript
const collab = new LLMAgentCollaboration(apiKey, baseURL?);
await collab.executeSequential(agents, task);
await collab.executeParallel(agents, task);
await collab.executeDebate(agents, topic, maxRounds?);
await collab.executeHierarchical(supervisor, subordinates, task);
await collab.executeExpertTeam(experts, task);
await collab.executeCriticReviewer(creator, critic, task, maxRounds?);
```

### ModelRegistry

```typescript
const registry = new ModelRegistry();
registry.registerProvider({ id, displayName, baseURL, apiKey, isDefault? });
registry.registerModel({ id, provider, complexity, specialties, tags?, ... });
registry.getClient(providerId);              // Get cached OpenAI client
registry.getClientForModel(modelId);         // Get client for a specific model
registry.getDefaultProvider();               // Get default provider
registry.listModels();                       // All registered models
registry.listModelsByComplexity('heavy');    // Filter by complexity
```

### DynamicWorkflow

```typescript
const workflow = new DynamicWorkflow({ apiKey, baseURL?, model?, tokenBudget?, maxConcurrentAgents? });
workflow.onEvent(callback);
const result = await workflow.run(taskDescription, args?);
// Returns: WorkflowResult { success, output, snapshot, totalTokens, totalExecutionTime }
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key for LLM calls |
| `DEEPSEEK_BASE_URL` | No | Custom API base URL (default: `https://api.deepseek.com`) |
| `OPENAI_API_KEY` | Optional | OpenAI API key (if using GPT models) |
| `ANTHROPIC_API_KEY` | Optional | Anthropic API key (if using Claude models) |
| `PORT` | No | Server port (default: 3001) |
| `PI_MULTI_AGENT_DATA_DIR` | No | Session persistence directory |
| `PI_MULTI_AGENT_RUNNING_SESSION_TIMEOUT_MS` | No | Running session timeout (default: 10 min) |

---

## Development

```bash
# Install dependencies
npm install

# Build the framework
npm run build

# Run type checking
npm run typecheck

# Run tests
npm run test

# Start backend server (port 3001)
npm run server

# Start web dashboard (port 3000)
npm run dev:web

# Start both simultaneously
npm run dev:full
```

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on development setup, pull request process, coding standards, and testing guidelines.

## Community

- **B 站 (Bilibili)** — AI 技术深度解析与实战教程
- **视频号 (WeChat Video)** — AI 前沿动态与产品评测
- **公众号 (WeChat Official Account)** — AI 技术文章与行业洞察
- **YouTube** — AI tutorials and open-source project walkthroughs

## License

[MIT](LICENSE) © Pi Multi-Agent Contributors
# IM
