"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Radio, Settings } from "lucide-react";

type ThinkingDepth = "low" | "medium" | "high" | "max";
type AgentRoute = { modelId: string; thinkingDepth: "inherit" | ThinkingDepth };
type RuntimeSettings = {
  activeModel: string;
  defaultThinkingDepth: ThinkingDepth;
  providers: Array<{ id: string; displayName: string; baseURL: string; apiKeyConfigured: boolean; models: Array<{ id: string; displayName: string }> }>;
  models: Array<{ id: string; displayName: string; provider: string; providerDisplayName: string }>;
  agentRouting: Record<string, AgentRoute>;
  autoAssetTypes: Array<"lecture" | "tiered_quiz" | "concept_map">;
};

type PrivacyEvent = {
  id: string;
  eventType: string;
  fileName: string | null;
  byteCount: number | null;
  redactedFieldCount: number;
  createdAt: number;
};

const agentLabels: Array<[string, string, string | null]> = [
  ["learning_planning", "学情与路径", null],
  ["evidence_retrieval", "知识检索", "结构化 + 文档双实例"],
  ["domain_expert", "领域诊断", null],
  ["resource_generation", "资源生成", null],
  ["cross_validation", "交叉验证", "发布前固定关卡，不可关闭"],
  ["privacy_compliance", "合规与隐私", "发布前固定关卡，不可关闭"],
];

const privacyEventLabels: Record<string, string> = {
  temporary_reference_used: "临时参考已使用（原文未保存）",
};

function PrivacyPanel({ apiBase }: { apiBase: string }) {
  const [events, setEvents] = useState<PrivacyEvent[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/settings/privacy-audit?limit=8`, { credentials: "include" });
      const data = await response.json() as { events?: PrivacyEvent[] };
      setEvents(data.events ?? []);
    } catch { setEvents([]); }
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
  return <div className="space-y-3">
    <div className="divide-y rounded-xl border text-xs">
      <div className="flex items-center justify-between px-3 py-3"><span>学习记录存储</span><span className="text-muted-foreground">本机 SQLite，不离开设备</span></div>
      <div className="flex items-center justify-between px-3 py-3"><span>上传资料原文</span><span className="text-muted-foreground">仅本次任务使用，不保存</span></div>
      <div className="flex items-center justify-between px-3 py-3"><span>公共知识库写入</span><span className="text-muted-foreground">仅审核后的固定资料</span></div>
      <div className="flex items-center justify-between px-3 py-3"><span className="flex items-center gap-1.5"><Lock className="h-3 w-3" />审核与隐私门禁</span><span className="text-muted-foreground">固定关卡，不可关闭</span></div>
    </div>
    <div className="rounded-xl border">
      <div className="flex items-center justify-between border-b px-3 py-2.5"><span className="text-xs font-medium">隐私审计记录</span><button type="button" disabled={clearing || !events?.length} onClick={() => void clear()} className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40">清除记录</button></div>
      <div className="max-h-48 overflow-y-auto p-1.5">
        {events === null ? <div className="px-2 py-3 text-[11px] text-muted-foreground">正在读取审计记录</div> : events.length === 0 ? <div className="px-2 py-3 text-[11px] leading-4 text-muted-foreground">暂无审计记录。使用临时参考资料时会在这里留痕（只记文件名与哈希，不存原文）。</div> : events.map((event) => <div key={event.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[11px] hover:bg-muted/50"><span className="min-w-0 truncate">{privacyEventLabels[event.eventType] ?? event.eventType}<span className="text-muted-foreground"> · {event.fileName ?? "未知文件"}</span></span><span className="shrink-0 text-muted-foreground">{event.byteCount === null ? "" : `${Math.max(1, Math.round(event.byteCount / 1024))} KB · `}{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(event.createdAt)}</span></div>)}
      </div>
    </div>
  </div>;
}

export function SettingsDialog({ apiBase, onClose }: { apiBase: string; onClose: () => void }) {
  const [tab, setTab] = useState<"models" | "agents" | "assets" | "privacy">("models");
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/settings`);
      const data = await response.json() as RuntimeSettings & { success?: boolean };
      if (!response.ok || !data.success) throw new Error("设置读取失败");
      setSettings(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "设置读取失败");
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
      const response = await fetch(`${apiBase}/api/settings/default-execution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: next.activeModel, thinkingDepth: next.defaultThinkingDepth }) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "默认设置保存失败");
      setSettings(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "默认设置保存失败");
      await loadSettings();
    } finally { setSaving(false); }
  };

  const saveProvider = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/providers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerForm) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "模型服务保存失败");
      setSettings(data);
      setProviderOpen(false);
      setProviderForm({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型服务保存失败"); }
    finally { setSaving(false); }
  };

  const saveAgentRoute = async (agentId: string, patch: Partial<AgentRoute>) => {
    if (!settings) return;
    const agentRouting = { ...settings.agentRouting, [agentId]: { modelId: settings.agentRouting[agentId]?.modelId ?? "", thinkingDepth: settings.agentRouting[agentId]?.thinkingDepth ?? "inherit", ...patch } };
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/agent-routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentRouting }) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "协同设置保存失败");
      setSettings(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "协同设置保存失败"); await loadSettings(); }
    finally { setSaving(false); }
  };

  const toggleAsset = async (type: "lecture" | "tiered_quiz" | "concept_map") => {
    if (!settings) return;
    const next = settings.autoAssetTypes.includes(type) ? settings.autoAssetTypes.filter((item) => item !== type) : [...settings.autoAssetTypes, type];
    if (next.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiBase}/api/settings/asset-policy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoAssetTypes: next }) });
      const data = await response.json() as RuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "资产设置保存失败");
      setSettings(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产设置保存失败"); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4" role="dialog" aria-modal="true" aria-label="设置">
    <section className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><Settings className="h-4 w-4" />设置</h2><button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">关闭</button></div>
      <div className="mt-4 grid grid-cols-4 rounded-lg bg-muted/70 p-1 text-xs">{([["models", "模型服务"], ["agents", "协同编排"], ["assets", "学习资产"], ["privacy", "数据与隐私"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => { setTab(key); setError(""); }} className={`rounded-md px-2 py-2 ${tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
      {error && <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
      <div className="mt-4 min-h-[300px]">
        {tab === "models" && <div className="space-y-3">
          <div className="rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium">默认执行模型</span><span className="text-[10px] text-muted-foreground">未单独路由的智能体都继承它</span></div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_100px] gap-2">
              <select value={settings?.activeModel ?? ""} disabled={saving || !settings?.models.length} onChange={(event) => void saveDefault({ activeModel: event.target.value })} className="h-9 min-w-0 rounded-lg border bg-background px-2 text-xs"><option value="">请选择模型</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>
              <select value={settings?.defaultThinkingDepth ?? "medium"} disabled={saving || !settings} onChange={(event) => void saveDefault({ defaultThinkingDepth: event.target.value as ThinkingDepth })} className="h-9 rounded-lg border bg-background px-2 text-xs"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">思考深度影响每次模型调用的推理投入：低更快，高更稳。学习协同的每个智能体单独发言时都会按这里的配置执行。</p>
          </div>
          <div className="rounded-xl border p-3">
            <div className="flex items-center justify-between"><span className="text-xs font-medium">已配置服务</span><button type="button" onClick={() => setProviderOpen((value) => !value)} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">添加服务</button></div>
            <div className="mt-3 space-y-2">
              {settings?.providers.map((provider) => <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium">{provider.displayName}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{provider.models.map((model) => model.displayName).join("、") || "未添加模型"}</div></div><span className={`shrink-0 text-[10px] ${provider.apiKeyConfigured ? "text-emerald-600" : "text-muted-foreground"}`}>{provider.apiKeyConfigured ? "已连接" : "未配置"}</span></div>)}
            </div>
            {providerOpen && <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <input value={providerForm.displayName} onChange={(event) => setProviderForm((form) => ({ ...form, displayName: event.target.value }))} placeholder="服务名称" className="h-8 rounded-md border bg-background px-2 text-xs" />
              <input value={providerForm.id} onChange={(event) => setProviderForm((form) => ({ ...form, id: event.target.value }))} placeholder="服务 ID" className="h-8 rounded-md border bg-background px-2 text-xs" />
              <input value={providerForm.baseURL} onChange={(event) => setProviderForm((form) => ({ ...form, baseURL: event.target.value }))} placeholder="接口地址 https://…" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" />
              <input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="API Key" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" />
              <input value={providerForm.modelId} onChange={(event) => setProviderForm((form) => ({ ...form, modelId: event.target.value }))} placeholder="模型 ID" className="h-8 rounded-md border bg-background px-2 text-xs" />
              <input value={providerForm.modelDisplayName} onChange={(event) => setProviderForm((form) => ({ ...form, modelDisplayName: event.target.value }))} placeholder="模型显示名" className="h-8 rounded-md border bg-background px-2 text-xs" />
              <button type="button" disabled={saving} onClick={() => void saveProvider()} className="col-span-2 h-8 rounded-md bg-foreground text-xs text-background disabled:opacity-50">{saving ? "保存中…" : "保存服务"}</button>
            </div>}
          </div>
        </div>}
        {tab === "agents" && <div>
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground"><Radio className="mt-0.5 h-3 w-3 shrink-0" />每个智能体按职责单独选择模型与思考深度；留空则继承默认执行模型。学习协同发起后即按此路由真实执行。</div>
          <div className="divide-y rounded-xl border">
            {agentLabels.map(([id, label, note]) => {
              const route = settings?.agentRouting[id] ?? { modelId: "", thinkingDepth: "inherit" as const };
              return <div key={id} className="px-3 py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_150px_95px] items-center gap-3">
                  <span className="text-xs font-medium">{label}</span>
                  <select value={route.modelId} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { modelId: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs"><option value="">继承默认模型</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>
                  <select value={route.thinkingDepth} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { thinkingDepth: event.target.value as AgentRoute["thinkingDepth"] })} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="inherit">继承默认</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select>
                </div>
                {note ? <div className="mt-1.5 text-[10px] text-muted-foreground">{note.startsWith("发布前") ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{note}</span> : note}</div> : null}
              </div>;
            })}
          </div>
        </div>}
        {tab === "assets" && <div>
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground"><Radio className="mt-0.5 h-3 w-3 shrink-0" />控制发起一次完整学习任务后自动生成的资产类型；学习页手动生成的资源不受这里限制。</div>
          <div className="grid grid-cols-3 gap-2">{([["lecture", "讲义"], ["tiered_quiz", "分层习题"], ["concept_map", "知识图谱"]] as const).map(([type, label]) => { const enabled = settings?.autoAssetTypes.includes(type) ?? false; return <button key={type} type="button" disabled={saving || !settings} onClick={() => void toggleAsset(type)} className={`rounded-xl border p-4 text-left ${enabled ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}><div className="text-xs font-medium">{label}</div><div className="mt-2 text-[11px] text-muted-foreground">{enabled ? "自动生成" : "关闭"}</div></button>; })}</div>
        </div>}
        {tab === "privacy" && <PrivacyPanel apiBase={apiBase} />}
      </div>
    </section>
  </div>;
}
