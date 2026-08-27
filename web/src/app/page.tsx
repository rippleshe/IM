// Legacy workbench code remains below while the authenticated product shell is migrated page by page.
// @ts-nocheck
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { resolveAutoExecution } from "@/lib/execution-mode";
import { getRestoreMessage } from "@/lib/session-restore-message";
import { AuthEntry, type AuthenticatedUser } from "@/components/auth-entry";
import { LearningPathWorkbench } from "@/components/learning-path-workbench";
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  Zap,
  Plus,
  Activity,
  FileText,
  Users,
  Radio,
  Target,
  Clock,
  History,
  BarChart3,
  Wrench,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Download,
  ArrowRight,
  RefreshCw,
  MessageCircle,
  Settings,
  Paperclip,
} from "lucide-react";

const API_BASE = "http://localhost:3001";
const WS_HOST = "localhost:3001";
const MODE_LABELS: Record<string, string> = {
  auto: "自动",
  deep: "深度协同",
  workflow: "工作流",
  sequential: "串行协作",
  parallel: "并行协作",
  expert_team: "专家组",
};
const MODE_DESCRIPTIONS: Record<string, string> = {
  auto: "自动判断任务复杂度并选择协同方式",
  deep: "拆解任务、分工执行并进行多轮审核",
  workflow: "生成可执行流程并实时展示阶段进度",
  sequential: "多个角色按顺序接力完成任务",
  parallel: "多个角色并行分析后统一汇总",
  expert_team: "领域专家共同分析并交叉判断",
};
const MODE_OPTIONS = [
  { key: "auto", label: "自动" },
  { key: "deep", label: "深度协同" },
  { key: "workflow", label: "工作流" },
  { key: "sequential", label: "串行协作" },
  { key: "parallel", label: "并行协作" },
  { key: "expert_team", label: "专家组" },
] as const;

type LearningAgentSpec = { id: string; name: string; type: string; systemPrompt: string; specialty: string };
type AgentRoute = { modelId: string; thinkingDepth: "inherit" | ThinkingDepth };

const AGENT_ROUTE_LABELS: Array<Pick<LearningAgentSpec, "id" | "name" | "specialty">> = [
  { id: "learning_planning", name: "学情与路径智能体", specialty: "学情诊断 · 任务拆解 · 路径决策" },
  { id: "evidence_retrieval", name: "知识检索智能体", specialty: "CSV 查询 · PDF 检索" },
  { id: "domain_expert", name: "领域诊断智能体", specialty: "设备机理 · 风险判断" },
  { id: "resource_generation", name: "资源生成智能体", specialty: "讲义 · 分层习题 · 知识图谱" },
  { id: "cross_validation", name: "交叉验证智能体", specialty: "证据核验 · Claim 审核" },
  { id: "privacy_compliance", name: "合规隐私智能体", specialty: "上传边界 · 隐私核查" },
];

const LEARNING_AGENT_SPECS: Record<string, LearningAgentSpec> = {
  learning_planning: { id: "learning_planning", name: "学情与路径智能体", type: "planner", systemPrompt: "你负责根据学习目标、已有学习证据和时间约束，完成学情诊断、任务拆解、资源选择与动态路径决策。不要凭普通聊天臆测能力。", specialty: "学情诊断 · 路径决策" },
  evidence_retrieval: { id: "evidence_retrieval", name: "知识检索智能体", type: "retriever", systemPrompt: "你负责区分结构化数据查询和领域文档检索，为每个判断保留来源定位、可信度和不确定性。", specialty: "证据检索" },
  domain_expert: { id: "domain_expert", name: "领域专家智能体", type: "expert", systemPrompt: "你负责依据领域证据解释工业空气压缩机的传感器、状态和故障判断边界，不得把风险说成确定故障。", specialty: "领域判断" },
  resource_generation: { id: "resource_generation", name: "资源生成智能体", type: "generator", systemPrompt: "你负责根据任务规范、学习状态和证据生成讲义、分层习题、实训或知识图谱，输出结构清晰、可学习的内容。", specialty: "资源生成" },
  cross_validation: { id: "cross_validation", name: "交叉验证智能体", type: "critic", systemPrompt: "你是审核裁判。逐条核对生成内容与 CSV/PDF 证据，检查数字、单位、阈值、步骤和引用；证据不足必须标记复核或拒绝发布。", specialty: "交叉验证" },
  privacy_compliance: { id: "privacy_compliance", name: "合规审计智能体", type: "compliance", systemPrompt: "你负责检查上传资料和学习画像的使用边界，禁止把临时参考资料写入公共知识库或无依据改变学习能力判断。", specialty: "合规隐私" },
};

const MODE_AGENT_IDS: Record<string, string[]> = {
  sequential: AGENT_ROUTE_LABELS.map((agent) => agent.id),
  parallel: AGENT_ROUTE_LABELS.map((agent) => agent.id),
  expert_team: AGENT_ROUTE_LABELS.map((agent) => agent.id),
};

function selectLearningAgents(mode: string): LearningAgentSpec[] {
  const ids = MODE_AGENT_IDS[mode] ?? MODE_AGENT_IDS.sequential;
  return ids.map((id) => LEARNING_AGENT_SPECS[id]).filter(Boolean);
}

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
  reason?: string;
  state?: string;
  tools?: string[];
  assignedTask?: string;
  priority?: string;
}

interface SubTaskInfo {
  id: string;
  title: string;
  description?: string;
  assignedAgentName: string;
  assignedAgentType: string;
  dependencies: string[];
  priority: string;
  tools: string[];
  expectedOutput?: string;
  status?: "pending" | "running" | "completed" | "failed" | "retrying";
  progress?: number;
  output?: string;
  outputLength?: number;
  startTime?: number;
  endTime?: number;
  error?: string;
}

interface PlanInfo {
  id: string;
  goal: string;
  subTaskCount: number;
  collaborationMode: string;
  communicationStructure?: string;
  executionStrategy?: string;
  subTasks: SubTaskInfo[];
  successCriteria?: string[];
  qualityThresholds?: {
    minWordCount: number;
    minSections: number;
    requireDataSupport: boolean;
    requireReferences: boolean;
  };
}

interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  validation?: { pattern?: string; message?: string };
}

interface ActionButton {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  submit?: boolean;
}

interface HumanInLoopMessage {
  taskId: string;
  stepId: string;
  status: "WAITING_INPUT" | "CONFIRMATION" | "PROCESSING" | "COMPLETED" | "ERROR";
  uiSchema?: {
    type: "form" | "confirm-card" | "selection-list";
    title?: string;
    description?: string;
    fields?: FormField[];
    actions?: ActionButton[];
  };
  contextHint?: string;
  defaultValues?: Record<string, any>;
}

interface ChatMessage {
  id: string;
  type: "user" | "agent" | "system" | "tool_call" | "tool_result" | "evaluation" | "result" | "human_input";
  agentName?: string;
  agentId?: string;
  text: string;
  timestamp: number;
  thinking?: boolean;
  toolCall?: string;
  toolResult?: string;
  toolInput?: Record<string, unknown>;
  toolDuration?: number;
  toolSuccess?: boolean;
  detail?: string;
  evaluationData?: {
    score: number;
    deepScore?: number;
    dimensions?: Array<{ name: string; score: number; passed: boolean; feedback: string }>;
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
  };
  resultData?: {
    content: string;
    length: number;
    tokens: number;
    mode: string;
    agentCount: number;
  };
  hilData?: HumanInLoopMessage;
}

interface ExecutionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  totalTokens: number;
  executionTime: number;
  evaluationScore: number;
  iterations: number;
  finalOutputLength: number;
}

interface SessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "completed" | "failed";
  mode?: string;
  task?: string;
  finalOutputLength: number;
  evaluationScore?: number;
  iterations?: number;
  error?: string;
}

interface PersistedSessionDetail extends SessionSummary {
  plan?: PlanInfo;
  result?: {
    success: boolean;
    finalOutput: string;
    totalExecutionTime: number;
    totalTokensUsed: number;
    evaluationScore: number;
    iterations: number;
    progress?: Array<{
      taskId: string;
      status: "pending" | "running" | "completed" | "failed" | "retrying";
      progress: number;
      outputLength?: number;
      error?: string;
    }>;
  };
  workflowResult?: {
    success: boolean;
    output: unknown;
    totalTokens: number;
    totalExecutionTime: number;
    snapshot?: unknown;
    error?: string;
  };
}

const AGENT_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  normal: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  low: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {};

function getAgentInitial(name: string): string {
  const chars = name.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "");
  if (/[\u4e00-\u9fa5]/.test(chars)) return chars.substring(0, 1);
  return chars.substring(0, 2).toUpperCase();
}

function LearningRadar({ items }: { items: LearningRadarItem[] }) {
  const points = items.slice(0, 5);
  if (points.length < 3) return <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">完成一次学习任务后生成能力雷达</div>;
  const center = 52;
  const radius = 36;
  const angle = (index: number) => -Math.PI / 2 + (index * Math.PI * 2) / points.length;
  const point = (index: number, scale = 1) => {
    const current = angle(index);
    return `${center + Math.cos(current) * radius * scale},${center + Math.sin(current) * radius * scale}`;
  };
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 104 104" className="h-32 w-32 shrink-0" aria-label="学习能力雷达图">
        <polygon points={points.map((_, index) => point(index, 1)).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.7" className="text-border" />
        <polygon points={points.map((_, index) => point(index, 0.66)).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-border" />
        <polygon points={points.map((item, index) => point(index, Math.max(0.08, Math.min(1, item.score)))).join(" ")} fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.2" className="text-primary" />
        {points.map((item, index) => {
          const current = angle(index);
          return <text key={item.name} x={center + Math.cos(current) * 47} y={center + Math.sin(current) * 47} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[5px]">{item.name.slice(0, 6)}</text>;
        })}
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {points.map((item) => <div key={item.name} className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate">{item.name}</span><span className="font-medium">{Math.round(item.score * 100)}%</span></div>)}
      </div>
    </div>
  );
}

interface WorkflowPhaseInfo {
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  agents: WorkflowAgentInfo[];
  startedAt?: number;
  completedAt?: number;
}

interface WorkflowAgentInfo {
  id: number;
  label: string;
  phase: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  error?: string;
  outputLength?: number;
}

interface LearningAssetInfo {
  id: string;
  type: string;
  title: string;
  auditStatus: string;
  evidenceIds: string[];
  blocks: Array<{ type: string; content: unknown; evidenceIds: string[] }>;
}

interface LearningPathItemInfo {
  id: string;
  knowledgePointId?: string;
  title: string;
  status: string;
  priority: number;
  reason: string;
  completionCriteria: string;
  recommendedResourceType: string;
}

interface LearningRadarItem {
  name: string;
  score: number;
  reason?: string;
}

interface LearningProfileInfo {
  learnerId?: string;
  summary: string;
  status: "awaiting_evidence" | "learning";
  assetsCount: number;
  todayAssetsCount: number;
  completedAssetsCount: number;
  masteredAssetsCount: number;
  evidenceCount: number;
  studyMinutes: number;
  accuracy: number | null;
  keywords: string[];
  radar: LearningRadarItem[];
  skills: Array<{ knowledgePointId: string; mastery: number; confidence: number; attemptCount: number; correctCount: number }>;
}

interface LearningEvidenceInfo {
  id: string;
  packId?: string | null;
  packQuery?: string | null;
  packCoverageScore?: number | null;
  crossValidation?: { status?: string; score?: number; checks?: Array<{ id: string; label: string; status: string; detail: string; evidenceIds: string[] }>; notes?: string[] };
  privacy?: { temporaryReferenceUsed?: boolean; retained?: boolean };
  sourceType: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceScope?: string;
  locator: string;
  content: string;
  retrievalMethod: string;
  relevanceScore: number;
  trustLevel: string;
  metadata?: Record<string, unknown>;
}

interface RuntimeSettings {
  activeModel: string;
  defaultThinkingDepth: ThinkingDepth;
  providers: Array<{
    id: string;
    displayName: string;
    baseURL: string;
    isDefault: boolean;
    apiKeyConfigured: boolean;
    models: Array<{ id: string; displayName: string }>;
  }>;
  models: Array<{
    id: string;
    displayName: string;
    provider: string;
    providerDisplayName: string;
  }>;
  agentRouting: Record<string, AgentRoute>;
  autoAssetTypes: Array<"lecture" | "tiered_quiz" | "concept_map">;
  privacy: {
    uploadPolicy: "session_only";
    uploadContentRetained: false;
    learnerDataScope: "local";
  };
}

type ThinkingDepth = "low" | "medium" | "high" | "max";
interface RequestOptions {
  model?: string;
  thinkingDepth: ThinkingDepth;
}

interface PrivacyAuditEventInfo {
  id: string;
  eventType: string;
  fileName: string | null;
  byteCount: number | null;
  redactedFieldCount: number;
  retained: false;
  createdAt: number;
}

export default function MultiAgentUI() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const learnerId = authenticatedUser?.id ?? "";
  const [sessionId, setSessionId] = useState<string>("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentMode, setCurrentMode] = useState("auto");
  const [ws已连接, setWs已连接] = useState(false);
  const [rightTab, setRightTab] = useState("plan");
  const [learningAssets, setLearningAssets] = useState<LearningAssetInfo[]>([]);
  const [learningPath, setLearningPath] = useState<LearningPathItemInfo[]>([]);
  const [learningProfile, setLearningProfile] = useState<LearningProfileInfo | null>(null);
  const [learningEvidence, setLearningEvidence] = useState<LearningEvidenceInfo[]>([]);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Set<string>>(new Set());
  const [selectedLearningAsset, setSelectedLearningAsset] = useState<LearningAssetInfo | null>(null);
  const [learningPanelLoading, setLearningPanelLoading] = useState(false);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [subTasks, setSubTasks] = useState<SubTaskInfo[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [finalOutput, setFinalOutput] = useState<string>("");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [restoringSessionId, setRestoringSessionId] = useState<string>("");
  const [workflowPhases, setWorkflowPhases] = useState<WorkflowPhaseInfo[]>([]);
  const [workflowMeta, setWorkflowMeta] = useState<{ name: string; description: string } | null>(null);
  const [workflowCurrentPhase, setWorkflowCurrentPhase] = useState<string>("");
  const [workflowAgentMap, setWorkflowAgentMap] = useState<Map<number, WorkflowAgentInfo>>(new Map());
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<Record<string, string[]>>({});
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"models" | "agents" | "assets" | "privacy">("models");
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [privacyAuditEvents, setPrivacyAuditEvents] = useState<PrivacyAuditEventInfo[]>([]);
  const [privacyAuditLoading, setPrivacyAuditLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [providerForm, setProviderForm] = useState({
    id: "",
    displayName: "",
    baseURL: "",
    apiKey: "",
    modelId: "",
    modelDisplayName: "",
  });
  const [evaluationResult, setEvaluationResult] = useState<{
    score: number;
    deepScore?: number;
    dimensions?: Array<{ name: string; score: number; passed: boolean; feedback: string }>;
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
  } | null>(null);
  const [executionPhase, setExecutionPhase] = useState<"idle" | "planning" | "executing" | "evaluating" | "completed" | "failed">("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleWSMessageRef = useRef<(msg: any) => void>(() => {});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentColorMap = useRef<Map<string, number>>(new Map());
  const colorCounter = useRef(0);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(288);
  const [rightPanelWidth, setRightPanelWidth] = useState(384);
  const [resizingPanel, setResizingPanel] = useState<"left" | "right" | null>(null);
  const resizeStartRef = useRef<{ panel: "left" | "right"; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then((response) => response.json() as Promise<{ user?: AuthenticatedUser | null }>)
      .then((data) => { if (active) setAuthenticatedUser(data.user ?? null); })
      .catch(() => { if (active) setAuthenticatedUser(null); })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  const beginResize = (panel: "left" | "right", startX: number) => {
    resizeStartRef.current = {
      panel,
      startX,
      startWidth: panel === "left" ? leftSidebarWidth : rightPanelWidth,
    };
    setResizingPanel(panel);
  };

  useEffect(() => {
    if (!resizingPanel) return;
    const handleMove = (event: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = event.clientX - start.startX;
      if (start.panel === "left") {
        setLeftSidebarWidth(Math.max(220, Math.min(360, start.startWidth + delta)));
      } else {
        setRightPanelWidth(Math.max(300, Math.min(560, start.startWidth - delta)));
      }
    };
    const handleUp = () => {
      resizeStartRef.current = null;
      setResizingPanel(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [resizingPanel]);

  const loadLearningPanel = useCallback(async (tab: string) => {
    if (!learnerId || !["learning-path", "learning-profile", "learning-assets", "learning-evidence"].includes(tab)) return;
    setLearningPanelLoading(true);
    try {
      if (tab === "learning-path") {
        const response = await fetch(`${API_BASE}/api/learning/path?learnerId=${encodeURIComponent(learnerId)}`, { credentials: "include" });
        const data = await response.json() as { path?: LearningPathItemInfo[] };
        setLearningPath(data.path ?? []);
      } else if (tab === "learning-profile") {
        const response = await fetch(`${API_BASE}/api/learning/profile?learnerId=${encodeURIComponent(learnerId)}`, { credentials: "include" });
        const data = await response.json() as { profile?: LearningProfileInfo };
        setLearningProfile(data.profile ?? null);
      } else if (tab === "learning-assets") {
        const response = await fetch(`${API_BASE}/api/learning/assets?learnerId=${encodeURIComponent(learnerId)}`, { credentials: "include" });
        const data = await response.json() as { assets?: LearningAssetInfo[] };
        setLearningAssets(data.assets ?? []);
      } else {
        const response = await fetch(`${API_BASE}/api/learning/evidence?limit=20`, { credentials: "include" });
        const data = await response.json() as { evidence?: LearningEvidenceInfo[] };
        setLearningEvidence(data.evidence ?? []);
      }
    } catch {
      // Learning panel is supplementary; the main collaboration workspace remains usable.
    } finally {
      setLearningPanelLoading(false);
    }
  }, [learnerId]);

  const syncLearningContext = useCallback(async (goal: string, sid: string, options: RequestOptions, temporaryReference?: { name: string; content: string } | null) => {
    try {
      const response = await fetch(`${API_BASE}/api/learning/context/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ goal, sessionId: sid, learnerId, model: options.model, thinkingDepth: options.thinkingDepth, temporaryReference: temporaryReference || undefined }),
      });
      const data = await response.json() as { path?: LearningPathItemInfo[]; assets?: LearningAssetInfo[]; profile?: LearningProfileInfo; evidencePack?: { id: string; query: string; coverageScore: number; crossValidation: LearningEvidenceInfo["crossValidation"]; privacy: LearningEvidenceInfo["privacy"]; items: LearningEvidenceInfo[] } };
      if (!response.ok) return;
      if (data.path) setLearningPath(data.path);
      if (data.assets) setLearningAssets((current) => [...data.assets!, ...current.filter((asset) => !data.assets!.some((next) => next.id === asset.id))]);
      if (data.profile) setLearningProfile(data.profile);
      if (data.evidencePack) setLearningEvidence(data.evidencePack.items.map((item) => ({
        ...item,
        packId: data.evidencePack!.id,
        packQuery: data.evidencePack!.query,
        packCoverageScore: data.evidencePack!.coverageScore,
        crossValidation: data.evidencePack!.crossValidation,
        privacy: data.evidencePack!.privacy,
      })));
    } catch {
      // 学习中枢同步失败不阻断当前协同任务。
    }
  }, [learnerId]);

  const regenerateLearningProfile = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/learning/profile/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ learnerId, model: runtimeSettings?.activeModel, thinkingDepth: runtimeSettings?.defaultThinkingDepth || "medium" }),
      });
      const data = await response.json() as { profile?: LearningProfileInfo };
      if (response.ok && data.profile) setLearningProfile(data.profile);
    } catch {
      // 画像生成失败时保留上一次可用快照。
    }
  }, [learnerId, runtimeSettings?.activeModel, runtimeSettings?.defaultThinkingDepth]);

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError("");
    if (file.size > 300_000) {
      setFileError("文件太大，请先整理到 300KB 以内");
      return;
    }
    try {
      const content = await file.text();
      setAttachedFile({ name: file.name, content: content.slice(0, 120_000) });
    } catch {
      setFileError("暂时无法读取这个文件");
    }
  }, []);

  const loadRuntimeSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      const data = await response.json() as RuntimeSettings & { success: boolean };
      if (data.success) {
        setRuntimeSettings(data);
      }
    } catch {
      // The input remains usable when the model service is temporarily unavailable.
    }
  }, []);

  const openSettings = useCallback(async () => {
    setSettingsOpen(true);
    await loadRuntimeSettings();
  }, [loadRuntimeSettings]);

  useEffect(() => {
    void loadRuntimeSettings();
  }, [loadRuntimeSettings]);

  const saveProvider = async () => {
    setProviderSaving(true);
    setProviderError("");
    try {
      const response = await fetch(`${API_BASE}/api/settings/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const data = await response.json() as RuntimeSettings & { success: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "模型服务保存失败");
      setRuntimeSettings(data);
      setProviderFormOpen(false);
      setProviderForm({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
    } catch (error: any) {
      setProviderError(error.message || "模型服务保存失败");
    } finally {
      setProviderSaving(false);
    }
  };

  const editModelDisplayName = (provider: RuntimeSettings["providers"][number], model: RuntimeSettings["providers"][number]["models"][number]) => {
    setProviderError("");
    setProviderForm({
      id: provider.id,
      displayName: provider.displayName,
      baseURL: provider.baseURL,
      apiKey: "",
      modelId: model.id,
      modelDisplayName: model.displayName,
    });
    setProviderFormOpen(true);
  };

  const saveAgentRoute = async (agentId: string, patch: Partial<AgentRoute>) => {
    if (!runtimeSettings) return;
    const agentRouting = {
      ...runtimeSettings.agentRouting,
      [agentId]: {
        modelId: runtimeSettings.agentRouting[agentId]?.modelId ?? "",
        thinkingDepth: runtimeSettings.agentRouting[agentId]?.thinkingDepth ?? "inherit",
        ...patch,
      },
    };
    setRuntimeSettings((current) => current ? { ...current, agentRouting } : current);
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const response = await fetch(`${API_BASE}/api/settings/agent-routing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentRouting }),
      });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "协同编排保存失败");
      setRuntimeSettings(data);
    } catch (error: any) {
      setSettingsError(error.message || "协同编排保存失败");
      await loadRuntimeSettings();
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveDefaultExecution = async (patch: Partial<Pick<RuntimeSettings, "activeModel" | "defaultThinkingDepth">>) => {
    if (!runtimeSettings) return;
    const next = { ...runtimeSettings, ...patch };
    setRuntimeSettings(next);
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const response = await fetch(`${API_BASE}/api/settings/default-execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: next.activeModel, thinkingDepth: next.defaultThinkingDepth }),
      });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "默认执行设置保存失败");
      setRuntimeSettings(data);
    } catch (error: any) {
      setSettingsError(error.message || "默认执行设置保存失败");
      await loadRuntimeSettings();
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveAutoAssetTypes = async (autoAssetTypes: RuntimeSettings["autoAssetTypes"]) => {
    if (!runtimeSettings) return;
    setRuntimeSettings((current) => current ? { ...current, autoAssetTypes } : current);
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const response = await fetch(`${API_BASE}/api/settings/asset-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoAssetTypes }),
      });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "学习资产设置保存失败");
      setRuntimeSettings(data);
    } catch (error: any) {
      setSettingsError(error.message || "学习资产设置保存失败");
      await loadRuntimeSettings();
    } finally {
      setSettingsSaving(false);
    }
  };

  const loadPrivacyAuditEvents = useCallback(async () => {
    setPrivacyAuditLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settings/privacy-audit?limit=8`);
      const data = await response.json() as { events?: PrivacyAuditEventInfo[] };
      if (response.ok) setPrivacyAuditEvents(data.events ?? []);
    } finally {
      setPrivacyAuditLoading(false);
    }
  }, []);

  const clearPrivacyAuditEvents = async () => {
    if (!window.confirm("清除临时资料的使用审计记录？不会影响学习资产和会话。")) return;
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const response = await fetch(`${API_BASE}/api/settings/privacy-audit`, { method: "DELETE" });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "审计记录清除失败");
      setPrivacyAuditEvents([]);
    } catch (error: any) {
      setSettingsError(error.message || "审计记录清除失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    if (settingsOpen && settingsTab === "privacy") void loadPrivacyAuditEvents();
  }, [settingsOpen, settingsTab, loadPrivacyAuditEvents]);

  const getRequestOptions = (): RequestOptions => ({
    model: runtimeSettings?.activeModel || undefined,
    thinkingDepth: runtimeSettings?.defaultThinkingDepth || "medium",
  });

  useEffect(() => {
    void loadLearningPanel(rightTab);
  }, [rightTab, loadLearningPanel]);

  const getAgentColor = useCallback((agentId: string) => {
    if (!agentColorMap.current.has(agentId)) {
      agentColorMap.current.set(agentId, colorCounter.current);
      colorCounter.current = (colorCounter.current + 1) % AGENT_COLORS.length;
    }
    return AGENT_COLORS[agentColorMap.current.get(agentId)!];
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = document.getElementById("chat-scroll-container");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const clearWorkspace = useCallback((clearSession: boolean = true) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (clearSession) {
      setSessionId("");
      localStorage.removeItem("im-training-agent:last-session-id");
    }
    setMessages([]);
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("idle");
    setWorkflowPhases([]);
    setWorkflowMeta(null);
    setWorkflowCurrentPhase("");
    setWorkflowAgentMap(new Map());
    setIsExecuting(false);
  }, []);

  const loadRecentSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecentSessions(data.sessions || []);
    } catch {
      setRecentSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const connectWS = useCallback((sid: string) => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`ws://${WS_HOST}/ws?sessionId=${sid}`);
    ws.onopen = () => setWs已连接(true);
    ws.onclose = () => {
      setWs已连接(false);
      if (wsRef.current === ws) {
        setTimeout(() => { if (wsRef.current === ws && sid) connectWS(sid); }, 3000);
      }
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleWSMessageRef.current(msg);
    };
    wsRef.current = ws;
  }, []);

  const handleWSMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "agent_thinking":
        if (msg.agentId) {
          setAgentActivity((prev) => ({ ...prev, [msg.agentId]: [...(prev[msg.agentId] || []), "正在分析分配到的任务"].slice(-4) }));
          setAgents((prev) => prev.map((agent) => agent.id === msg.agentId ? { ...agent, state: "running" } : agent));
        }
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `thinking-${msg.agentId}-${Date.now()}`,
            type: "agent",
            agentName: msg.agentName,
            agentId: msg.agentId,
            text: "",
            timestamp: Date.now(),
            thinking: true,
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId ? { ...t, status: "running" as const } : t
          )
        );
        break;

      case "agent_response":
        if (msg.agentId) {
          setAgentActivity((prev) => ({ ...prev, [msg.agentId]: [...(prev[msg.agentId] || []), `已生成输出（${msg.text?.length || 0} 字符）`].slice(-4) }));
          setAgents((prev) => prev.map((agent) => agent.id === msg.agentId ? { ...agent, state: "completed" } : agent));
        }
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `resp-${msg.agentId}-${Date.now()}`,
            type: "agent",
            agentName: msg.agentName,
            agentId: msg.agentId,
            text: msg.text,
            timestamp: Date.now(),
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId
              ? { ...t, status: "completed" as const, progress: 100, output: msg.text, outputLength: msg.text?.length || 0 }
              : t
          )
        );
        break;

      case "agent_error":
        if (msg.agentId) {
          setAgentActivity((prev) => ({ ...prev, [msg.agentId]: [...(prev[msg.agentId] || []), `执行失败：${msg.error}`].slice(-4) }));
          setAgents((prev) => prev.map((agent) => agent.id === msg.agentId ? { ...agent, state: "failed" } : agent));
        }
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `err-${Date.now()}`,
            type: "system",
            text: `${msg.agentName}: ${msg.error}`,
            timestamp: Date.now(),
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId ? { ...t, status: "failed" as const, error: msg.error } : t
          )
        );
        break;

      case "planning_started":
        setExecutionPhase("planning");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: "正在分析任务并拆解协作步骤…", timestamp: Date.now() },
        ]);
        break;

      case "planning_completed":
      case "plan_created":
        setExecutionPhase("executing");
        if (msg.plan) {
          setPlan(msg.plan);
          setSubTasks(
            msg.plan.subTasks.map((t: SubTaskInfo) => ({
              ...t,
              status: "pending" as const,
              progress: 0,
            }))
          );
          setAgents(
            msg.plan.subTasks.map((t: SubTaskInfo, i: number) => ({
              id: t.id,
              name: t.assignedAgentName,
              description: t.title,
              capabilities: [t.assignedAgentType],
              tools: t.tools,
              assignedTask: t.title,
              priority: t.priority,
              state: "idle",
            }))
          );
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-plan-${Date.now()}`,
              type: "system",
              text: `协作计划已生成：${msg.plan.subTaskCount} 个子任务，采用 ${msg.plan.collaborationMode} 模式`,
              timestamp: Date.now(),
            },
          ]);
        }
        break;

      case "cluster_event":
        handleClusterEvent(msg);
        break;

      case "cluster_execution_started":
        setExecutionPhase("executing");
        setIsExecuting(true);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `多智能体协同已开始：${msg.task}`, timestamp: Date.now() },
        ]);
        break;

      case "cluster_execution_completed":
        setExecutionPhase("completed");
        setIsExecuting(false);
        if (msg.result) {
          const output = msg.result.finalOutput || "";
          if (output) setFinalOutput(output);
          setStats({
            totalTasks: subTasks.length,
            completedTasks: subTasks.filter((t) => t.status === "completed").length,
            failedTasks: subTasks.filter((t) => t.status === "failed").length,
            runningTasks: 0,
            totalTokens: msg.result.totalTokensUsed || 0,
            executionTime: msg.result.totalExecutionTime || 0,
            evaluationScore: msg.result.evaluationScore || 0,
            iterations: msg.result.iterations || 1,
            finalOutputLength: output.length || msg.result.finalOutputLength || 0,
          });
          setRightTab("report");
        }
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `协同执行完成，质量评分：${msg.result?.evaluationScore?.toFixed(2) || "暂无"}`, timestamp: Date.now() },
        ]);
        break;

      case "cluster_execution_error":
        setExecutionPhase("failed");
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `执行失败：${msg.error}`, timestamp: Date.now() },
        ]);
        break;

      case "execution_start":
        setIsExecuting(true);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `任务已开始：${msg.task}（${msg.agentCount} 个智能体，${msg.mode} 模式）`, timestamp: Date.now() },
        ]);
        break;

      case "execution_complete":
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `任务已完成，用时 ${msg.executionTime}ms`, timestamp: Date.now() },
        ]);
        break;

      case "execution_error":
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `执行失败：${msg.error}`, timestamp: Date.now() },
        ]);
        break;

      case "evaluation":
        setExecutionPhase("evaluating");
        const evalData = msg.data as any;
        const evalResult = {
          score: evalData?.score || 0,
          deepScore: evalData?.deepScore,
          dimensions: evalData?.dimensions,
          strengths: evalData?.strengths,
          weaknesses: evalData?.weaknesses,
          suggestions: evalData?.suggestions,
        };
        setEvaluationResult(evalResult);
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-eval-${Date.now()}`,
            type: "evaluation",
            text: `质量评估：${((evalData?.score || 0) * 100)?.toFixed(0)}%`,
            timestamp: Date.now(),
            evaluationData: evalResult,
          },
        ]);
        break;

      case "workflow_started":
        setExecutionPhase("planning");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `工作流已启动：${msg.task}`, timestamp: Date.now() },
        ]);
        break;

      case "workflow_event":
        const wfEvt = msg.data as any;
        if (wfEvt.type === "workflow:started") {
          const phases = (wfEvt.meta?.phases || []).map((p: any) => ({
            title: p.title || p,
            status: "pending" as const,
            agents: [],
          }));
          setWorkflowPhases(phases);
          setWorkflowMeta({ name: wfEvt.meta?.name || "协作工作流", description: wfEvt.meta?.description || "" });
          setWorkflowAgentMap(new Map());
          setPlan({
            id: wfEvt.meta?.name || "workflow",
            goal: wfEvt.meta?.description || "",
            subTaskCount: 0,
            collaborationMode: "workflow",
            subTasks: [],
          });
          setSubTasks([]);
          setAgents([]);
          setRightTab("workflow");
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `工作流：${wfEvt.meta?.name || "未命名"} — 已规划 ${phases.length} 个阶段`, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "phase:changed") {
          setExecutionPhase("executing");
          setWorkflowCurrentPhase(wfEvt.phase);
          setWorkflowPhases((prev) =>
            prev.map((p) =>
              p.title === wfEvt.phase
                ? { ...p, status: "running" as const, startedAt: Date.now() }
                : p.status === "pending"
                ? p
                : p
            )
          );
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `▶ 当前阶段：${wfEvt.phase}`, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "agent:started") {
          const agentInfo: WorkflowAgentInfo = {
            id: wfEvt.agentId,
            label: wfEvt.label,
            phase: wfEvt.phase,
            status: "running",
            startedAt: Date.now(),
          };
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            next.set(wfEvt.agentId, agentInfo);
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) =>
              p.title === wfEvt.phase
                ? { ...p, agents: [...p.agents.filter((a) => a.id !== wfEvt.agentId), agentInfo] }
                : p
            )
          );
          setAgents((prev) => {
            const exists = prev.find((a) => a.id === `wf-${wfEvt.agentId}`);
            if (exists) return prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "running" } : a);
            return [...prev, {
              id: `wf-${wfEvt.agentId}`,
              name: wfEvt.label,
              description: wfEvt.phase,
              capabilities: ["workflow"],
              state: "running",
              assignedTask: wfEvt.phase,
            }];
          });
          setSubTasks((prev) => {
            const exists = prev.find((t) => t.id === `wf-${wfEvt.agentId}`);
            if (exists) return prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "running" as const } : t);
            return [...prev, {
              id: `wf-${wfEvt.agentId}`,
              title: wfEvt.label,
              assignedAgentName: wfEvt.label,
              assignedAgentType: "workflow-agent",
              dependencies: [],
              priority: "normal",
              tools: [],
              status: "running" as const,
              progress: 10,
              startTime: Date.now(),
            }];
          });
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `thinking-wf-${wfEvt.agentId}-${Date.now()}`,
              type: "agent",
              agentName: wfEvt.label,
              agentId: `wf-${wfEvt.agentId}`,
              text: "",
              timestamp: Date.now(),
              thinking: true,
            },
          ]);
        } else if (wfEvt.type === "agent:completed") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "completed", completedAt: Date.now(), outputLength: wfEvt.outputLength });
            }
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) => ({
              ...p,
              agents: p.agents.map((a) =>
                a.id === wfEvt.agentId ? { ...a, status: "completed" as const, completedAt: Date.now(), outputLength: wfEvt.outputLength } : a
              ),
            }))
          );
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "completed" } : a));
          setSubTasks((prev) => prev.map((t) =>
            t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "completed" as const, progress: 100, endTime: Date.now(), outputLength: wfEvt.outputLength } : t
          ));
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `resp-wf-${wfEvt.agentId}-${Date.now()}`,
              type: "agent",
              agentName: wfEvt.label,
              agentId: `wf-${wfEvt.agentId}`,
              text: `✓ 已完成（${wfEvt.outputLength || 0} 字符）`,
              timestamp: Date.now(),
            },
          ]);
        } else if (wfEvt.type === "agent:failed") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "failed", error: wfEvt.error, completedAt: Date.now() });
            }
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) => ({
              ...p,
              agents: p.agents.map((a) =>
                a.id === wfEvt.agentId ? { ...a, status: "failed" as const, error: wfEvt.error, completedAt: Date.now() } : a
              ),
            }))
          );
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "failed" } : a));
          setSubTasks((prev) => prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "failed" as const, error: wfEvt.error } : t));
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `err-wf-${Date.now()}`,
              type: "system",
              text: `✗ ${wfEvt.label} 执行失败：${wfEvt.error}`,
              timestamp: Date.now(),
            },
          ]);
        } else if (wfEvt.type === "agent:skipped") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "skipped", completedAt: Date.now() });
            }
            return next;
          });
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "completed" } : a));
          setSubTasks((prev) => prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "completed" as const, progress: 100 } : t));
        } else if (wfEvt.type === "workflow:log") {
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: wfEvt.message, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "workflow:completed") {
          const wfResult = wfEvt.result;
          if (wfResult?.snapshot) {
            finalizeWorkflowState(wfResult.snapshot, wfResult.totalTokens, wfResult.totalExecutionTime);
          }
        } else if (wfEvt.type === "workflow:failed") {
          setExecutionPhase("failed");
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `工作流失败：${wfEvt.error}`, timestamp: Date.now() },
          ]);
        }
        break;

      case "workflow_completed":
        setExecutionPhase("completed");
        if (msg.result?.snapshot) {
          finalizeWorkflowState(msg.result.snapshot, msg.result.totalTokens, msg.result.totalExecutionTime);
        }
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `工作流已完成，Token 消耗：${msg.result?.totalTokens?.toLocaleString() || 0}`, timestamp: Date.now() },
        ]);
        break;

      case "workflow_error":
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `工作流错误：${msg.error}`, timestamp: Date.now() },
        ]);
        break;
    }
  }, [subTasks]);

  useEffect(() => {
    handleWSMessageRef.current = handleWSMessage;
  }, [handleWSMessage]);

  const finalizeWorkflowState = (snap: any, totalTokens: number, totalTime: number) => {
    setWorkflowPhases((prev) =>
      prev.map((p) => {
        const allDone = p.agents.length > 0 && p.agents.every((a) => a.status === "completed" || a.status === "failed" || a.status === "skipped");
        return { ...p, status: allDone ? "completed" as const : p.status === "running" ? "completed" as const : p.status, completedAt: Date.now() };
      })
    );
    const agentList = snap.agents || [];
    setPlan((prev) => prev ? { ...prev, subTaskCount: agentList.length } : null);
    setStats({
      totalTasks: agentList.length,
      completedTasks: agentList.filter((a: any) => a.status === "completed").length,
      failedTasks: agentList.filter((a: any) => a.status === "failed").length,
      runningTasks: 0,
      totalTokens: totalTokens || 0,
      executionTime: totalTime || 0,
      evaluationScore: 0,
      iterations: 1,
      finalOutputLength: finalOutput.length || 0,
    });
    setExecutionPhase("completed");
    setRightTab("report");
  };

  const handleClusterEvent = useCallback((msg: any) => {
    const { eventType, taskId, agentName, data } = msg;

    switch (eventType) {
      case "task_started":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `开始执行：${(data as any)?.task || "已分配任务"}`].slice(-4) }));
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "running" as const, progress: 10, startTime: Date.now() } : t
          )
        );
        setAgents((prev) =>
          prev.map((a) =>
            a.assignedTask === (data as any)?.task ? { ...a, state: "running" } : a
          )
        );
        break;

      case "task_completed":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `任务完成（${(data as any)?.outputLength || 0} 字符）`].slice(-4) }));
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "completed" as const, progress: 100, endTime: Date.now(), outputLength: (data as any)?.outputLength || 0 } : t
          )
        );
        break;

      case "task_failed":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `任务失败：${(data as any)?.error || "未知错误"}`].slice(-4) }));
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "failed" as const, error: (data as any)?.error } : t
          )
        );
        break;

      case "agent_thinking":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), "正在分析任务并准备输出"].slice(-4) }));
        setAgents((prev) => prev.map((agent) => agent.id === taskId ? { ...agent, state: "running" } : agent));
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === taskId && m.thinking)),
          {
            id: `thinking-${taskId}-${Date.now()}`,
            type: "agent",
            agentName: agentName || "智能体",
            agentId: taskId,
            text: "",
            timestamp: Date.now(),
            thinking: true,
          },
        ]);
        break;

      case "agent_response":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `已完成输出（${(data as any)?.outputLength || 0} 字符）`].slice(-4) }));
        setAgents((prev) => prev.map((agent) => agent.id === taskId ? { ...agent, state: "completed" } : agent));
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === taskId && m.thinking)),
          {
            id: `resp-${taskId}-${Date.now()}`,
            type: "agent",
            agentName: agentName || "智能体",
            agentId: taskId,
            text: (data as any)?.outputLength ? `[输出：${(data as any).outputLength} 字符]` : "",
            timestamp: Date.now(),
          },
        ]);
        break;

      case "tool_call":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `调用工具：${(data as any)?.toolName || "未知工具"}`].slice(-4) }));
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `调用工具：${(data as any)?.toolName || "未知工具"}`].slice(-4) }));
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-call-${taskId}-${Date.now()}`,
            type: "tool_call",
            agentName: agentName || "智能体",
            agentId: taskId,
            text: `${(data as any)?.toolName || "未知"}`,
            timestamp: Date.now(),
            toolCall: (data as any)?.toolName,
            toolInput: (data as any)?.input,
          },
        ]);
        break;

      case "tool_result":
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `${(data as any)?.success ? "工具完成" : "工具未完成"}：${(data as any)?.toolName || "未知工具"}`].slice(-4) }));
        setAgentActivity((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), `${(data as any)?.success ? "工具完成" : "工具未完成"}：${(data as any)?.toolName || "未知工具"}`].slice(-4) }));
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-result-${taskId}-${Date.now()}`,
            type: "tool_result",
            agentName: agentName || "智能体",
            agentId: taskId,
            text: `${(data as any)?.toolName || "未知"}`,
            timestamp: Date.now(),
            toolResult: (data as any)?.toolName,
            toolDuration: (data as any)?.duration,
            toolSuccess: (data as any)?.success,
          },
        ]);
        break;
    }
  }, []);

  const restoreSession = useCallback(async (sid: string) => {
    setRestoringSessionId(sid);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const restored = data.session as PersistedSessionDetail;
      const active = Boolean(data.active);
      const clusterOutput = restored.result?.finalOutput || "";
      const workflowOutput =
        typeof restored.workflowResult?.output === "string"
          ? restored.workflowResult.output
          : restored.workflowResult?.output
          ? JSON.stringify(restored.workflowResult.output, null, 2)
          : "";
      const output = clusterOutput || workflowOutput;
      const isInterrupted = restored.status === "running" && !active;
      const restoredPlan = restored.plan || null;
      const progressByTask = new Map((restored.result?.progress || []).map((item) => [item.taskId, item]));
      const restoredTasks = (restoredPlan?.subTasks || []).map((task) => {
        const progress = progressByTask.get(task.id);
        return {
          ...task,
          status: progress?.status || (restored.status === "completed" ? "completed" as const : "pending" as const),
          progress: progress?.progress ?? (restored.status === "completed" ? 100 : 0),
          outputLength: progress?.outputLength,
          error: progress?.error,
        };
      });

      setSessionId(restored.id);
      localStorage.setItem("im-training-agent:last-session-id", restored.id);
      setCurrentMode(restored.mode || "auto");
      setPlan(restoredPlan);
      setSubTasks(restoredTasks);
      setAgents(restoredTasks.map((task, index) => ({
        id: task.id || `task-${index}`,
        name: task.assignedAgentName || `智能体 ${index + 1}`,
        description: task.title,
        capabilities: [task.assignedAgentType || "agent"],
        tools: task.tools || [],
        assignedTask: task.title,
        priority: task.priority,
        state: restored.status === "completed" ? "completed" : restored.status === "failed" || isInterrupted ? "failed" : "idle",
      })));
      setFinalOutput(output);
      setStats({
        totalTasks: restoredTasks.length || (restored.workflowResult ? 1 : 0),
        completedTasks: restored.result?.progress?.filter((item) => item.status === "completed").length || (restored.status === "completed" ? restoredTasks.length : 0),
        failedTasks: restored.result?.progress?.filter((item) => item.status === "failed").length || (restored.status === "failed" || isInterrupted ? 1 : 0),
        runningTasks: restored.status === "running" && active ? 1 : 0,
        totalTokens: restored.result?.totalTokensUsed || restored.workflowResult?.totalTokens || 0,
        executionTime: restored.result?.totalExecutionTime || restored.workflowResult?.totalExecutionTime || 0,
        evaluationScore: restored.result?.evaluationScore || restored.evaluationScore || 0,
        iterations: restored.result?.iterations || restored.iterations || 1,
        finalOutputLength: output.length || restored.finalOutputLength || 0,
      });
      setExecutionPhase(isInterrupted ? "failed" : restored.status === "running" ? "executing" : restored.status);
      setRightTab(output ? "report" : restoredPlan ? "plan" : "stats");
      setIsExecuting(restored.status === "running" && active);
      setEvaluationResult(null);
      setWorkflowPhases([]);
      setWorkflowMeta(restored.mode === "workflow" ? { name: "协作工作流", description: restored.task || "" } : null);
      setWorkflowCurrentPhase("");
      setWorkflowAgentMap(new Map());

      const restoredMessages: ChatMessage[] = [];
      if (restored.task) {
        restoredMessages.push({ id: `restore-user-${restored.id}`, type: "user", text: restored.task, timestamp: restored.createdAt });
      }
      restoredMessages.push({
        id: `restore-state-${restored.id}`,
        type: "system",
        text: getRestoreMessage({ status: restored.status, active }),
        timestamp: restored.updatedAt,
      });
      if (restored.error && !output) {
        restoredMessages.push({ id: `restore-error-${restored.id}`, type: "system", text: `错误： ${restored.error}`, timestamp: restored.updatedAt });
      }
      if (output) {
        restoredMessages.push({
          id: `restore-result-${restored.id}`,
          type: "result",
          text: output,
          timestamp: restored.updatedAt,
          resultData: {
            content: output,
            length: output.length,
            tokens: restored.result?.totalTokensUsed || restored.workflowResult?.totalTokens || 0,
            mode: restored.mode || "restored",
            agentCount: restoredTasks.length || 1,
          },
        });
      }
      setMessages(restoredMessages);

      connectWS(restored.id);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { id: `restore-error-${Date.now()}`, type: "system", text: `恢复会话失败：${error.message}`, timestamp: Date.now() },
      ]);
    } finally {
      setRestoringSessionId("");
      await loadRecentSessions();
    }
  }, [connectWS, loadRecentSessions]);

  const createSession = useCallback(async (): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/sessions`, { method: "POST" });
    const data = await res.json();
    setSessionId(data.sessionId);
    localStorage.setItem("im-training-agent:last-session-id", data.sessionId);
    connectWS(data.sessionId);
    await loadRecentSessions();
    return data.sessionId;
  }, [connectWS, loadRecentSessions]);

  const createNewSession = useCallback(async () => {
    clearWorkspace(false);
    await createSession();
  }, [clearWorkspace, createSession]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      await loadRecentSessions();
      if (cancelled) return;
      const lastSessionId = localStorage.getItem("im-training-agent:last-session-id");
      if (lastSessionId) {
        try {
          const res = await fetch(`${API_BASE}/api/sessions/${lastSessionId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.session && data.session.status === "failed") {
              localStorage.removeItem("im-training-agent:last-session-id");
              if (!cancelled) await createNewSession();
            } else if (!cancelled) {
              restoreSession(lastSessionId);
            }
          } else if (!cancelled) {
            await createNewSession();
          }
        } catch {
          if (!cancelled) await createNewSession();
        }
      } else if (!cancelled) {
        await createNewSession();
      }
    };
    init();
    return () => { cancelled = true; };
  }, [loadRecentSessions, restoreSession, createNewSession]);

  const executeDeepTask = async (
    taskParam?: string,
    existingSessionId?: string,
    options: { appendUserMessage?: boolean; maxAgents?: number; model?: string; thinkingDepth?: ThinkingDepth } = {}
  ) => {
    const task = taskParam || taskInput.trim();
    if (!task || isExecuting) return;

    if (!taskParam) setTaskInput("");
    const shouldAppendUserMessage = options.appendUserMessage ?? !taskParam;
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("planning");

    setMessages((prev) => [
      ...prev,
      ...(shouldAppendUserMessage
        ? [{ id: `user-${Date.now()}`, type: "user" as const, text: task, timestamp: Date.now() }]
        : []),
      { id: `sys-${Date.now()}`, type: "system", text: "正在准备深度协同流程", detail: "系统将先拆解目标，再分配角色并进行多轮协同审核。", timestamp: Date.now() },
    ]);

    const sid = existingSessionId || await createSession();
    setIsExecuting(true);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/cluster-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          targetWordCount: 30000,
          maxAgents: options.maxAgents || 10,
          max迭代次数: 3,
          model: options.model,
          thinkingDepth: options.thinkingDepth,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setStats({
          totalTasks: data.progress?.length || subTasks.length || 0,
          completedTasks: data.progress?.filter((p: any) => p.status === "completed").length || subTasks.filter((t) => t.status === "completed").length || 0,
          failedTasks: data.progress?.filter((p: any) => p.status === "failed").length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokensUsed || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: data.evaluationScore || 0,
          iterations: data.iterations || 1,
          finalOutputLength: output.length || 0,
        });

        if (data.progress) {
          setSubTasks((prev) =>
            prev.map((t) => {
              const p = data.progress.find((pp: any) => pp.taskId === t.id);
              if (p) {
                return {
                  ...t,
                  status: p.status,
                  progress: p.progress,
                  outputLength: p.outputLength,
                  error: p.error,
                };
              }
              return { ...t, status: "completed" as const, progress: 100 };
            })
          );
        }

        setExecutionPhase("completed");
        setRightTab("report");
        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokensUsed || 0, mode: "deep", agentCount: data.progress?.length || options.maxAgents || 1 },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Execution failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `错误： ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeWorkflowTask = async (task: string, sid: string, options: RequestOptions) => {
    setIsExecuting(true);
    setExecutionPhase("planning");
    setWorkflowPhases([]);
    setWorkflowMeta(null);
    setWorkflowCurrentPhase("");
    setWorkflowAgentMap(new Map());

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "正在生成动态工作流", detail: "工作流会根据当前目标决定阶段、角色和执行顺序。", timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/workflow-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          tokenBudget: 200000,
          maxConcurrentAgents: 5,
          model: options.model,
          thinkingDepth: options.thinkingDepth,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const output = typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2);
        setFinalOutput(output);

        if (data.snapshot) {
          finalizeWorkflowState(data.snapshot, data.totalTokens, data.totalExecutionTime);
        } else {
          setExecutionPhase("completed");
          setRightTab("report");
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokens || 0, mode: "workflow", agentCount: data.snapshot?.agents?.length || 1 },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Workflow failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `错误： ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeSimpleTask = async () => {
    const task = taskInput.trim();
    if (!task || isExecuting) return;

    setTaskInput("");
    setExecutionPhase("executing");

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: task, timestamp: Date.now() },
    ]);

    const sid = await createSession();
    setIsExecuting(true);

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "正在分析任务并组织协作智能体…", timestamp: Date.now() },
    ]);

    const genRes = await fetch(`${API_BASE}/api/sessions/${sid}/agents/auto-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    const genData = await genRes.json();

    if (genData.agents) {
      setAgents(genData.agents);
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `已生成 ${genData.agents.length} 个智能体，协作模式：${genData.collaborationMode}`, timestamp: Date.now() },
      ]);
    }

    const agentIds = genData.agents?.map((a: AgentInfo) => a.id) || [];
    const res = await fetch(`${API_BASE}/api/sessions/${sid}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, mode: genData.collaborationMode || "sequential", agentIds }),
    });

    await res.json();
    setIsExecuting(false);
    setExecutionPhase("completed");
  };

  const executeCollaborationTask = async () => {
    const task = taskInput.trim();
    if (!task || isExecuting) return;

    setTaskInput("");
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("executing");

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: task, timestamp: Date.now() },
      { id: `sys-${Date.now()}`, type: "system", text: `正在启动 ${currentMode} 协作…`, timestamp: Date.now() },
    ]);

    const sid = await createSession();
    setIsExecuting(true);

    const configuredMode = currentMode === "parallel" || currentMode === "expert_team" ? currentMode : "sequential";
    const agents = selectLearningAgents(configuredMode);

    setAgents(agents.map((a, i) => ({
      id: a.id,
      name: a.name,
      description: a.specialty,
      capabilities: [a.type],
      state: "idle",
    })));

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/collaborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: currentMode, task, agents }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setExecutionPhase("completed");
        setRightTab("report");
        setStats({
          totalTasks: data.agentResults?.length || agents.length,
          completedTasks: data.agentResults?.filter((r: any) => r.success).length || agents.length,
          failedTasks: data.agentResults?.filter((r: any) => !r.success).length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokens || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: 0.8,
          iterations: data.iterations || 1,
          finalOutputLength: output.length,
        });
        setAgents((prev) => prev.map((a) => ({ ...a, state: "completed" })));
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-done-${Date.now()}`,
            type: "system",
            text: `协作完成：${currentMode} 模式 | ${output.length.toLocaleString()} 字符 | ${data.totalTokens?.toLocaleString() || 0} Token`,
            timestamp: Date.now(),
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `协作失败：${data.error || "未知错误"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `错误： ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeDirectTask = async (task: string, _sid: string, options: RequestOptions) => {
    setIsExecuting(true);
    setExecutionPhase("executing");
    setAgents([{ id: "assistant", name: "智能助手", description: "通用 AI 助手", capabilities: ["general"], state: "running" }]);

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "正在由单智能体处理…", timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: task, model: options.model, thinkingDepth: options.thinkingDepth }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      const output = data.output || "Task completed.";

      setFinalOutput(output);
      setExecutionPhase("completed");
      setRightTab("report");
      setAgents([{ id: "assistant", name: "智能助手", description: "通用 AI 助手", capabilities: ["general"], state: "completed" }]);
      setStats({
        totalTasks: 1,
        completedTasks: 1,
        failedTasks: 0,
        runningTasks: 0,
        totalTokens: data.tokens || 0,
        executionTime: 0,
        evaluationScore: 0,
        iterations: 1,
        finalOutputLength: output.length,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `result-${Date.now()}`,
          type: "result",
          text: output,
          timestamp: Date.now(),
          resultData: { content: output, length: output.length, tokens: data.tokens || 0, mode: "direct", agentCount: 1 },
        },
      ]);
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `错误： ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
  };

  const [pendingClarification, setPendingClarification] = useState<{ task: string; sid: string; hilData: HumanInLoopMessage } | null>(null);
  const [clarificationForm, setClarificationForm] = useState<Record<string, any>>({});

  const handleClarificationSubmit = () => {
    if (!pendingClarification) return;

    const { task, sid, hilData } = pendingClarification;
    const extras: string[] = [];
    if (hilData.uiSchema?.fields) {
      for (const field of hilData.uiSchema.fields) {
        const val = clarificationForm[field.key];
        if (val !== undefined && val !== "") {
          extras.push(`${field.label}: ${val}`);
        }
      }
    }

    const enrichedTask = extras.length > 0 ? `${task}\n\n补充信息:\n${extras.join("\n")}` : task;

    setPendingClarification(null);
    setClarificationForm({});

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-clarify-done-${Date.now()}`,
        type: "system",
        text: extras.length > 0 ? `用户补充: ${extras.join("; ")}` : "用户跳过补充",
        timestamp: Date.now(),
      },
    ]);

    proceedWithAnalysis(enrichedTask, sid, getRequestOptions());
  };

  const handleClarificationCancel = () => {
    if (!pendingClarification) return;
    const { task, sid } = pendingClarification;
    setPendingClarification(null);
    setClarificationForm({});
    proceedWithAnalysis(task, sid, getRequestOptions());
  };

  const proceedWithAnalysis = async (task: string, sid: string, options: RequestOptions) => {
    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "正在分析任务复杂度", detail: "系统会根据目标范围和步骤数量选择单智能体、协作或深度协同。", timestamp: Date.now() },
    ]);

    try {
      const analysisRes = await fetch(`${API_BASE}/api/analyze-complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!analysisRes.ok) {
        throw new Error("Complexity analysis failed");
      }

      const analysis = await analysisRes.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `sys-analysis-${Date.now()}`,
          type: "system",
          text: `Complexity: ${analysis.level} | Agents: ${analysis.agentCount} | Mode: ${analysis.mode} — ${analysis.reasoning}`,
          timestamp: Date.now(),
        },
      ]);

      const execution = resolveAutoExecution(analysis);

      if (execution.kind === "direct") {
        await executeDirectTask(task, sid, options);
      } else if (execution.kind === "deep") {
        setCurrentMode("deep");
        await executeDeepTask(task, sid, {
          appendUserMessage: false,
          maxAgents: execution.agentCount,
          model: options.model,
          thinkingDepth: options.thinkingDepth,
        });
      } else {
        setCurrentMode(execution.mode);
        await executeCollaborationWithConfig(task, sid, execution.mode, execution.agentCount, options);
      }
    } catch (error: any) {
      await executeDirectTask(task, sid, options);
    }
  };

  const executeTask = async () => {
    const rawTask = taskInput.trim();
    if (!rawTask || isExecuting) return;

    const task = attachedFile
      ? `${rawTask}\n\n[用户临时参考资料：${attachedFile.name}]\n${attachedFile.content}`
      : rawTask;
    const displayTask = attachedFile ? `${rawTask}\n\n📎 ${attachedFile.name}` : rawTask;

    setTaskInput("");
    setAttachedFile(null);
    setFileError("");
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: displayTask, timestamp: Date.now() },
    ]);

    const sid = await createSession();
    const requestOptions = getRequestOptions();
    void syncLearningContext(rawTask, sid, requestOptions, attachedFile);

    if (currentMode === "deep") {
      executeDeepTask(task, sid, { appendUserMessage: false, ...requestOptions });
      return;
    }

    if (currentMode === "workflow") {
      executeWorkflowTask(task, sid, requestOptions);
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "正在判断是否需要补充信息", detail: "系统正在检查目标、基础水平、时间范围和输出形式是否足够明确。需要时会在这里展开填写。", timestamp: Date.now() },
    ]);

    try {
      const clarifyRes = await fetch(`${API_BASE}/api/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!clarifyRes.ok) {
        throw new Error("Clarification check failed");
      }

      const clarifyData = await clarifyRes.json();

      if (clarifyData.needsClarification && clarifyData.clarification) {
        const hilData: HumanInLoopMessage = {
          taskId: clarifyData.clarification.taskId || `task-${Date.now()}`,
          stepId: clarifyData.clarification.stepId || "clarify-1",
          status: "WAITING_INPUT",
          uiSchema: clarifyData.clarification.uiSchema,
          contextHint: clarifyData.clarification.contextHint,
          defaultValues: clarifyData.clarification.defaultValues,
        };

        setPendingClarification({ task, sid, hilData });
        setClarificationForm(hilData.defaultValues || {});

        setMessages((prev) => [
          ...prev,
          {
            id: `hil-${Date.now()}`,
            type: "human_input",
            text: clarifyData.reason || "Please provide additional information",
            timestamp: Date.now(),
            hilData,
          },
        ]);
        return;
      }
    } catch {
      // fallback: skip clarification
    }

    await proceedWithAnalysis(task, sid, requestOptions);
  };

  const executeCollaborationWithConfig = async (task: string, sid: string, mode: string, _agentCount: number, options: RequestOptions) => {
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("executing");
    setIsExecuting(true);

    const selectedAgents = selectLearningAgents(mode);

    setAgents(selectedAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.specialty,
      capabilities: [a.type],
      state: "idle",
    })));

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: `正在启动${MODE_LABELS[mode] || "协作"}（${selectedAgents.length} 个角色）`, detail: "点击左侧角色卡片，可以展开查看该角色的任务和执行记录。", timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/collaborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, task, agents: selectedAgents, model: options.model, thinkingDepth: options.thinkingDepth }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setExecutionPhase("completed");
        setRightTab("report");
        setStats({
          totalTasks: data.agentResults?.length || selectedAgents.length,
          completedTasks: data.agentResults?.filter((r: any) => r.success).length || selectedAgents.length,
          failedTasks: data.agentResults?.filter((r: any) => !r.success).length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokens || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: 0.8,
          iterations: data.iterations || 1,
          finalOutputLength: output.length,
        });
        setAgents((prev) => prev.map((a) => ({ ...a, state: "completed" })));
        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokens || 0, mode, agentCount: selectedAgents.length },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `协作失败：${data.error || "未知错误"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `错误： ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
  };

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const downloadReport = (format: string = "markdown") => {
    if (!finalOutput) return;

    if (format === "markdown") {
      const blob = new Blob([finalOutput], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "html") {
      const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>IM-Training-Agent 学习报告</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.8;color:#1a1a1a}
h1{font-size:1.8em;border-bottom:2px solid #e5e7eb;padding-bottom:0.3em}
h2{font-size:1.4em;border-bottom:1px solid #e5e7eb;padding-bottom:0.2em;margin-top:2em}
h3{font-size:1.15em;margin-top:1.5em}
p{margin:0.8em 0}
ul,ol{padding-left:1.5em}
li{margin:0.3em 0}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}
th{background:#f3f4f6;font-weight:600}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:0.9em}
pre{background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto}
pre code{background:transparent;padding:0;color:inherit}
blockquote{border-left:4px solid #6366f1;padding-left:1em;margin:1em 0;color:#4b5563}
</style></head><body>${markdownToHtml(finalOutput)}</body></html>`;
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "txt") {
      const blob = new Blob([finalOutput], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const markdownToHtml = (md: string): string => {
    let html = md;
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, "");
    html = html.replace(/<p>(<h[1-3]>)/g, "$1");
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, "$1");
    html = html.replace(/<p>(<ul>)/g, "$1");
    html = html.replace(/(<\/ul>)<\/p>/g, "$1");
    html = html.replace(/<p>(<blockquote>)/g, "$1");
    html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
    return html;
  };

  const getStateIcon = (state?: string) => {
    switch (state) {
      case "running": return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
      case "completed": return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
      case "error": case "failed": return <XCircle className="h-3 w-3 text-destructive" />;
      default: return <Circle className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getTaskStatusIcon = (status?: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "completed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
      case "retrying": return <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const formatSessionTime = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const completedCount = subTasks.filter((t) => t.status === "completed").length;
  const totalCount = subTasks.length;
  const overallProgress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const activeEvidencePackId = learningEvidence.find((item) => item.packId)?.packId ?? null;
  const activeEvidence = activeEvidencePackId
    ? learningEvidence.filter((item) => item.packId === activeEvidencePackId)
    : learningEvidence;
  const activeEvidenceSummary = activeEvidence[0];
  const activeCrossValidation = activeEvidenceSummary?.crossValidation;
  const structuredEvidence = activeEvidence.filter((item) => item.sourceType === "dataset");
  const documentEvidence = activeEvidence.filter((item) => item.sourceType === "document");

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在准备工作台…</div>;
  }

  if (!authenticatedUser || !authenticatedUser.onboardingCompleted) {
    return <AuthEntry apiBase={API_BASE} user={authenticatedUser} onAuthenticated={setAuthenticatedUser} />;
  }

  return <LearningPathWorkbench apiBase={API_BASE} user={authenticatedUser} onLogout={() => setAuthenticatedUser(null)} />;

  return (
    <div className={`relative flex h-screen bg-background overflow-hidden ${resizingPanel ? "select-none" : ""}`}>
      {/* Left Sidebar - Agent Team */}
      {leftSidebarOpen && <div style={{ width: `${leftSidebarWidth}px` }} className="border-r bg-card flex flex-col shrink-0 h-screen transition-[width] duration-150">
        <div className="p-4 border-b shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              本轮协同
            </h2>
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">{agents.length > 0 ? `${agents.length} 个角色` : "待组建"}</Badge>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLeftSidebarOpen(false)} title="收起左栏" aria-label="收起左栏"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          {executionPhase !== "idle" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">进度</span>
                <span className="font-medium">{completedCount}/{totalCount}</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                历史会话
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadRecentSessions} disabled={isLoadingSessions} title="刷新">
                <RefreshCw className={`h-3 w-3 ${isLoadingSessions ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => createNewSession()} title="新建会话">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {recentSessions.length === 0 ? (
                <div className="text-xs text-muted-foreground px-1 py-2">
                  暂无历史会话
                </div>
              ) : (
                recentSessions.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.task || item.id}
                    disabled={Boolean(restoringSessionId)}
                    onClick={() => restoreSession(item.id)}
                    className={`w-full text-left rounded-md px-2 py-2 transition-colors hover:bg-muted disabled:opacity-60 ${
                      sessionId === item.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{item.task || "未命名会话"}</span>
                      <Badge
                        variant={item.status === "failed" ? "destructive" : item.status === "completed" ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{formatSessionTime(item.updatedAt)}</span>
                      <span>{item.mode || "session"} · {item.finalOutputLength.toLocaleString()} 字符</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="p-3 space-y-2">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">等待本轮任务</p>
                <p className="text-xs mt-1">提交目标后，系统会在这里展示角色分工与执行状态</p>
              </div>
            ) : (
              agents.map((agent, i) => {
                const expanded = expandedAgentId === agent.id;
                const activity = agentActivity[agent.id] || [];
                return (
                <Card
                  key={agent.id}
                  className={`py-0 gap-0 transition-colors ${expanded ? "border-primary/60 bg-primary/[0.03]" : ""}`}
                  onClick={() => setExpandedAgentId(expanded ? null : agent.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedAgentId(expanded ? null : agent.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                >
                  <CardContent className="p-3 cursor-pointer">
                    <div className="flex items-start gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className={`${AGENT_COLORS[i % AGENT_COLORS.length]} text-white text-xs`}>
                          {getAgentInitial(agent.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{agent.name}</span>
                          {getStateIcon(agent.state)}
                          {expanded ? <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {agent.assignedTask || agent.description}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {agent.priority && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[agent.priority] || ""}`}>
                              {agent.priority}
                            </Badge>
                          )}
                          {agent.tools?.slice(0, 2).map((tool) => (
                            <Badge key={tool} variant="secondary" className="text-[10px] px-1.5 py-0">
                              <Wrench className="h-2.5 w-2.5 mr-0.5" />
                              {tool.replace("_", " ")}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    {expanded && (
                      <div className="mt-3 border-t pt-2.5 space-y-2 text-[11px]" onClick={(event) => event.stopPropagation()}>
                        <div><span className="text-muted-foreground">执行内容：</span>{agent.assignedTask || agent.description || "等待任务"}</div>
                        <div><span className="text-muted-foreground">当前状态：</span>{agent.state === "running" ? "执行中" : agent.state === "completed" ? "已完成" : agent.state === "failed" ? "失败" : "等待执行"}</div>
                        {agent.reason && <div><span className="text-muted-foreground">分工原因：</span>{agent.reason}</div>}
                        <div>
                          <div className="text-muted-foreground mb-1">执行记录</div>
                          {activity.length > 0 ? <div className="space-y-1">{activity.map((entry, index) => <div key={`${agent.id}-activity-${index}`} className="rounded bg-muted/70 px-2 py-1">{entry}</div>)}</div> : <div className="rounded bg-muted/70 px-2 py-1 text-muted-foreground">等待运行记录</div>}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                );
              })
            )}
          </div>
        </div>

        <div className="p-3 border-t shrink-0">
          <button type="button" onClick={() => void openSettings()} className="w-full flex items-center justify-between rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <span className="flex items-center gap-2"><Settings className="h-3.5 w-3.5" />设置</span>
            <span className="flex items-center gap-1.5"><Radio className={`h-2.5 w-2.5 ${ws已连接 ? "text-emerald-500" : "text-amber-500"}`} />{ws已连接 ? "服务正常" : "服务未连接"}</span>
          </button>
        </div>
      </div>}
      {leftSidebarOpen && <div role="separator" aria-orientation="vertical" aria-label="调整左栏宽度" className="group z-10 w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60" onPointerDown={(event) => { event.preventDefault(); beginResize("left", event.clientX); }}><div className="mx-auto h-full w-px bg-transparent group-hover:bg-primary/60" /></div>}
      {!leftSidebarOpen && <Button type="button" variant="outline" size="icon" className="absolute left-2 top-1/2 z-20 h-8 w-8 -translate-y-1/2 bg-card shadow-sm" onClick={() => setLeftSidebarOpen(true)} title="展开左栏" aria-label="展开左栏"><ChevronRight className="h-4 w-4" /></Button>}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Messages - scrollable area */}
        <div className="flex-1 overflow-y-auto" id="chat-scroll-container">
          <div className="max-w-3xl mx-auto p-6 space-y-4">
            {messages.length === 0 ? (
              null
            ) : (
              messages.map((msg) => (
                <div key={msg.id}>
                  {msg.type === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%]">
                        <div className="flex items-center justify-end gap-2 mb-1">
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          <span className="text-xs font-medium">你</span>
                        </div>
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "tool_call" ? (
                    <div className="flex gap-3">
                      <Avatar className="h-7 w-7 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-[10px]`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[80%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl rounded-tl-md px-3 py-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                            <Wrench className="h-3 w-3" />
                            调用工具： {msg.toolCall}
                          </div>
                          {msg.toolInput && Object.keys(msg.toolInput).length > 0 && (
                            <div className="mt-1.5 text-[10px] text-blue-600/70 dark:text-blue-400/70 font-mono bg-blue-100/50 dark:bg-blue-900/30 rounded px-2 py-1 max-h-20 overflow-y-auto">
                              {JSON.stringify(msg.toolInput, null, 2).substring(0, 300)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "tool_result" ? (
                    <div className="flex gap-3">
                      <div className="w-7 shrink-0" />
                      <div className="max-w-[80%]">
                        <div className={`${msg.toolSuccess ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"} border rounded-xl px-3 py-2`}>
                          <div className={`flex items-center gap-1.5 text-xs font-medium ${msg.toolSuccess ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                            {msg.toolSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {msg.toolResult} {msg.toolDuration && `(${msg.toolDuration}ms)`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "evaluation" ? (
                    <div className="flex justify-center">
                      <div className="bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 border border-violet-200 dark:border-violet-800 rounded-xl px-4 py-3 max-w-[90%]">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">质量评估</span>
                          <span className="text-lg font-bold text-violet-700 dark:text-violet-400">
                            {((msg.evaluationData?.score ?? 0) * 100)?.toFixed(0) || "N/A"}%
                          </span>
                        </div>
                        {msg.evaluationData?.dimensions && msg.evaluationData.dimensions.length > 0 && (
                          <div className="grid grid-cols-2 gap-1.5 mb-2">
                            {msg.evaluationData.dimensions.map((dim) => (
                              <div key={dim.name} className="flex items-center gap-1.5 text-[10px]">
                                {dim.passed ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                                )}
                                <span className="capitalize text-muted-foreground">{dim.name}</span>
                                <span className="font-medium ml-auto">{dim.score}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.evaluationData?.strengths && msg.evaluationData.strengths.length > 0 && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            优势： {msg.evaluationData.strengths.slice(0, 2).join("; ")}
                          </div>
                        )}
                        {msg.evaluationData?.weaknesses && msg.evaluationData.weaknesses.length > 0 && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                            待改进： {msg.evaluationData.weaknesses.slice(0, 2).join("; ")}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : msg.type === "result" ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-emerald-500 text-white text-xs">AI</AvatarFallback>
                      </Avatar>
                      <div className="max-w-[85%] min-w-[60%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">IM 智能体</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          {msg.resultData && (
                            <span className="text-[10px] text-muted-foreground">
                              {msg.resultData.mode} · {msg.resultData.agentCount} agent{msg.resultData.agentCount > 1 ? "s" : ""} · {msg.resultData.tokens.toLocaleString()} tokens
                            </span>
                          )}
                        </div>
                        {msg.resultData && msg.resultData.length > 500 ? (
                          <div className="border rounded-xl rounded-tl-md overflow-hidden">
                            <div className="bg-muted/50 px-4 py-3 text-sm leading-relaxed max-h-40 overflow-hidden relative">
                              <div className="whitespace-pre-wrap">{msg.resultData.content.substring(0, 300)}...</div>
                              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-muted/50 to-transparent" />
                            </div>
                            <div className="px-4 py-2.5 bg-muted/30 border-t flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {msg.resultData.length.toLocaleString()} 字符 · 完整内容见右侧报告
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => {
                                    setRightTab("report");
                                    const reportTab = document.querySelector('[data-tab="report"]') as HTMLElement;
                                    if (reportTab) reportTab.click();
                                  }}
                                >
                                  <FileText className="h-3 w-3" />
                                  查看报告
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("markdown")}
                                >
                                  <Download className="h-3 w-3" />
                                  MD
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("html")}
                                >
                                  <Download className="h-3 w-3" />
                                  HTML
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("txt")}
                                >
                                  <Download className="h-3 w-3" />
                                  TXT
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
                              {msg.text}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("markdown")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                MD
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("html")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                HTML
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("txt")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                TXT
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : msg.type === "human_input" && msg.hilData ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-amber-500 text-white text-xs">?</AvatarFallback>
                      </Avatar>
                      <div className="max-w-[85%] min-w-[50%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">IM 智能体</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-full font-medium">需要补充信息</span>
                        </div>
                        <div className="border border-amber-200 dark:border-amber-800 rounded-xl rounded-tl-md overflow-hidden">
                          {msg.hilData.contextHint && (
                            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
                              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                                <MessageCircle className="h-3 w-3" />
                                {msg.hilData.contextHint}
                              </div>
                            </div>
                          )}
                          {msg.hilData.uiSchema && (
                            <div className="p-4">
                              {msg.hilData.uiSchema.title && (
                                <div className="text-sm font-semibold mb-1">{msg.hilData.uiSchema.title}</div>
                              )}
                              {msg.hilData.uiSchema.description && (
                                <div className="text-xs text-muted-foreground mb-3">{msg.hilData.uiSchema.description}</div>
                              )}
                              <div className="space-y-3">
                                {msg.hilData.uiSchema.fields?.map((field) => (
                                  <div key={field.key}>
                                    <label className="text-xs font-medium mb-1 block">
                                      {field.label}
                                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                                    </label>
                                    {field.type === "select" && field.options ? (
                                      <select
                                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      >
                                        <option value="">请选择...</option>
                                        {field.options.map((opt) => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                    ) : field.type === "textarea" ? (
                                      <textarea
                                        className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                        placeholder={field.placeholder || ""}
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      />
                                    ) : (
                                      <input
                                        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                        placeholder={field.placeholder || ""}
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                                {msg.hilData.uiSchema.actions?.map((action) => (
                                  <Button
                                    key={action.key}
                                    variant={action.variant === "primary" ? "default" : action.variant === "danger" ? "destructive" : "outline"}
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => {
                                      if (action.submit) {
                                        handleClarificationSubmit();
                                      } else if (action.key === "cancel" || action.variant === "danger") {
                                        handleClarificationCancel();
                                      }
                                    }}
                                  >
                                    {action.label}
                                  </Button>
                                ))}
                                {!msg.hilData.uiSchema.actions && (
                                  <>
                                    <Button variant="default" size="sm" className="h-8 text-xs" onClick={handleClarificationSubmit}>
                                      确认提交
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleClarificationCancel}>
                                      跳过
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "system" ? (
                    <div className="flex justify-center">
                      <div className="max-w-[92%]">
                        <button
                          type="button"
                          className="bg-muted rounded-full px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5 hover:bg-muted/80"
                          onClick={() => setExpandedMessageIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
                            return next;
                          })}
                        >
                          {msg.toolCall && <Wrench className="h-3 w-3" />}
                          <span>{msg.text}</span>
                          {expandedMessageIds.has(msg.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                        {expandedMessageIds.has(msg.id) && (
                          <div className="mt-1 rounded-lg border bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                            {msg.detail || msg.text}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : msg.thinking ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-xs`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-xs`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[80%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input - fixed at bottom */}
        <div className="border-t p-4 bg-card shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="rounded-lg border bg-card p-2 focus-within:ring-1 focus-within:ring-ring">
              {attachedFile && (
                <div className="mb-1 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-[11px]">
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{attachedFile?.name}</span>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setAttachedFile(null)} aria-label="移除附件">×</button>
                </div>
              )}
              {fileError && <div className="mb-1 px-1 text-[11px] text-destructive">{fileError}</div>}
              <Textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    executeTask();
                  }
                }}
                placeholder={`${MODE_LABELS[currentMode] || "自动"} · ${MODE_DESCRIPTIONS[currentMode] || "输入你的学习或训练需求"}`}
                disabled={isExecuting}
                className="min-h-[44px] max-h-[120px] resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
                rows={1}
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 min-w-0">
                  <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.log" className="hidden" onChange={handleFileSelected} />
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={isExecuting} aria-label="添加参考文件" title="添加参考文件">
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                  <select
                    aria-label="选择协同方式"
                    value={currentMode}
                    onChange={(event) => setCurrentMode(event.target.value)}
                    disabled={isExecuting}
                    className="h-7 max-w-[136px] rounded-md border bg-transparent px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  >
                    {MODE_OPTIONS.map((mode) => (
                      <option key={mode.key} value={mode.key}>{mode.label}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={executeTask} disabled={!taskInput.trim() || isExecuting} size="icon" className="h-8 w-8 shrink-0">
                  {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div role="separator" aria-orientation="vertical" aria-label="调整右栏宽度" className="group z-10 w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60" onPointerDown={(event) => { event.preventDefault(); beginResize("right", event.clientX); }}><div className="mx-auto h-full w-px bg-transparent group-hover:bg-primary/60" /></div>
      <div style={{ width: `${rightPanelWidth}px` }} className="border-l bg-card flex flex-col shrink-0 h-screen transition-[width] duration-150">
        <Tabs value={rightTab} onValueChange={setRightTab} className="flex flex-col h-full">
          <TabsList className="grid w-full shrink-0 grid-cols-4 rounded-none bg-transparent p-0">
            <TabsTrigger value="plan" className="h-10 min-w-0 gap-1 rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <Target className="h-3.5 w-3.5" />
              计划
            </TabsTrigger>
            <TabsTrigger value="workflow" className="h-10 min-w-0 gap-1 rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <Zap className="h-3.5 w-3.5" />
              流程
            </TabsTrigger>
            <TabsTrigger value="tasks" className="h-10 min-w-0 gap-1 rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <Activity className="h-3.5 w-3.5" />
              任务
            </TabsTrigger>
            <TabsTrigger value="report" className="h-10 min-w-0 gap-1 rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <FileText className="h-3.5 w-3.5" />
              结果
            </TabsTrigger>
            <TabsTrigger value="learning-path" className="h-10 min-w-0 gap-1 rounded-none border-b bg-muted/20 px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <Target className="h-3.5 w-3.5" />
              路径
            </TabsTrigger>
            <TabsTrigger value="learning-profile" className="h-10 min-w-0 gap-1 rounded-none border-b bg-muted/20 px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <Users className="h-3.5 w-3.5" />
              画像
            </TabsTrigger>
            <TabsTrigger value="learning-assets" className="h-10 min-w-0 gap-1 rounded-none border-b bg-muted/20 px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <FileText className="h-3.5 w-3.5" />
              资产
            </TabsTrigger>
            <TabsTrigger value="learning-evidence" className="h-10 min-w-0 gap-1 rounded-none border-b bg-muted/20 px-1 text-xs data-[state=active]:border-primary data-[state=active]:shadow-none">
              <CheckCircle2 className="h-3.5 w-3.5" />
              证据
            </TabsTrigger>
          </TabsList>

          {/* Plan Tab */}
          <TabsContent value="plan" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-4">
              {!plan ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无协作计划</p>
                  <p className="text-xs mt-1">提交任务后可生成协作计划</p>
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">目标</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{plan.goal}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">模式</div>
                      <div className="text-xs font-medium">{plan.collaborationMode}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">任务</div>
                      <div className="text-xs font-medium">{plan.subTaskCount}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">协作结构</div>
                      <div className="text-xs font-medium">{plan.communicationStructure || "supervisor"}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">目标规模</div>
                      <div className="text-xs font-medium">{plan.qualityThresholds?.minWordCount?.toLocaleString() || "30,000"} 字</div>
                    </div>
                  </div>

                  {plan.executionStrategy && (
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">执行策略</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{plan.executionStrategy}</p>
                    </div>
                  )}

                  {plan.successCriteria && plan.successCriteria.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">成功标准</h3>
                      <ul className="space-y-1">
                        {plan.successCriteria.map((c, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Separator />

                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">子任务流程</h3>
                    <div className="space-y-1.5">
                      {subTasks.map((task, i) => (
                        <div key={task.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                          <div className="shrink-0">{getTaskStatusIcon(task.status)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{task.title}</div>
                            <div className="text-[10px] text-muted-foreground">{task.assignedAgentName}</div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_COLORS[task.priority] || ""}`}>
                            {task.priority}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Workflow Flow Tab */}
          <TabsContent value="workflow" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-4">
              {workflowPhases.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无工作流</p>
                  <p className="text-xs mt-1">使用工作流模式后可查看完整执行过程</p>
                </div>
              ) : (
                <>
                  {workflowMeta && (
                    <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">{workflowMeta.name}</span>
                      </div>
                      <p className="text-xs text-violet-600/80 dark:text-violet-400/80">{workflowMeta.description}</p>
                    </div>
                  )}

                  <div className="space-y-0">
                    {workflowPhases.map((phase, pi) => {
                      const isLast = pi === workflowPhases.length - 1;
                      const completedAgents = phase.agents.filter((a) => a.status === "completed" || a.status === "skipped").length;
                      const totalAgents = phase.agents.length;
                      const phaseProgress = totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0;

                      return (
                        <div key={pi}>
                          <div className={`p-3 rounded-lg border ${
                            phase.status === "running"
                              ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20"
                              : phase.status === "completed"
                              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10"
                              : phase.status === "failed"
                              ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                              : "border-border bg-muted/30"
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                phase.status === "running"
                                  ? "bg-blue-500 text-white animate-pulse"
                                  : phase.status === "completed"
                                  ? "bg-emerald-500 text-white"
                                  : phase.status === "failed"
                                  ? "bg-red-500 text-white"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {phase.status === "completed" ? "✓" : phase.status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : pi + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{phase.title}</span>
                                  {phase.status === "running" && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                                      Running
                                    </Badge>
                                  )}
                                </div>
                                {totalAgents > 0 && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <Progress value={phaseProgress} className="flex-1 h-1.5" />
                                    <span className="text-[10px] text-muted-foreground">{completedAgents}/{totalAgents}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {phase.agents.length > 0 && (
                              <div className="ml-8 space-y-1.5 mt-2">
                                {phase.agents.map((agent) => (
                                  <div key={agent.id} className={`flex items-center gap-2 p-2 rounded-md text-xs ${
                                    agent.status === "running"
                                      ? "bg-blue-100/50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                                      : agent.status === "completed"
                                      ? "bg-emerald-50 dark:bg-emerald-950/10"
                                      : agent.status === "failed"
                                      ? "bg-red-50 dark:bg-red-950/10"
                                      : "bg-muted/50"
                                  }`}>
                                    <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                                      agent.status === "running"
                                        ? "bg-blue-500 text-white"
                                        : agent.status === "completed"
                                        ? "bg-emerald-500 text-white"
                                        : agent.status === "failed"
                                        ? "bg-red-500 text-white"
                                        : "bg-muted text-muted-foreground"
                                    }`}>
                                      {agent.status === "running" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
                                       agent.status === "completed" ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                                       agent.status === "failed" ? <XCircle className="h-2.5 w-2.5" /> :
                                       <Circle className="h-2.5 w-2.5" />}
                                    </div>
                                    <span className="font-medium truncate flex-1">{agent.label}</span>
                                    {agent.status === "running" && (
                                      <span className="text-[10px] text-blue-600 dark:text-blue-400 animate-pulse">执行中…</span>
                                    )}
                                    {agent.status === "completed" && agent.outputLength !== undefined && (
                                      <span className="text-[10px] text-muted-foreground">{agent.outputLength.toLocaleString()} 字符</span>
                                    )}
                                    {agent.status === "failed" && agent.error && (
                                      <span className="text-[10px] text-red-600 dark:text-red-400 truncate max-w-[100px]">{agent.error}</span>
                                    )}
                                    {agent.startedAt && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {agent.completedAt ? formatDuration(agent.completedAt - agent.startedAt) : "执行中…"}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {!isLast && (
                            <div className="flex justify-center py-1">
                              <div className={`w-0.5 h-4 ${
                                phase.status === "completed" ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"
                              }`} />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {workflowPhases.length > 0 && workflowPhases.every((p) => p.status === "completed") && (
                      <div className="flex justify-center py-2">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">全部阶段已汇总，工作流执行完成</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold">{workflowPhases.length}</div>
                      <div className="text-[10px] text-muted-foreground">阶段</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold">{workflowPhases.reduce((sum, p) => sum + p.agents.length, 0)}</div>
                      <div className="text-[10px] text-muted-foreground">智能体</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold text-emerald-600">
                        {workflowPhases.reduce((sum, p) => sum + p.agents.filter((a) => a.status === "completed").length, 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">已完成</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-2">
              {subTasks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无任务</p>
                </div>
              ) : (
                subTasks.map((task) => (
                  <Card key={task.id} className="py-0 gap-0">
                    <CardContent className="p-3">
                      <div
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => toggleTaskExpand(task.id)}
                      >
                        {expandedTasks.has(task.id) ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        {getTaskStatusIcon(task.status)}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{task.title}</div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_COLORS[task.priority] || ""}`}>
                          {task.priority}
                        </Badge>
                      </div>

                      {expandedTasks.has(task.id) && (
                        <div className="mt-3 space-y-2 pl-6">
                          <div>
                            <span className="text-[10px] text-muted-foreground">智能体：</span>
                            <span className="text-xs ml-1">{task.assignedAgentName} ({task.assignedAgentType})</span>
                          </div>
                          {task.description && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">说明：</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                            </div>
                          )}
                          {task.expectedOutput && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">预期输出：</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{task.expectedOutput}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-[10px] text-muted-foreground">工具：</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {task.tools.map((tool) => (
                                <Badge key={tool} variant="secondary" className="text-[10px] px-1.5 py-0">
                                  <Wrench className="h-2.5 w-2.5 mr-0.5" />
                                  {tool.replace("_", " ")}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          {task.dependencies.length > 0 && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">依赖：</span>
                              <span className="text-xs ml-1">{task.dependencies.join(", ")}</span>
                            </div>
                          )}
                          {task.outputLength !== undefined && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">输出：</span>
                              <span className="text-xs ml-1">{task.outputLength.toLocaleString()} 字符</span>
                            </div>
                          )}
                          {task.error && (
                            <div className="text-xs text-destructive">错误： {task.error}</div>
                          )}
                          {task.startTime && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {formatTime(task.startTime)}
                              {task.endTime && ` → ${formatTime(task.endTime)} (${formatDuration(task.endTime - task.startTime)})`}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Stats Tab */}
          <TabsContent value="stats" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-4">
              {!stats ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无统计数据</p>
                  <p className="text-xs mt-1">执行任务后可查看统计信息</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">任务总数</div>
                      <div className="text-lg font-bold">{stats.totalTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">已完成</div>
                      <div className="text-lg font-bold text-emerald-600">{stats.completedTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">失败</div>
                      <div className="text-lg font-bold text-destructive">{stats.failedTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">迭代次数</div>
                      <div className="text-lg font-bold">{stats.iterations}</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">质量评分</div>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-bold">{(stats.evaluationScore * 100).toFixed(0)}%</div>
                      <Progress value={stats.evaluationScore * 100} className="flex-1 h-2" />
                    </div>
                  </div>

                  {evaluationResult?.dimensions && evaluationResult.dimensions.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-2">评估维度</div>
                      <div className="space-y-2">
                        {evaluationResult.dimensions.map((dim) => (
                          <div key={dim.name}>
                            <div className="flex items-center justify-between text-xs mb-0.5">
                              <span className="capitalize font-medium flex items-center gap-1">
                                {dim.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                                {dim.name}
                              </span>
                              <span className="text-muted-foreground">{dim.score}%</span>
                            </div>
                            <Progress value={dim.score} className="h-1.5" />
                            {dim.feedback && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{dim.feedback}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {evaluationResult?.strengths && evaluationResult.strengths.length > 0 && (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mb-1">优势</div>
                      <ul className="space-y-0.5">
                        {evaluationResult.strengths.map((s, i) => (
                          <li key={i} className="text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-1">
                            <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evaluationResult?.weaknesses && evaluationResult.weaknesses.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 mb-1">待改进</div>
                      <ul className="space-y-0.5">
                        {evaluationResult.weaknesses.map((w, i) => (
                          <li key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                            <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">执行耗时</div>
                    <div className="text-lg font-bold">{formatDuration(stats.executionTime)}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">总 Token 数</div>
                    <div className="text-lg font-bold">{stats.totalTokens.toLocaleString()}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">报告长度</div>
                    <div className="text-lg font-bold">{stats.finalOutputLength.toLocaleString()} 字符</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ~{Math.round(stats.finalOutputLength / 2).toLocaleString()} 字（中文估算）
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-2">任务完成情况</div>
                    {subTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-2 mb-1.5">
                        {getTaskStatusIcon(task.status)}
                        <span className="text-xs flex-1 truncate">{task.title}</span>
                        {task.outputLength !== undefined && (
                          <span className="text-[10px] text-muted-foreground">{task.outputLength.toLocaleString()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Report Tab */}
          <TabsContent value="report" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-3">
              {!finalOutput ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无报告</p>
                  <p className="text-xs mt-1">执行协作任务后可生成报告</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">最终报告</h3>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => downloadReport("markdown")}>
                        <Download className="h-3 w-3 mr-1" />
                        .md
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadReport("html")}>
                        <Download className="h-3 w-3 mr-1" />
                        .html
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadReport("txt")}>
                        <Download className="h-3 w-3 mr-1" />
                        .txt
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {finalOutput.length.toLocaleString()} 字符 | 约 {Math.round(finalOutput.length / 2).toLocaleString()} words
                  </div>
                  <Separator />
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap break-words">
                    {finalOutput}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Learning Path Tab */}
          <TabsContent value="learning-path" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">学习路径</h3>
                <p className="text-xs text-muted-foreground mt-1">由学习证据驱动的可执行 TODO，不是固定课程目录。</p>
              </div>
              {learningPanelLoading && learningPath.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">正在读取路径…</div> : learningPath.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">提交一次学习任务后生成路径</div> : <div className="space-y-2">{learningPath.map((item, index) => <div key={item.id} className="flex gap-2.5"><div className="flex flex-col items-center">{item.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : item.status === "active" ? <ArrowRight className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}{index < learningPath.length - 1 && <div className="w-px flex-1 bg-border my-1" />}</div><div className="pb-3 flex-1 min-w-0"><div className="flex items-center gap-2"><span className={`text-xs font-medium ${item.status === "active" ? "text-primary" : ""}`}>{item.title}</span><Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{item.status === "active" ? "当前" : item.status === "pending" ? "待完成" : item.status}</Badge></div><p className="text-[10px] text-muted-foreground mt-1">{item.reason}</p><p className="text-[10px] text-muted-foreground mt-1">完成标准：{item.completionCriteria}</p></div></div>)}</div>}
            </div>
          </TabsContent>

          {/* Learner Profile Tab */}
          <TabsContent value="learning-profile" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-4">
              <div><h3 className="text-sm font-semibold">学习画像</h3><p className="text-xs text-muted-foreground mt-1">数值来自学习记录，模型只负责生成解释。</p></div>
              {learningPanelLoading && !learningProfile ? <div className="text-xs text-muted-foreground py-8 text-center">正在读取画像…</div> : learningProfile ? <>
                <div className="flex items-start gap-2">
                  <div className={`flex-1 p-3 rounded-lg ${learningProfile.status === "learning" ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-muted"}`}><p className="text-xs leading-relaxed">{learningProfile.summary}</p></div>
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void regenerateLearningProfile()} title="重新生成画像"><RefreshCw className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="flex flex-wrap gap-1.5">{learningProfile.keywords.length > 0 ? learningProfile.keywords.map((keyword) => <Badge key={keyword} variant="secondary" className="text-[10px]">{keyword}</Badge>) : <span className="text-[11px] text-muted-foreground">完成一次学习任务后生成关键词</span>}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-muted"><div className="text-[10px] text-muted-foreground">学习时间</div><div className="text-lg font-bold">{learningProfile.studyMinutes}<span className="text-xs font-normal ml-1">分钟</span></div></div>
                  <div className="p-3 rounded-lg bg-muted"><div className="text-[10px] text-muted-foreground">学习资产</div><div className="text-lg font-bold">{learningProfile.assetsCount}</div></div>
                  <div className="p-3 rounded-lg bg-muted"><div className="text-[10px] text-muted-foreground">今日资产</div><div className="text-lg font-bold">{learningProfile.todayAssetsCount}</div></div>
                  <div className="p-3 rounded-lg bg-muted"><div className="text-[10px] text-muted-foreground">正确率</div><div className="text-lg font-bold">{learningProfile.accuracy === null ? "—" : `${Math.round(learningProfile.accuracy * 100)}%`}</div></div>
                </div>
                <div><h4 className="text-xs font-medium mb-2">能力雷达</h4><LearningRadar items={learningProfile.radar} /></div>
                <div><h4 className="text-xs font-medium mb-2">知识点状态</h4>{learningProfile.skills.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">尚未有答题记录，暂不判断掌握度。</div> : <div className="space-y-3">{learningProfile.skills.map((skill) => <div key={skill.knowledgePointId}><div className="flex items-center justify-between text-xs"><span>{skill.knowledgePointId}</span><span>{Math.round(skill.mastery * 100)}%</span></div><Progress value={skill.mastery * 100} className="h-1.5 mt-1" /><div className="text-[10px] text-muted-foreground mt-1">{skill.attemptCount} 次作答 · 正确 {skill.correctCount} 次 · 置信度 {Math.round(skill.confidence * 100)}%</div></div>)}</div>}</div>
              </> : <div className="text-xs text-muted-foreground py-8 text-center">暂无画像数据</div>}
            </div>
          </TabsContent>

          {/* Learning Assets Tab */}
          <TabsContent value="learning-assets" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-3">
              <div><h3 className="text-sm font-semibold">学习资产</h3><p className="text-xs text-muted-foreground mt-1">讲义、实操和测评都来自已审核的协同产物。</p></div>
              {learningPanelLoading && learningAssets.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">正在读取资产…</div> : learningAssets.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">提交一次学习任务后，这里会保存讲义、分层练习和知识图谱</div> : <div className="space-y-2">{learningAssets.map((asset) => <button type="button" key={asset.id} onClick={() => setSelectedLearningAsset(selectedLearningAsset?.id === asset.id ? null : asset)} className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedLearningAsset?.id === asset.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">{asset.type === "lecture" ? "讲义" : asset.type === "tiered_quiz" ? "分层练习" : asset.type === "concept_map" ? "知识图谱" : "实操指南"}</span><Badge variant={asset.auditStatus === "passed" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">{asset.auditStatus === "passed" ? "已审核" : "待复核"}</Badge></div><div className="text-xs font-medium mt-1 line-clamp-2">{asset.title}</div><div className="text-[10px] text-muted-foreground mt-2">{asset.evidenceIds.length} 条证据 · {asset.blocks.length} 个内容块</div></button>)}</div>}
              {selectedLearningAsset && <div className="border-t pt-3"><h4 className="text-xs font-medium mb-2">资产内容预览</h4><div className="space-y-2">{selectedLearningAsset.blocks.slice(0, 4).map((block, index) => <div key={`${selectedLearningAsset.id}-${index}`} className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">{Array.isArray(block.content) ? block.content.join("；") : typeof block.content === "object" && block.content !== null ? `证据：${String((block.content as { locator?: string }).locator ?? "已绑定")}` : String(block.content)}</div>)}</div></div>}
            </div>
          </TabsContent>

          {/* Evidence Tab */}
          <TabsContent value="learning-evidence" className="flex-1 mt-0 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="p-4 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">证据链</h3>
                  {activeEvidenceSummary?.packCoverageScore !== null && activeEvidenceSummary?.packCoverageScore !== undefined && (
                    <Badge variant="secondary" className="text-[10px]">覆盖 {Math.round(activeEvidenceSummary.packCoverageScore * 100)}%</Badge>
                  )}
                </div>
                {activeEvidenceSummary?.packQuery && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{activeEvidenceSummary.packQuery}</p>}
              </div>
              {learningPanelLoading && learningEvidence.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">正在读取证据…</div> : learningEvidence.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">生成学习任务后，这里会出现来源证据。</div> : <>
                {activeCrossValidation && <div className={`rounded-lg border p-3 ${activeCrossValidation.status === "corroborated" ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">交叉验证</span>
                    <Badge variant="outline" className="text-[10px]">{activeCrossValidation.status === "corroborated" ? "双来源通过" : activeCrossValidation.status === "conflict" ? "存在冲突" : "需要复核"}</Badge>
                  </div>
                  <div className="mt-2 space-y-1.5">{activeCrossValidation.checks?.map((check) => <div key={check.id} className="flex items-start gap-2 text-[10px]"><span className={check.status === "passed" ? "text-emerald-600" : check.status === "failed" ? "text-red-600" : "text-amber-600"}>{check.status === "passed" ? "✓" : check.status === "failed" ? "×" : "!"}</span><span className="min-w-0 flex-1"><span className="font-medium">{check.label}</span><span className="text-muted-foreground"> · {check.detail}</span></span></div>)}</div>
                </div>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted p-2"><div className="text-[10px] text-muted-foreground">数据证据</div><div className="text-sm font-semibold">{structuredEvidence.length}</div></div>
                  <div className="rounded-md bg-muted p-2"><div className="text-[10px] text-muted-foreground">文档证据</div><div className="text-sm font-semibold">{documentEvidence.length}</div></div>
                </div>
                <div className="space-y-2">
                  {activeEvidence.map((item) => {
                    const expanded = expandedEvidenceIds.has(item.id);
                    const title = item.sourceTitle || (item.sourceType === "dataset" ? "MetroPT-3 CSV" : "领域文档");
                    return <button type="button" key={item.id} onClick={() => setExpandedEvidenceIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.sourceType === "dataset" ? "CSV 数据" : "PDF 文档"}</Badge>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
                        <span className="text-[10px] text-muted-foreground">{Math.round(item.relevanceScore * 100)}%</span>
                        <span className="text-xs text-muted-foreground">{expanded ? "−" : "+"}</span>
                      </div>
                      <div className="mt-1.5 text-[10px] text-muted-foreground">{item.retrievalMethod === "sql" ? "SQL 精确查询" : "全文检索"} · {item.trustLevel === "high" ? "高可信" : "待复核"}</div>
                      <p className="mt-1.5 break-all font-mono text-[10px] text-muted-foreground">{item.locator}</p>
                      <p className={`mt-2 text-xs leading-relaxed ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{item.content}</p>
                      {expanded && item.sourceScope === "session_upload" && <div className="mt-2 text-[10px] text-amber-700">仅本次任务参考 · 不写入公共知识库</div>}
                    </button>;
                  })}
                </div>
                {activeEvidenceSummary?.privacy?.temporaryReferenceUsed && <div className="rounded-md border border-dashed p-2 text-[10px] text-muted-foreground">本次包含用户临时参考资料：仅记录使用状态，不保存原文。</div>}
              </>}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-2xl rounded-xl border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="settings-title" className="text-sm font-semibold">设置</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
                <XCircle className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-4 rounded-lg bg-muted/70 p-1">
              {([
                ["models", "模型服务"],
                ["agents", "协同编排"],
                ["assets", "学习资产"],
                ["privacy", "本地数据"],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => { setSettingsTab(key); setSettingsError(""); }} className={`rounded-md px-2 py-2 text-xs transition-colors ${settingsTab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 min-h-[300px]">
              {settingsTab === "models" && <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium">模型服务</div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setProviderError(""); setProviderFormOpen((open) => !open); }}>
                    <Plus className="h-3 w-3 mr-1" />添加服务
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-2 rounded-md bg-muted/60 px-3 py-2.5">
                  <span className="text-xs font-medium">系统默认</span>
                  <select aria-label="系统默认模型" value={runtimeSettings?.activeModel ?? ""} disabled={settingsSaving || !runtimeSettings?.models.length} onChange={(event) => void saveDefaultExecution({ activeModel: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring">
                    {runtimeSettings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
                  </select>
                  <select aria-label="系统默认思考深度" value={runtimeSettings?.defaultThinkingDepth ?? "medium"} disabled={settingsSaving || !runtimeSettings} onChange={(event) => void saveDefaultExecution({ defaultThinkingDepth: event.target.value as ThinkingDepth })} className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option>
                  </select>
                </div>
                <div className="mt-3 space-y-2">
                  {runtimeSettings?.providers.length ? runtimeSettings.providers.map((provider) => (
                    <div key={provider.id} className="rounded-md bg-muted/60 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0"><div className="text-xs font-medium truncate">{provider.displayName}</div><div className="text-[10px] text-muted-foreground mt-1 truncate">{provider.id} · {provider.models.length ? provider.models.map((model) => <button key={model.id} type="button" className="mr-1 underline-offset-2 hover:underline" onClick={() => editModelDisplayName(provider, model)}>{model.displayName}</button>) : "未添加模型"}</div></div>
                        <Badge variant={provider.apiKeyConfigured ? "secondary" : "outline"} className="text-[10px] shrink-0">{provider.apiKeyConfigured ? "已连接" : "未配置"}</Badge>
                      </div>
                    </div>
                  )) : <div className="py-4 text-center text-xs text-muted-foreground">正在读取模型服务…</div>}
                </div>
                {providerFormOpen && <div className="mt-3 rounded-md border p-3">
                  <div className="text-xs font-medium">添加模型服务</div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <Input value={providerForm.displayName} onChange={(event) => setProviderForm((form) => ({ ...form, displayName: event.target.value }))} placeholder="服务名称" className="h-8 text-xs" />
                    <Input value={providerForm.id} onChange={(event) => setProviderForm((form) => ({ ...form, id: event.target.value }))} placeholder="服务 ID，如 deepseek" className="h-8 text-xs" />
                    <Input value={providerForm.baseURL} onChange={(event) => setProviderForm((form) => ({ ...form, baseURL: event.target.value }))} placeholder="接口地址 https://…" className="h-8 text-xs col-span-2" />
                    <Input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="API Key" className="h-8 text-xs col-span-2" />
                    <Input value={providerForm.modelId} onChange={(event) => setProviderForm((form) => ({ ...form, modelId: event.target.value }))} placeholder="模型 ID" className="h-8 text-xs" />
                    <Input value={providerForm.modelDisplayName} onChange={(event) => setProviderForm((form) => ({ ...form, modelDisplayName: event.target.value }))} placeholder="自定义显示名，如主力模型" className="h-8 text-xs" />
                  </div>
                  {providerError && <div className="text-xs text-destructive mt-2">{providerError}</div>}
                  <div className="flex justify-end gap-2 mt-3"><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setProviderFormOpen(false)}>取消</Button><Button size="sm" className="h-7 text-xs" onClick={() => void saveProvider()} disabled={providerSaving}>{providerSaving ? "保存中…" : "保存服务"}</Button></div>
                </div>}
              </div>}

              {settingsTab === "agents" && <div className="rounded-lg border divide-y">
                <div className="grid grid-cols-[minmax(0,1fr)_132px_88px] gap-3 bg-muted/50 px-3 py-2 text-[10px] text-muted-foreground"><span>角色</span><span>模型</span><span>思考</span></div>
                {AGENT_ROUTE_LABELS.map((agent) => {
                  const route = runtimeSettings?.agentRouting[agent.id] ?? { modelId: "", thinkingDepth: "inherit" as const };
                  const defaultModelName = runtimeSettings?.models.find((model) => model.id === runtimeSettings.activeModel)?.displayName ?? "系统默认模型";
                  const defaultDepth = runtimeSettings?.defaultThinkingDepth ?? "medium";
                  return <div key={agent.id} className="grid grid-cols-[minmax(0,1fr)_132px_88px] items-center gap-3 px-3 py-3">
                    <div className="min-w-0"><div className="text-xs font-medium">{agent.name}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{agent.specialty}</div></div>
                    <select aria-label={`${agent.name}模型`} value={route.modelId} disabled={settingsSaving || !runtimeSettings} onChange={(event) => void saveAgentRoute(agent.id, { modelId: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"><option value="">系统默认：{defaultModelName}</option>{runtimeSettings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>
                    <select aria-label={`${agent.name}思考深度`} value={route.thinkingDepth} disabled={settingsSaving || !runtimeSettings} onChange={(event) => void saveAgentRoute(agent.id, { thinkingDepth: event.target.value as AgentRoute["thinkingDepth"] })} className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"><option value="inherit">默认：{defaultDepth}</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select>
                  </div>;
                })}
              </div>}

              {settingsTab === "assets" && <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between"><div className="text-xs font-medium">任务后自动生成</div><Badge variant="outline" className="text-[10px]">仅保存已审核资产</Badge></div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([
                    ["lecture", "讲义", "知识解释与要点"],
                    ["tiered_quiz", "分层习题", "基础到迁移训练"],
                    ["concept_map", "知识图谱", "概念关系梳理"],
                  ] as const).map(([type, label, detail]) => {
                    const enabled = runtimeSettings?.autoAssetTypes.includes(type) ?? false;
                    return <button key={type} type="button" disabled={settingsSaving || !runtimeSettings} onClick={() => {
                      const current = runtimeSettings?.autoAssetTypes ?? [];
                      const next = enabled ? current.filter((item) => item !== type) : [...current, type];
                      void saveAutoAssetTypes(next);
                    }} className={`rounded-md border p-3 text-left transition-colors ${enabled ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span><CheckCircle2 className={`h-3.5 w-3.5 ${enabled ? "text-emerald-500" : "text-muted-foreground/40"}`} /></div><div className="mt-1 text-[10px] text-muted-foreground">{detail}</div></button>;
                  })}
                </div>
              </div>}

              {settingsTab === "privacy" && <div className="rounded-lg border">
                <div className="grid grid-cols-2 divide-x border-b text-xs"><div className="flex items-center justify-between px-3 py-3"><span>学习记录</span><Badge variant="outline" className="text-[10px]">本地 SQLite</Badge></div><div className="flex items-center justify-between px-3 py-3"><span>上传原文</span><Badge variant="outline" className="text-[10px]">不保存</Badge></div></div>
                <div className="p-3"><div className="flex items-center justify-between gap-3"><div className="text-xs font-medium">临时资料使用记录</div><Button variant="outline" size="sm" className="h-7 text-xs" disabled={settingsSaving || privacyAuditEvents.length === 0} onClick={() => void clearPrivacyAuditEvents()}>清除记录</Button></div>
                  <div className="mt-3 space-y-2">{privacyAuditLoading ? <div className="py-4 text-center text-xs text-muted-foreground">正在读取记录…</div> : privacyAuditEvents.length === 0 ? <div className="rounded-md bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">暂无临时资料使用记录</div> : privacyAuditEvents.map((event) => <div key={event.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate font-medium">{event.fileName || "临时参考资料"}</span><span className="shrink-0 text-[10px] text-muted-foreground">{new Date(event.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div><div className="mt-1 text-[10px] text-muted-foreground">{event.byteCount ? `${Math.ceil(event.byteCount / 1024)} KB` : "大小未记录"} · 已脱敏 {event.redactedFieldCount} 项 · 原文未留存</div></div>)}</div>
                </div>
              </div>}
              {settingsError && <div className="mt-3 text-xs text-destructive">{settingsError}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




