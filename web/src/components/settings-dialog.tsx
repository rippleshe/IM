"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Settings } from "lucide-react";

type ThinkingDepth = "low" | "medium" | "high" | "max";
type AgentRoute = { modelId: string; thinkingDepth: "inherit" | ThinkingDepth };
type RuntimeSettings = {
  activeModel: string;
  defaultThinkingDepth: ThinkingDepth;
  providers: Array<{ id: string; displayName: string; baseURL: string; apiKeyConfigured: boolean; models: Array<{ id: string; displayName: string }> }>;
  models: Array<{ id: string; displayName: string; provider: string; providerDisplayName: string }>;
  agentRouting: Record<string, AgentRoute>;
};

type PrivacyEvent = {
  id: string;
  eventType: string;
  fileName: string | null;
  byteCount: number | null;
  redactedFieldCount: number;
  createdAt: number;
};

type DataPrivacyOverview = {
  source: { kind: "postgres"; label: string; detail: string };
  records: { assets: number; pathNodes: number; studyMessages: number; resourceQaMessages: number; evidenceItems: number; auditEvents: number; profileEvidence: number };
  retention: { temporaryReference: string; sharedKnowledge: string; audit: string };
};

const agentLabels: Array<[string, string, string | null]> = [
  ["learning_planning", "学情与路径", null],
  ["evidence_retrieval", "知识检索", "同时检索数据和资料"],
  ["domain_expert", "领域诊断", null],
  ["resource_generation", "资源生成", null],
  ["cross_validation", "交叉检查", "发布前固定检查，不可关闭"],
  ["privacy_compliance", "合规与隐私", "发布前固定检查，不可关闭"],
];

const privacyEventLabels: Record<string, string> = {
  temporary_reference_used: "临时参考已使用（原文未保存）",
};

function readableError(reason: unknown, fallback: string) {
  if (reason instanceof TypeError && /fetch/i.test(reason.message)) {
    return "无法连接到应用服务，请确认服务已启动后重试。";
  }
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback;
}

function PrivacyPanel({ apiBase }: { apiBase: string }) {
  const [overview, setOverview] = useState<DataPrivacyOverview | null>(null);
  const [events, setEvents] = useState<PrivacyEvent[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const load = useCallback(async () => {
    try {
      const [overviewResponse, eventsResponse] = await Promise.all([
        fetch(`${apiBase}/api/settings/data-privacy`, { credentials: "include" }),
        fetch(`${apiBase}/api/settings/privacy-audit?limit=8`, { credentials: "include" }),
      ]);
      const overviewData = await overviewResponse.json() as DataPrivacyOverview & { success?: boolean };
      const eventsData = await eventsResponse.json() as { events?: PrivacyEvent[] };
      if (!overviewResponse.ok || !overviewData.success) throw new Error("数据状态读取失败");
      setOverview(overviewData);
      setEvents(eventsData.events ?? []);
    } catch { setOverview(null); setEvents([]); }
  }, [apiBase]);
  useEffect(() => { void load(); }, [load]);
  const clear = async () => {
    if (!window.confirm("清除全部隐私审计记录？审计记录本身不包含资料原文。")) return;
    setClearing(true);
    try {
      await fetch(`${apiBase}/api/settings/privacy-audit`, { method: "DELETE", credentials: "include" });
      await load();
    } finally { setClearing(false); }
  };
  const exportData = () => {
    setExporting(true);
    const link = document.createElement("a");
    link.href = `${apiBase}/api/settings/export`;
    link.download = "im-training-agent-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => setExporting(false), 700);
  };
  return <div className="space-y-4">
    <section className="rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-medium">数据位置</div><div className="mt-1 text-sm font-semibold">{overview?.source.label ?? "读取中"}</div></div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">当前使用</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-muted/50 p-2.5"><div className="text-lg font-semibold">{overview?.records.assets ?? "—"}</div><div className="text-[11px] text-muted-foreground">资源</div></div><div className="rounded-lg bg-muted/50 p-2.5"><div className="text-lg font-semibold">{overview?.records.pathNodes ?? "—"}</div><div className="text-[11px] text-muted-foreground">路径节点</div></div><div className="rounded-lg bg-muted/50 p-2.5"><div className="text-lg font-semibold">{overview?.records.profileEvidence ?? "—"}</div><div className="text-[11px] text-muted-foreground">学习证据</div></div></div>
      <div className="mt-3 text-xs text-muted-foreground">{overview?.source.detail ?? "正在读取数据状态"}</div>
      <button type="button" disabled={exporting} onClick={exportData} className="mt-3 h-9 w-full rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50">{exporting ? "正在导出" : "导出我的学习数据"}</button>
    </section>
    <section className="divide-y rounded-xl border bg-background text-xs">
      <div className="flex items-center justify-between gap-4 px-4 py-3"><span>画像</span><span className="text-right text-muted-foreground">学习路径、作答、资源与问答记录</span></div>
      <div className="flex items-center justify-between gap-4 px-4 py-3"><span>临时参考资料</span><span className="text-right text-emerald-700">任务结束即丢弃原文</span></div>
      <div className="flex items-center justify-between gap-4 px-4 py-3"><span>公共知识库</span><span className="text-right text-muted-foreground">只读，不写入个人资料</span></div>
      <div className="flex items-center justify-between gap-4 px-4 py-3"><span className="flex items-center gap-1.5"><Lock className="h-3 w-3" />审核与隐私保护</span><span className="text-right text-muted-foreground">系统固定保护</span></div>
    </section>
    <section className="rounded-xl border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3"><span className="text-xs font-medium">隐私审计记录 · {overview?.records.auditEvents ?? 0}</span><button type="button" disabled={clearing || !events?.length} onClick={() => void clear()} className="rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40">{clearing ? "清除中" : "清除记录"}</button></div>
      <div className="max-h-48 overflow-y-auto p-2">{events === null ? <div className="px-2 py-3 text-xs text-muted-foreground">正在读取</div> : events.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground">暂无审计记录</div> : events.map((event) => <div key={event.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[11px] hover:bg-muted/50"><span className="min-w-0 truncate">{privacyEventLabels[event.eventType] ?? event.eventType}<span className="text-muted-foreground"> · {event.fileName ?? "未知文件"}</span></span><span className="shrink-0 text-muted-foreground">{event.byteCount === null ? "" : `${Math.max(1, Math.round(event.byteCount / 1024))} KB · `}{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(event.createdAt)}</span></div>)}</div>
    </section>
  </div>;
}

export function SettingsDialog({ apiBase, onClose }: { apiBase: string; onClose: () => void }) {
  const [tab, setTab] = useState<"models" | "agents" | "privacy">("models");
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
  const [providerModels, setProviderModels] = useState<Array<{ id: string; displayName: string }>>([]);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [connection, setConnection] = useState<{ state: "idle" | "testing" | "connected" | "failed"; text: string }>({ state: "idle", text: "" });

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const response = await fetch(`${apiBase}/api/settings`, { credentials: "include" });
      const data = await response.json() as RuntimeSettings & { success?: boolean };
      if (!response.ok || !data.success) throw new Error("设置读取失败");
      setSettings(data);
    } catch (reason) {
      setError(readableError(reason, "设置读取失败"));
    } finally {
      setLoadingSettings(false);
    }
  }, [apiBase]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const saveDefault = async (patch: Partial<Pick<RuntimeSettings, "activeModel" | "defaultThinkingDepth">>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/default-execution`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: next.activeModel, thinkingDepth: next.defaultThinkingDepth }) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "默认设置保存失败");
      setSettings(data);
    } catch (reason) {
      setError(readableError(reason, "默认设置保存失败"));
      await loadSettings();
    } finally { setSaving(false); }
  };

  const saveProvider = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/providers`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerForm) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "模型服务保存失败");
      setSettings(data);
      setProviderOpen(false);
      setProviderForm({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
      setProviderModels([]);
    } catch (reason) { setError(readableError(reason, "模型服务保存失败")); }
    finally { setSaving(false); }
  };

  const discoverModels = async () => {
    setDiscoveringModels(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/provider-models`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: providerForm.id, baseURL: providerForm.baseURL, apiKey: providerForm.apiKey }),
      });
      const data = await response.json() as { success?: boolean; error?: string; models?: Array<{ id: string; displayName: string }> };
      if (!response.ok || !data.success) throw new Error(data.error || "模型目录读取失败");
      const models = data.models ?? [];
      setProviderModels(models);
      if (models.length === 0) throw new Error("服务商没有返回可用模型，可直接填写模型 ID");
      const selected = models.find((model) => model.id === providerForm.modelId) ?? models[0]!;
      setProviderForm((form) => ({ ...form, modelId: selected.id, modelDisplayName: selected.displayName }));
    } catch (reason) {
      setProviderModels([]);
      setError(readableError(reason, "模型目录读取失败"));
    } finally { setDiscoveringModels(false); }
  };

  const saveAgentRoute = async (agentId: string, patch: Partial<AgentRoute>) => {
    if (!settings) return;
    const agentRouting = { ...settings.agentRouting, [agentId]: { modelId: settings.agentRouting[agentId]?.modelId ?? "", thinkingDepth: settings.agentRouting[agentId]?.thinkingDepth ?? "inherit", ...patch } };
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/agent-routing`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentRouting }) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "任务分工保存失败");
      setSettings(data);
    } catch (reason) { setError(readableError(reason, "任务分工保存失败")); await loadSettings(); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setConnection({ state: "testing", text: "正在发送真实模型请求…" });
    try {
      const response = await fetch(`${apiBase}/api/settings/model-connection`, { method: "POST", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string; provider?: string; model?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "模型连接失败");
      setConnection({ state: "connected", text: `已验证：${data.provider} / ${data.model}，模型能力已自动适配` });
    } catch (reason) { setConnection({ state: "failed", text: readableError(reason, "模型连接失败") }); }
  };

  return <div className="settings-dialog fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="设置">
    <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[680px] flex-col overflow-hidden rounded-[18px] border bg-card shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b px-5 py-3.5 sm:px-6"><div><div className="flex items-center gap-2 text-sm font-semibold"><Settings className="h-4 w-4" />设置</div><div className="mt-1 text-[10px] text-muted-foreground">模型连接、任务分工与数据隐私</div></div><button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted">关闭</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 sm:px-6 sm:py-4">
      <div className="grid grid-cols-3 rounded-lg bg-muted/70 p-1 text-[11px]">{([["models", "模型服务"], ["agents", "任务分工"], ["privacy", "数据与隐私"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => { setTab(key); setError(""); }} className={`rounded-md px-2 py-1.5 transition-colors ${tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
      {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"><span>{error}</span>{!settings && <button type="button" onClick={() => void loadSettings()} className="shrink-0 rounded-md border border-destructive/25 px-2 py-1 text-[11px] hover:bg-destructive/10">重试</button>}</div>}
      <div className="mt-4 min-h-[300px]">
        {tab === "models" && <div className="space-y-3">
          <div className="rounded-xl border bg-background/80 p-3.5">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium">默认执行模型</span><span className="text-[10px] text-muted-foreground">{loadingSettings ? "正在读取模型服务…" : "未单独指定的任务角色都使用它"}</span></div>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_116px]">
              <select value={settings?.activeModel ?? ""} disabled={loadingSettings || saving || !settings?.models.length} onChange={(event) => void saveDefault({ activeModel: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-[11px]"><option value="">{loadingSettings ? "正在读取…" : "请选择模型"}</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>
              <select value={settings?.defaultThinkingDepth ?? "medium"} disabled={loadingSettings || saving || !settings} onChange={(event) => void saveDefault({ defaultThinkingDepth: event.target.value as ThinkingDepth })} className="h-8 rounded-md border bg-background px-2 text-[11px]"><option value="low">较快</option><option value="medium">平衡</option><option value="high">较稳</option><option value="max">最稳</option></select>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">思考深度：低更快，高更稳。模型能力与上下文由系统自动同步和管理。</p>
            <div className="mt-3 flex flex-col items-start gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"><div aria-live="polite" className={`min-h-4 text-[11px] ${connection.state === "connected" ? "text-emerald-600" : connection.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{connection.text || (loadingSettings ? "正在读取模型服务…" : "点击测试连接，发送一次真实请求")}</div><button type="button" disabled={loadingSettings || connection.state === "testing" || !settings?.activeModel} onClick={() => void testConnection()} className="shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-40">{connection.state === "testing" ? "验证中…" : connection.state === "failed" ? "重试连接" : "测试连接"}</button></div>
          </div>
          <div className="rounded-xl border bg-background/80 p-3.5">
            <div className="flex items-center justify-between"><span className="text-xs font-medium">已配置服务</span><button type="button" onClick={() => setProviderOpen((value) => !value)} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">添加服务</button></div>
            <div className="mt-3 space-y-2">
              {settings?.providers.map((provider) => <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium">{provider.displayName}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{provider.models.map((model) => model.displayName).join("、") || "未添加模型"}</div></div><span className={`shrink-0 text-[10px] ${provider.apiKeyConfigured ? "text-emerald-600" : "text-muted-foreground"}`}>{provider.apiKeyConfigured ? "密钥已配置" : "未配置"}</span></div>)}
            </div>
            {providerOpen && <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <div className="col-span-2 text-[10px] font-medium tracking-wide text-muted-foreground">1 · 连接模型服务</div>
              <label className="col-span-2 space-y-1"><span className="text-[10px] text-muted-foreground">服务名称</span><input value={providerForm.displayName} onChange={(event) => setProviderForm((form) => ({ ...form, displayName: event.target.value }))} placeholder="例如：团队模型服务" className="h-8 w-full rounded-md border bg-background px-2 text-xs" /></label>
              <label className="col-span-2 space-y-1"><span className="text-[10px] text-muted-foreground">接口地址</span><input value={providerForm.baseURL} onChange={(event) => setProviderForm((form) => ({ ...form, baseURL: event.target.value }))} placeholder="https://…" className="h-8 w-full rounded-md border bg-background px-2 text-xs" /></label>
              <label className="col-span-2 space-y-1"><span className="text-[10px] text-muted-foreground">服务密钥</span><input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="只保存在本机运行配置中" className="h-8 w-full rounded-md border bg-background px-2 text-xs" /></label>
              <button type="button" disabled={discoveringModels || !providerForm.baseURL || !providerForm.apiKey} onClick={() => void discoverModels()} className="col-span-2 h-8 rounded-md border text-xs font-medium hover:bg-muted disabled:opacity-40">{discoveringModels ? "正在读取模型…" : "读取可用模型"}</button>
              <div className="col-span-2 mt-1 text-[10px] font-medium tracking-wide text-muted-foreground">2 · 选择默认模型</div>
              {providerModels.length > 0 ? <select aria-label="选择模型" value={providerForm.modelId} onChange={(event) => { const selected = providerModels.find((model) => model.id === event.target.value); setProviderForm((form) => ({ ...form, modelId: event.target.value, modelDisplayName: selected?.displayName ?? event.target.value })); }} className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs"><option value="">请选择模型</option>{providerModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select> : <input aria-label="模型 ID" value={providerForm.modelId} onChange={(event) => setProviderForm((form) => ({ ...form, modelId: event.target.value, modelDisplayName: event.target.value }))} placeholder="目录不可用时可填写模型名称" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" />}
              <button type="button" disabled={saving} onClick={() => void saveProvider()} className="col-span-2 h-8 rounded-md bg-blue-400 text-xs text-white shadow-sm shadow-blue-200 disabled:opacity-50">{saving ? "保存中…" : "保存服务"}</button>
            </div>}
          </div>
        </div>}
        {tab === "agents" && <div>
          <div className="divide-y rounded-xl border">
            {agentLabels.map(([id, label, note]) => {
              const route = settings?.agentRouting[id] ?? { modelId: "", thinkingDepth: "inherit" as const };
              return <div key={id} className="px-3 py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_150px_95px] items-center gap-3">
                  <span className="text-xs font-medium">{label}</span>
                  <select value={route.modelId} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { modelId: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs"><option value="">继承默认模型</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>
                  <select value={route.thinkingDepth} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { thinkingDepth: event.target.value as AgentRoute["thinkingDepth"] })} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="inherit">继承默认</option><option value="low">较快</option><option value="medium">平衡</option><option value="high">较稳</option><option value="max">最稳</option></select>
                </div>
                {note ? <div className="mt-1.5 text-[10px] text-muted-foreground">{note.startsWith("发布前") ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{note}</span> : note}</div> : null}
              </div>;
            })}
          </div>
        </div>}
        {tab === "privacy" && <PrivacyPanel apiBase={apiBase} />}
      </div>
      </div>
    </section>
  </div>;
}
