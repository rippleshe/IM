import OpenAI from 'openai';
import { SessionId, TaskId, ToolDefinition, ToolExecutionContext } from '../core/index.js';
import { DeepPlan, SubTask } from '../orchestration/deep-planner.js';
import { DeepEvaluator } from '../orchestration/deep-evaluator.js';
import { getToolsForAgentType, ALL_TOOLS, createAgentAsTool } from '../tools/index.js';
import { EnhancedSharedMemory } from '../memory/enhanced-shared-memory.js';
import type { ModelRegistry } from '../models/registry.js';
import { ModelAwareLLMClient } from '../models/model-aware-client.js';
import { type TaskComplexityHint } from '../models/config.js';

export interface AgentClusterOptions {
  apiKey?: string;
  baseURL?: string;
  registry?: ModelRegistry;
}

export interface AgentClusterProgress {
  taskId: string;
  taskTitle: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  progress: number;
  startTime?: number;
  endTime?: number;
  outputLength?: number;
  toolCalls?: ToolCallRecord[];
  modelUsed?: string;
  error?: string;
}

export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  duration: number;
  success: boolean;
}

export interface ClusterExecutionResult {
  success: boolean;
  plan: DeepPlan;
  progress: AgentClusterProgress[];
  finalOutput: string;
  totalExecutionTime: number;
  totalTokensUsed: number;
  evaluationScore: number;
  iterations: number;
  modelUsage: Record<string, { tasks: number; tokens: number }>;
}

export interface ClusterEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'agent_thinking' | 'agent_response' | 'tool_call' | 'tool_result' | 'evaluation' | 'iteration_complete' | 'agent_created' | 'plan_updated' | 'model_selected';
  taskId?: string;
  agentName?: string;
  data: unknown;
  timestamp: number;
}

type EventCallback = (event: ClusterEvent) => void;

function convertToolsToOpenAIFormat(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      const schema = tool.inputSchema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
      if (schema.properties) {
        for (const [key, val] of Object.entries(schema.properties)) {
          properties[key] = { type: val.type || 'string', description: val.description || '' };
        }
      }
      if (schema.required) required.push(...schema.required);
    }
    return { type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: { type: 'object' as const, properties, required } } } as OpenAI.Chat.ChatCompletionTool;
  });
}

export class AgentCluster {
  private llmClient: OpenAI;
  private modelAware: ModelAwareLLMClient | null = null;
  private sessionId: string;
  private progress: Map<string, AgentClusterProgress> = new Map();
  private results: Map<string, string> = new Map();
  private eventCallbacks: EventCallback[] = [];
  private totalTokens = 0;
  private currentPlan: DeepPlan | null = null;
  private toolInstances: Map<string, ToolDefinition<unknown, unknown>> = new Map();
  private apiKey: string;
  private baseURL: string;
  private deepEvaluator: DeepEvaluator;
  public sharedMemory: EnhancedSharedMemory;
  private lastEvaluation: { overallScore: number } | null = null;

  private buildLLM(options: { apiKey: string; baseURL: string; registry?: ModelRegistry }): OpenAI {
    if (options.registry) {
      this.modelAware = new ModelAwareLLMClient({ registry: options.registry });
      const defaultProvider = options.registry.getDefaultProvider();
      if (defaultProvider) {
        const client = options.registry.getClient(defaultProvider.id);
        if (client) return client;
      }
      const firstModel = options.registry.listModels()[0];
      if (firstModel) {
        const client = options.registry.getClient(firstModel.provider);
        if (client) return client;
      }
    }
    return new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  constructor(
    first: string | AgentClusterOptions,
    second: string,
    third?: string
  ) {
    let apiKey = '';
    let sessionId = '';
    let baseURL = 'https://api.deepseek.com';
    let registry: ModelRegistry | undefined;

    if (typeof first === 'string') {
      apiKey = first;
      sessionId = second;
      baseURL = third ?? baseURL;
    } else {
      apiKey = first.apiKey ?? '';
      baseURL = first.baseURL ?? baseURL;
      registry = first.registry;
      sessionId = second;
    }

    this.llmClient = this.buildLLM({ apiKey, baseURL, registry });
    this.sessionId = sessionId;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.deepEvaluator = registry ? new DeepEvaluator({ registry }) : new DeepEvaluator(apiKey, baseURL);
    this.sharedMemory = new EnhancedSharedMemory(sessionId as SessionId);
    this.initializeToolInstances();
  }

  private initializeToolInstances(): void {
    for (const [name, factory] of Object.entries(ALL_TOOLS)) {
      if (typeof factory === 'function') {
        try { this.toolInstances.set(name, factory() as ToolDefinition<unknown, unknown>); } catch {}
      }
    }
    this.toolInstances.set('agent_delegate', createAgentAsTool(this.apiKey || '', this.baseURL) as ToolDefinition<unknown, unknown>);
  }

  onEvent(callback: EventCallback): void { this.eventCallbacks.push(callback); }

  private emitEvent(type: ClusterEvent['type'], data: unknown, taskId?: string, agentName?: string): void {
    const event: ClusterEvent = { type, taskId, agentName, data, timestamp: Date.now() };
    for (const cb of this.eventCallbacks) { try { cb(event); } catch {} }
  }

  getSelectedModelForSubTask(subTask: SubTask): { modelId: string; providerId: string } | null {
    if (!this.modelAware) return null;
    return this.modelAware.selectModelForSubTask(this.modelAware.getRegistry(), {
      priority: subTask.priority,
      tools: subTask.tools,
      assignedAgentType: subTask.assignedAgentType,
    });
  }

  async executePlan(plan: DeepPlan, maxIterations: number = 3): Promise<ClusterExecutionResult> {
    const startTime = Date.now();
    let iteration = 0;
    let currentPlan = plan;
    this.currentPlan = plan;
    let evaluationScore = 0;
    const modelUsage: Record<string, { tasks: number; tokens: number }> = {};

    this.sharedMemory.setGoal(plan.goal);
    this.sharedMemory.setPhase('executing');
    this.emitEvent('plan_updated', { planId: plan.id, goal: plan.goal, subTaskCount: plan.subTasks.length, collaborationMode: plan.collaborationMode });

    for (const task of plan.subTasks) {
      this.progress.set(task.id, { taskId: task.id, taskTitle: task.title, agentName: task.assignedAgentName, status: 'pending', progress: 0, toolCalls: [] });
      const selection = this.getSelectedModelForSubTask(task);
      if (selection) {
        const progressEntry = this.progress.get(task.id);
        if (progressEntry) progressEntry.modelUsed = selection.modelId;
        const existing = modelUsage[selection.modelId];
        modelUsage[selection.modelId] = { tasks: (existing?.tasks ?? 0) + 1, tokens: existing?.tokens ?? 0 };
        this.emitEvent('model_selected', { modelId: selection.modelId, providerId: selection.providerId, taskId: task.id, priority: task.priority, tools: task.tools }, task.id, task.assignedAgentName);
      }
      this.emitEvent('agent_created', { agentName: task.assignedAgentName, agentType: task.assignedAgentType, tools: task.tools, taskTitle: task.title }, task.id, task.assignedAgentName);
      this.sharedMemory.registerAgent(task.assignedAgentName as any, task.assignedAgentName, task.assignedAgentType);
      this.sharedMemory.addPendingTask(task.id as TaskId);
    }

    while (iteration < maxIterations) {
      this.emitEvent('iteration_complete', { iteration, totalTasks: currentPlan.subTasks.length });
      const iterationResults = await this.executeIteration(currentPlan);
      evaluationScore = this.evaluateIterationResults(iterationResults, currentPlan);
      this.emitEvent('evaluation', { score: evaluationScore, iteration });
      if (evaluationScore >= 0.8) break;
      iteration++;
      currentPlan = await this.replanForIteration(currentPlan, evaluationScore, iterationResults);
      this.currentPlan = currentPlan;
    }

    const finalOutput = await this.synthesizeResults(currentPlan);
    const evalResult = await this.deepEvaluator.evaluate(finalOutput, plan.goal, {
      targetWordCount: plan.qualityThresholds?.minWordCount || 30000,
      minSections: plan.qualityThresholds?.minSections || 5,
      requireDataSupport: plan.qualityThresholds?.requireDataSupport ?? true,
      requireReferences: plan.qualityThresholds?.requireReferences ?? true,
      passThreshold: 0.7,
    });
    this.lastEvaluation = { overallScore: evalResult.overallScore };
    const deepEvalScore = this.lastEvaluation.overallScore;
    if (deepEvalScore > evaluationScore) evaluationScore = deepEvalScore;

    this.emitEvent('evaluation', {
      score: evaluationScore, deepScore: deepEvalScore,
      dimensions: evalResult.dimensions as unknown as Array<{ name: string; score: number; passed: boolean; feedback: string }>,
      strengths: evalResult.strengths, weaknesses: evalResult.weaknesses, suggestions: evalResult.suggestions,
    });

    return {
      success: evaluationScore >= 0.6, plan: currentPlan, progress: Array.from(this.progress.values()),
      finalOutput, totalExecutionTime: Date.now() - startTime, totalTokensUsed: this.totalTokens, evaluationScore, iterations: iteration + 1, modelUsage,
    };
  }

  private async executeIteration(plan: DeepPlan): Promise<Map<string, string>> {
    const iterationResults = new Map<string, string>();
    const completedTasks = new Set<string>();
    const maxRounds = plan.subTasks.length + 2;
    let round = 0;

    while (completedTasks.size < plan.subTasks.length && round < maxRounds) {
      const readyTasks = plan.subTasks.filter((task) => {
        if (completedTasks.has(task.id)) return false;
        return task.dependencies.length === 0 || task.dependencies.every((d) => completedTasks.has(d));
      });
      if (readyTasks.length === 0) {
        for (const t of plan.subTasks.filter((t) => !completedTasks.has(t.id))) completedTasks.add(t.id);
        break;
      }
      const tasksToExecute = readyTasks.slice(0, 5);
      const settled = await Promise.allSettled(tasksToExecute.map((t) => this.executeSubTaskWithTools(t, iterationResults)));
      for (let i = 0; i < settled.length; i++) {
        const task = tasksToExecute[i]!;
        const result = settled[i]!;
        if (result.status === 'fulfilled') { iterationResults.set(task.id, result.value); completedTasks.add(task.id); }
        else { const err = String(result.reason); this.updateProgress(task.id, 'failed', 0, undefined, err); iterationResults.set(task.id, `[任务失败: ${err}]`); completedTasks.add(task.id); }
      }
      round++;
    }
    this.results = iterationResults;
    return iterationResults;
  }

  private resolveComplexityHint(task: SubTask): TaskComplexityHint | undefined {
    if (!this.modelAware) return undefined;
    const registry = this.modelAware.getRegistry();
    const selection = this.modelAware.selectModelForSubTask(registry, { priority: task.priority, tools: task.tools, assignedAgentType: task.assignedAgentType });
    const progressEntry = this.progress.get(task.id);
    if (progressEntry) progressEntry.modelUsed = selection.modelId;
    const model = registry.getModel(selection.modelId);
    return { complexity: (model?.complexity ?? 'medium') as TaskComplexityHint['complexity'], requiredSpecialties: model?.specialties as TaskComplexityHint['requiredSpecialties'] | undefined, requiresTools: (task.tools?.length ?? 0) > 0, requiresStreaming: false };
  }

  private async executeLLMCall(
    messages: { role: string; content: string }[],
    opts: { tools?: OpenAI.Chat.ChatCompletionTool[]; complexityHint?: TaskComplexityHint; temperature?: number; maxTokens?: number } = {}
  ): Promise<{ text: string; toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    if (this.modelAware && opts.tools && opts.tools.length > 0) {
      const registry = this.modelAware.getRegistry();
      const models = registry.listModels();
      const modelId = models.find((m) => m.tags?.includes('tools'))?.id ?? models[0]?.id ?? 'deepseek-chat';
      const client = registry.getClientForModel(modelId);
      if (client) {
        const response = await client.chat.completions.create({ model: modelId, messages: messages as any, tools: opts.tools, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 4096 });
        const choice = response.choices[0];
        return { text: choice?.message?.content || '', toolCalls: choice?.message?.tool_calls, usage: response.usage ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens } : undefined };
      }
    }
    if (this.modelAware) {
      const result = await this.modelAware.execute({ messages, complexityHint: opts.complexityHint, temperature: opts.temperature, maxTokens: opts.maxTokens });
      return { text: result.text, usage: result.usage ? { prompt_tokens: result.usage.promptTokens, completion_tokens: result.usage.completionTokens, total_tokens: result.usage.totalTokens } : undefined };
    }
    const response = await this.llmClient.chat.completions.create({ model: 'deepseek-chat', messages: messages as any, tools: opts.tools, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 4096 });
    const choice = response.choices[0];
    return { text: choice?.message?.content || '', toolCalls: choice?.message?.tool_calls, usage: response.usage ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens } : undefined };
  }

  private async executeSubTaskWithTools(task: SubTask, previousResults: Map<string, string>): Promise<string> {
    this.updateProgress(task.id, 'running', 10);
    this.emitEvent('task_started', { task: task.title, agentType: task.assignedAgentType, tools: task.tools }, task.id, task.assignedAgentName);

    const agentTools = this.getToolDefinitions(task);
    const contextInput = this.buildTaskInput(task, previousResults);
    const complexityHint = this.resolveComplexityHint(task);

    const rawMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: task.assignedAgentPrompt }];
    if (agentTools.length > 0) {
      rawMessages.push({ role: 'system', content: `你拥有以下工具可以使用:\n${agentTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}\n\n请根据任务需要主动调用工具获取真实数据和信息。` });
    }
    rawMessages.push({ role: 'user', content: contextInput });

    const openaiTools = agentTools.length > 0 ? convertToolsToOpenAIFormat(agentTools) : undefined;
    const toolCallRecords: ToolCallRecord[] = [];
    let finalText = '';
    let maxToolRounds = 5;
    const currentMessages: { role: string; content: string; tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[] }[] = rawMessages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));

    try {
      while (maxToolRounds > 0) {
        this.emitEvent('agent_thinking', { round: 6 - maxToolRounds, messageCount: currentMessages.length }, task.id, task.assignedAgentName);
        const result = await this.executeLLMCall(currentMessages, { tools: openaiTools, complexityHint, maxTokens: 4096 });
        if (result.usage) this.totalTokens += result.usage.total_tokens;

        const assistantMsg: typeof currentMessages[0] = { role: 'assistant', content: result.text ?? '' };
        if (result.toolCalls?.length) assistantMsg.tool_calls = result.toolCalls;
        currentMessages.push(assistantMsg);

        if (!result.toolCalls || result.toolCalls.length === 0) { finalText = result.text; break; }

        for (const toolCall of result.toolCalls) {
          if (toolCall.type !== 'function') continue;
          const fc = toolCall as { id: string; function: { name: string; arguments: string } };
          const toolName = fc.function.name;
          const toolInput = JSON.parse(fc.function.arguments || '{}');
          this.emitEvent('tool_call', { toolName, input: toolInput }, task.id, task.assignedAgentName);

          const t0 = Date.now();
          let toolOutput = '';
          let toolSuccess = false;
          try {
            const toolDef = this.toolInstances.get(toolName);
            if (toolDef?.execute) {
              const ctx: ToolExecutionContext = { sessionId: this.sessionId as SessionId, taskId: task.id as TaskId, agentId: task.assignedAgentName, metadata: {} };
              const r = await toolDef.execute(toolInput, ctx);
              toolOutput = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
              toolSuccess = true;
            } else { toolOutput = `工具 ${toolName} 未找到，请基于已有知识完成任务。`; }
          } catch (err) { toolOutput = `工具调用错误: ${err instanceof Error ? err.message : String(err)}`; }

          toolCallRecords.push({ toolName, input: toolInput, output: toolOutput.substring(0, 2000), duration: Date.now() - t0, success: toolSuccess });
          this.emitEvent('tool_result', { toolName, success: toolSuccess, duration: Date.now() - t0, outputLength: toolOutput.length }, task.id, task.assignedAgentName);
          currentMessages.push({ role: 'tool', tool_call_id: fc.id, content: toolOutput.substring(0, 4000) } as typeof currentMessages[0]);
        }
        maxToolRounds--;
        this.updateProgress(task.id, 'running', Math.min(90, 10 + (6 - maxToolRounds) * 18), undefined, undefined, toolCallRecords);
      }

      if (!finalText) {
        const finalResult = await this.executeLLMCall([...currentMessages, { role: 'user', content: '请基于以上所有工具调用结果和已有信息，完成你的任务。输出完整的、结构化的、专业的分析报告。' }], { complexityHint, maxTokens: 4096 });
        finalText = finalResult.text;
        if (finalResult.usage) this.totalTokens += finalResult.usage.total_tokens;
      }

      this.updateProgress(task.id, 'completed', 100, finalText.length, undefined, toolCallRecords);
      this.emitEvent('task_completed', { outputLength: finalText.length, toolCallCount: toolCallRecords.length }, task.id, task.assignedAgentName);
      this.sharedMemory.storeAgentOutput(task.id as TaskId, { agentId: task.assignedAgentName as any, agentName: task.assignedAgentName, taskId: task.id as TaskId, output: finalText, timestamp: Date.now(), tags: [task.assignedAgentType, task.priority], metadata: { toolCallCount: toolCallRecords.length } });
      this.sharedMemory.updateAgentStatus(task.assignedAgentName as any, 'completed');
      return finalText;
    } catch (error) {
      this.emitEvent('task_failed', { error: String(error) }, task.id, task.assignedAgentName);
      throw error;
    }
  }

  private getToolDefinitions(task: SubTask): ToolDefinition<unknown, unknown>[] {
    const tools: ToolDefinition<unknown, unknown>[] = [];
    for (const name of task.tools) { const def = this.toolInstances.get(name); if (def) tools.push(def); }
    return tools.length > 0 ? tools : (getToolsForAgentType(task.assignedAgentType) as ToolDefinition<unknown, unknown>[]);
  }

  private buildTaskInput(task: SubTask, previousResults: Map<string, string>): string {
    let input = `## 任务: ${task.title}\n\n## 任务描述\n${task.description}\n\n## 期望输出\n${task.expectedOutput}\n\n`;
    if (task.dependencies.length > 0 && previousResults.size > 0) {
      input += `## 前置任务结果\n\n`;
      for (const depId of task.dependencies) {
        const depResult = previousResults.get(depId);
        if (depResult) { const depTask = this.findTaskById(depId); input += `### ${depTask?.title || depId}\n${depResult.substring(0, 3000)}\n\n`; }
      }
    }
    const sharedContext = this.sharedMemory.buildContextForAgent(task.assignedAgentName as any, task.id as TaskId);
    if (sharedContext.length > 100) input += `## 共享上下文\n${sharedContext}\n\n`;
    input += `\n请完成以上任务。如果需要搜索信息、分析数据或获取资料，请主动调用可用工具。确保输出详细、专业、有数据支撑，字数不少于2000字。`;
    return input;
  }

  private findTaskById(taskId: string): SubTask | undefined { return this.currentPlan?.subTasks.find((t) => t.id === taskId); }

  private updateProgress(taskId: string, status: AgentClusterProgress['status'], progress: number, outputLength?: number, error?: string, toolCalls?: ToolCallRecord[]): void {
    const existing = this.progress.get(taskId);
    this.progress.set(taskId, { taskId, taskTitle: existing?.taskTitle || taskId, agentName: existing?.agentName || '', status, progress, startTime: existing?.startTime || (status === 'running' ? Date.now() : undefined), endTime: status === 'completed' || status === 'failed' ? Date.now() : undefined, outputLength: outputLength ?? existing?.outputLength, toolCalls: toolCalls || existing?.toolCalls, error, modelUsed: existing?.modelUsed });
  }

  private evaluateIterationResults(results: Map<string, string>, plan: DeepPlan): number {
    let totalScore = 0, taskCount = 0;
    for (const task of plan.subTasks) {
      const result = results.get(task.id);
      if (!result) continue;
      taskCount++;
      let score = 0;
      const len = result.length;
      if (len >= 2000) score += 0.25; else if (len >= 1000) score += 0.15; else if (len >= 500) score += 0.08;
      if (/\d+%|\d+亿|\d+万|\$|¥|增长率|市场份额/.test(result)) score += 0.2;
      if (/#{1,3}\s|一、|二、|\d+\./.test(result)) score += 0.15;
      if (/来源|引用|参考|报告/.test(result)) score += 0.1;
      if (this.progress.get(task.id)?.toolCalls?.length) score += 0.15;
      if (!/我不知道|无法回答|抱歉/.test(result)) score += 0.15;
      totalScore += Math.min(1, score);
    }
    return taskCount > 0 ? totalScore / taskCount : 0;
  }

  private async replanForIteration(currentPlan: DeepPlan, _score: number, results: Map<string, string>): Promise<DeepPlan> {
    const weakTasks = currentPlan.subTasks.filter((t) => !results.get(t.id) || results.get(t.id)!.length < 500);
    if (weakTasks.length > 0) {
      try {
        await this.executeLLMCall([{ role: 'system', content: '你是任务规划优化专家。分析失败原因并给出改进建议。返回JSON格式。' }, { role: 'user', content: `以下任务执行结果不达标：\n${weakTasks.map((t) => `- ${t.title}: ${results.get(t.id)?.substring(0, 200) || '无输出'}`).join('\n')}\n请返回JSON格式改进建议。` }], { complexityHint: { complexity: 'medium', requiresTools: false }, maxTokens: 2048 });
      } catch {}
    }
    return { ...currentPlan, subTasks: currentPlan.subTasks.map((task) => {
      const result = results.get(task.id);
      const isWeak = !result || result.length < 500;
      return { ...task, assignedAgentPrompt: isWeak ? `${task.assignedAgentPrompt}\n\n【重要】上一轮输出不够详细。你必须：1) 主动调用工具搜索真实数据；2) 输出至少2000字；3) 包含具体数据、案例分析和专业洞察。` : task.assignedAgentPrompt, priority: isWeak ? 'high' : task.priority };
    })};
  }

  private async synthesizeResults(plan: DeepPlan): Promise<string> {
    let output = `# ${plan.goal}\n\n> 本报告由 IM-Training-Agent 系统自动生成\n> 协作模式: ${plan.collaborationMode} | 通信结构: ${plan.communicationStructure}\n> 生成时间: ${new Date().toLocaleString('zh-CN')}\n> Agent数量: ${plan.subTasks.length} | 总Token消耗: ${this.totalTokens}\n\n---\n\n`;
    output += `## 目录\n\n${plan.subTasks.map((t, i) => `${i + 1}. [${t.assignedAgentName}] ${t.title}`).join('\n')}\n\n---\n\n`;
    for (const task of plan.subTasks) {
      const result = this.results.get(task.id);
      const taskProgress = this.progress.get(task.id);
      const tcCount = taskProgress?.toolCalls?.length || 0;
      output += `## ${task.title}\n\n*执行者: ${task.assignedAgentName} (${task.assignedAgentType}) | 优先级: ${task.priority} | 工具调用: ${tcCount}次${taskProgress?.modelUsed ? ` | 模型: ${taskProgress.modelUsed}` : ''}*\n\n`;
      if (taskProgress?.toolCalls?.length) {
        output += `<details><summary>工具调用记录 (${tcCount}次)</summary>\n\n`;
        for (const tc of taskProgress.toolCalls!) { output += `- **${tc.toolName}** ${tc.success ? '成功' : '失败'} (${tc.duration}ms)\n`; }
        output += `</details>\n\n`;
      }
      output += `${result || '(无输出)'}\n\n---\n\n`;
    }
    output += `## 附录\n\n| 指标 | 值 |\n|---|---|\n| 总任务数 | ${plan.subTasks.length} |\n| 总Token消耗 | ${this.totalTokens} |\n| 协作模式 | ${plan.collaborationMode} |\n| 通信结构 | ${plan.communicationStructure} |\n| 工具调用总次数 | ${Array.from(this.progress.values()).reduce((s, p) => s + (p.toolCalls?.length || 0), 0)} |\n\n### Agent执行详情\n\n| Agent | 任务 | 状态 | 输出长度 | 工具调用 | 模型 |\n|---|---|---|---|---|---|\n`;
    for (const task of plan.subTasks) { const p = this.progress.get(task.id); output += `| ${task.assignedAgentName} | ${task.title.substring(0, 20)} | ${p?.status || 'unknown'} | ${p?.outputLength || 0} | ${p?.toolCalls?.length || 0} | ${p?.modelUsed || 'default'} |\n`; }
    return output;
  }

  getProgress(): AgentClusterProgress[] { return Array.from(this.progress.values()); }
}

