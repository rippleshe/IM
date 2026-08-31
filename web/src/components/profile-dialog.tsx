"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";

export type ProfileKeyword = string;
export type ProfileRadarItem = { name: string; score: number; reason?: string };
export type LearningProfile = {
  summary: string;
  keywords: ProfileKeyword[];
  radar: ProfileRadarItem[];
  studyMinutes?: number;
  assetsCount?: number;
  todayAssetsCount?: number;
  accuracy?: number | null;
  /** 画像洞见（server/profile-insights.ts 确定性推导） */
  blindSpots?: Array<{ knowledgePointId: string; label: string; pMastery: number; confidence: number; attemptCount: number; reason: string }>;
  difficultyCurve?: Array<{ knowledgePointId: string; label: string; pMastery: number; confidence: number; prereqReadiness: number; targetDifficulty: number; expectedSuccessRate: number }>;
  resourceMatch?: Array<{ resourceType: string; label: string; targetDifficulty: number; expectedSuccessRate: number; suitability: "recommended" | "ok" | "stretch"; note: string }>;
  latestDiagnostic?: { total: number; correct: number; createdAt: number } | null;
};

type ProfileDialogProps = {
  apiBase: string;
  user: AuthenticatedUser;
  /** 学习页可传额外指标与操作（路径页传节点统计）；不传则只展示画像数据 */
  headerRight?: React.ReactNode;
  extraMetrics?: Array<{ label: string; value: string | number }>;
  onUserChange?: (user: AuthenticatedUser) => void;
  onClose: () => void;
};

const AVATAR_FALLBACK: Record<AuthenticatedUser["avatarKey"], string> = {
  graphite: "bg-zinc-900 text-white", ocean: "bg-sky-600 text-white", violet: "bg-violet-600 text-white",
  forest: "bg-emerald-600 text-white", amber: "bg-amber-500 text-white", rose: "bg-rose-600 text-white",
};

/** 把用户选择的图片读入 canvas，居中裁方并缩到 128px，输出 jpeg data URL（约 <30KB）。 */
async function readAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > 12 * 1024 * 1024) throw new Error("图片不能超过 12MB");
  const objectUrl = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片解析失败"));
      element.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尺寸无效");
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持图片处理");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AvatarBubble({ user, size = "h-14 w-14 text-base" }: { user: AuthenticatedUser; size?: string }) {
  if (user.avatarImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarImage} alt={`${user.displayName}的头像`} className={`${size} shrink-0 rounded-full object-cover`} />;
  }
  return <span className={`${size} ${AVATAR_FALLBACK[user.avatarKey]} flex shrink-0 items-center justify-center rounded-full font-semibold`}>{user.displayName.slice(0, 1).toUpperCase()}</span>;
}

type LearningDecisionSummary = {
  id: string;
  knowledgePointId: string;
  triggerType: string;
  decision: string;
  recommendedResourceType: string | null;
  recommendationLevel: string;
  rationale: { observations?: string[]; reasons?: string[]; bktBefore?: { pMastery: number; confidence: number }; bktAfter?: { pMastery: number; confidence: number } };
  createdAt: number;
};

function masteryText(value: number): string {
  if (value >= 0.72) return "掌握较好";
  if (value >= 0.45) return "正在掌握";
  return "需要加强";
}

function difficultyText(value: number): string {
  if (value <= 0.35) return "基础练习";
  if (value <= 0.6) return "适中练习";
  return "进阶挑战";
}

function triggerText(value: string): string {
  return value === "quiz_attempt" ? "习题作答" : value === "asset_feedback" ? "资料反馈" : "学习追问";
}

function decisionText(value: string): string {
  return value === "remediate" ? "先补强基础" : value === "advance" ? "可以进阶" : value === "continue" ? "继续当前节奏" : "先补充一次学习记录";
}

function readableLearningText(text: string): string {
  return text
    .replace(/掌握概率/g, "掌握情况")
    .replace(/置信度/g, "判断把握度")
    .replace(/先修就绪度?/g, "前置知识准备度")
    .replace(/pMastery/gi, "掌握情况")
    .replace(/readiness/gi, "准备度")
    .replace(/BKT/g, "学习记录模型")
    .replace(/画像/g, "学习情况")
    .replace(/协同/g, "任务处理");
}

/** 学习画像弹窗：三页顶栏共用。展示画像描述/关键词/能力雷达/学习指标，支持上传与移除自定义头像。 */
export function ProfileDialog({ apiBase, user, headerRight, extraMetrics = [], onUserChange, onClose }: ProfileDialogProps) {
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [recentChange, setRecentChange] = useState<LearningDecisionSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/learning/profile`, { credentials: "include" })
      .then((response) => response.json() as Promise<{ success?: boolean; profile?: LearningProfile }>)
      .then((data) => { if (active && data.success && data.profile) setProfile(data.profile); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    // 最近一次学习建议（内部状态细节只在验证页展示）
    fetch(`${apiBase}/api/learning/decisions?limit=1`, { credentials: "include" })
      .then((response) => response.json() as Promise<{ decisions?: LearningDecisionSummary[] }>)
      .then((data) => { if (active) setRecentChange(data.decisions?.[0] ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiBase]);

  const uploadAvatar = async (file: File) => {
    setNotice("");
    setUploading(true);
    try {
      const image = await readAvatarImage(file);
      const response = await fetch(`${apiBase}/api/auth/avatar-image`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await response.json() as { success?: boolean; error?: string; user?: AuthenticatedUser };
      if (!response.ok || !data.success || !data.user) throw new Error(data.error || "头像保存失败");
      onUserChange?.({ ...data.user, diagnosticCompleted: data.user.diagnosticCompleted ?? user.diagnosticCompleted });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "头像保存失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const regenerateProfile = async () => {
    setRegenerating(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/profile/regenerate`, { method: "POST", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string; profile?: LearningProfile; updated?: boolean };
      if (!response.ok || !data.success || !data.profile) throw new Error(data.error || "画像生成失败");
      setProfile(data.profile);
      setUpdateStatus(data.updated ? "学习情况已依据新增记录更新" : "没有新的学习记录，学习情况保持不变");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "学习情况更新失败");
    } finally {
      setRegenerating(false);
    }
  };

  const metrics: Array<{ label: string; value: string | number }> = [
    { label: "学习时间", value: `${profile?.studyMinutes ?? 0} 分` },
    { label: "学习资产", value: profile?.assetsCount ?? 0 },
    { label: "正确率", value: profile?.accuracy === null || profile?.accuracy === undefined ? "—" : `${Math.round(profile.accuracy * 100)}%` },
    ...extraMetrics,
  ];

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-6" role="dialog" aria-modal="true" aria-label="学习情况">
    <section className="flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b px-7 py-5">
        <div className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4.5 w-4.5" />学习情况</div>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">关闭</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30" aria-label="更换头像"><AvatarBubble user={user} /><span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-foreground/55 text-[10px] font-medium text-background opacity-0 transition-opacity group-hover:opacity-100">更换</span></button>
            <div>
              <div className="text-lg font-semibold tracking-tight">{user.displayName}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">@{user.loginName}</div>
            </div>
          </div>
          {headerRight}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); }} />
        </div>

        {notice ? <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</p> : null}

        <div className="mt-6">
          <div className="text-xs font-medium text-muted-foreground">学习概况</div>
          {loading
            ? <div className="mt-2 h-16 animate-pulse rounded-xl bg-muted/60" />
            : <p className="mt-2 rounded-xl bg-muted/50 p-4 text-sm leading-7">{readableLearningText(profile?.summary || "暂无学习概况。")}</p>}
        </div>

        <div className="mt-5">
          <div className="text-xs font-medium text-muted-foreground">关键词</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(profile?.keywords ?? []).length > 0
              ? profile!.keywords.map((keyword) => <span key={keyword} className="rounded-full border bg-background px-3 py-1 text-xs">{keyword}</span>)
              : <span className="text-xs text-muted-foreground">暂无关键词</span>}
          </div>
        </div>

        {profile?.radar?.length ? <div className="mt-5 rounded-xl border p-4"><ProfileRadar items={profile.radar} /></div> : null}

        {(profile?.blindSpots?.length ?? 0) > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">需要加强的地方</div>
            <div className="mt-2 space-y-2">
              {profile!.blindSpots!.map((spot) => <div key={spot.knowledgePointId} className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{spot.label}</span><span className="text-amber-700">{masteryText(spot.pMastery)}</span></div>
                <p className="mt-1 leading-5 text-muted-foreground">建议先完成一份讲义，再做一组练习巩固。</p>
              </div>)}
            </div>
          </div>
        )}

        {(profile?.difficultyCurve?.length ?? 0) > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">学习难度建议</div>
            <div className="mt-2 space-y-2.5 rounded-xl border p-4">
              {profile!.difficultyCurve!.map((point) => <div key={point.knowledgePointId} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{point.label}</span>
                  <span className="text-muted-foreground">{difficultyText(point.targetDifficulty)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/65" style={{ width: `${Math.round(point.targetDifficulty * 100)}%` }} /></span>
                  <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground">当前：{masteryText(point.pMastery)}</span>
                </div>
              </div>)}
            </div>
          </div>
        )}

        {recentChange && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">最近学习建议</div>
            <div className="mt-2 rounded-xl border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">来自最近一次{triggerText(recentChange.triggerType)}</span>
                <span className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(recentChange.createdAt)}</span>
              </div>
              <p className="mt-1.5 leading-5 text-muted-foreground">下一步：<span className="font-medium text-foreground">{decisionText(recentChange.decision)}</span></p>
            </div>
          </div>
        )}

        {(profile?.resourceMatch?.length ?? 0) > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">资源匹配建议</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {profile!.resourceMatch!.map((item) => <div key={item.resourceType} className={`rounded-xl border p-3 text-xs ${item.suitability === "recommended" ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-background"}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{item.label}</span><span className="text-muted-foreground">{difficultyText(item.targetDifficulty)}</span></div>
                <p className="mt-1 leading-5 text-muted-foreground">{item.suitability === "recommended" ? "当前最适合，从这个资源开始。" : item.suitability === "ok" ? "可以尝试，建议先完成推荐资源。" : "属于进阶内容，等基础稳定后再学习。"}</p>
              </div>)}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((metric) => <div key={metric.label} className="rounded-xl border bg-background p-3"><div className="text-[11px] text-muted-foreground">{metric.label}</div><div className="mt-1 text-base font-semibold">{metric.value}</div></div>)}
        </div>
      </div>

      <footer className="shrink-0 border-t bg-background px-7 py-4">
        <button type="button" onClick={() => void regenerateProfile()} disabled={regenerating} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-muted disabled:opacity-60">
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          根据最新数据更新学习情况
        </button>
        {updateStatus ? <p className="mt-2 text-center text-xs text-muted-foreground">{updateStatus}</p> : null}
      </footer>
    </section>
  </div>;
}

function ProfileRadar({ items }: { items: ProfileRadarItem[] }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">积累更多学习记录后生成能力概览。</p>;
  const size = 240;
  const center = size / 2;
  const radius = center - 34;
  const angle = (index: number) => (Math.PI * 2 * index) / items.length - Math.PI / 2;
  const point = (item: ProfileRadarItem, index: number) => {
    const value = Math.max(0.04, Math.min(1, item.score));
    return `${center + Math.cos(angle(index)) * radius * value},${center + Math.sin(angle(index)) * radius * value}`;
  };
  const polygon = items.map((item, index) => point(item, index)).join(" ");
  return <div className="flex items-center justify-center gap-6">
    <svg width={size} height={size} role="img" aria-label="学习能力概览">
      {[0.25, 0.5, 0.75, 1].map((ring) => <polygon key={ring} points={items.map((_, index) => `${center + Math.cos(angle(index)) * radius * ring},${center + Math.sin(angle(index)) * radius * ring}`).join(" ")} fill="none" className="stroke-border" />)}
      {items.map((_, index) => <line key={index} x1={center} y1={center} x2={center + Math.cos(angle(index)) * radius} y2={center + Math.sin(angle(index)) * radius} className="stroke-border" />)}
      <polygon points={polygon} className="fill-foreground/15 stroke-foreground" strokeWidth={1.5} />
      {items.map((item, index) => {
        const labelRadius = radius + 18;
        return <text key={item.name} x={center + Math.cos(angle(index)) * labelRadius} y={center + Math.sin(angle(index)) * labelRadius} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{item.name}</text>;
      })}
    </svg>
    <ul className="min-w-0 space-y-2">
      {items.map((item) => <li key={item.name} className="text-xs"><span className="font-medium">{item.name}</span><span className="ml-2 text-muted-foreground">{Math.round(item.score * 100)}%</span>{item.reason ? <p className="mt-0.5 leading-5 text-muted-foreground">{readableLearningText(item.reason)}</p> : null}</li>)}
    </ul>
  </div>;
}
