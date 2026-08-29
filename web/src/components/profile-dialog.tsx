"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
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
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片解析失败"));
    element.src = dataUrl;
  });
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

/** 学习画像弹窗：三页顶栏共用。展示画像描述/关键词/能力雷达/学习指标，支持上传与移除自定义头像。 */
export function ProfileDialog({ apiBase, user, headerRight, extraMetrics = [], onUserChange, onClose }: ProfileDialogProps) {
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
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
    // 里程碑 G：最近一次状态变化（BKT before/after + 触发来源）
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
      onUserChange?.(data.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "头像保存失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAvatar = async () => {
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/auth/avatar-image`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: null }),
      });
      const data = await response.json() as { success?: boolean; error?: string; user?: AuthenticatedUser };
      if (!response.ok || !data.success || !data.user) throw new Error(data.error || "头像移除失败");
      onUserChange?.(data.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "头像移除失败");
    }
  };

  const regenerateProfile = async () => {
    setRegenerating(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/profile/regenerate`, { method: "POST", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string; profile?: LearningProfile };
      if (!response.ok || !data.success || !data.profile) throw new Error(data.error || "画像生成失败");
      setProfile(data.profile);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "画像生成失败");
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

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-6" role="dialog" aria-modal="true" aria-label="学习画像">
    <section className="flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b px-7 py-5">
        <div className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4.5 w-4.5" />学习画像</div>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">关闭</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <AvatarBubble user={user} />
            <div>
              <div className="text-lg font-semibold tracking-tight">{user.displayName}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">@{user.loginName}</div>
            </div>
          </div>
          {headerRight}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {user.avatarImage ? "更换图片" : "上传头像图片"}
          </button>
          {user.avatarImage
            ? <button type="button" onClick={() => void removeAvatar()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-3.5 w-3.5" />移除，用回首字母</button>
            : <span className="text-[11px] leading-4 text-muted-foreground">支持任意图片，自动裁方压缩后保存</span>}
        </div>

        {notice ? <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</p> : null}

        <div className="mt-6">
          <div className="text-xs font-medium text-muted-foreground">画像描述</div>
          {loading
            ? <div className="mt-2 h-16 animate-pulse rounded-xl bg-muted/60" />
            : <p className="mt-2 rounded-xl bg-muted/50 p-4 text-sm leading-7">{profile?.summary || "还没有画像描述；继续学习或点击下方“重新生成画像”，系统会依据学习证据总结你的画像。"}</p>}
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
            <div className="text-xs font-medium text-muted-foreground">知识盲区（作答与诊断证据驱动）</div>
            <div className="mt-2 space-y-2">
              {profile!.blindSpots!.map((spot) => <div key={spot.knowledgePointId} className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{spot.label}</span><span className="text-amber-700">掌握 {Math.round(spot.pMastery * 100)}%</span></div>
                <p className="mt-1 leading-5 text-muted-foreground">{spot.reason}</p>
              </div>)}
            </div>
          </div>
        )}

        {(profile?.difficultyCurve?.length ?? 0) > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">难度匹配曲线（目标成功率 65%–80%）</div>
            <div className="mt-2 space-y-2.5 rounded-xl border p-4">
              {profile!.difficultyCurve!.map((point) => <div key={point.knowledgePointId} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{point.label}</span>
                  <span className="text-muted-foreground">建议难度 {Math.round(point.targetDifficulty * 100)}% · 预计成功率 {Math.round(point.expectedSuccessRate * 100)}%</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/65" style={{ width: `${Math.round(point.targetDifficulty * 100)}%` }} /></span>
                  <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground">掌握 {Math.round(point.pMastery * 100)}% · 先修 {Math.round(point.prereqReadiness * 100)}%</span>
                </div>
              </div>)}
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">难度与预计成功率为模型预测值；实际正确率以作答记录为准（下方知识盲区与掌握度来自真实作答）。</p>
          </div>
        )}

        {recentChange && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">最近一次状态变化（反馈驱动，可追溯）</div>
            <div className="mt-2 rounded-xl border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{recentChange.triggerType === "quiz_attempt" ? "习题作答" : recentChange.triggerType === "asset_feedback" ? "资源掌握反馈" : "启发式追问"}</span>
                <span className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(recentChange.createdAt)}</span>
              </div>
              {recentChange.rationale?.bktBefore && recentChange.rationale?.bktAfter ? <p className="mt-1.5 leading-5 text-muted-foreground">
                掌握概率 {recentChange.rationale.bktBefore.pMastery.toFixed(2)} → {recentChange.rationale.bktAfter.pMastery.toFixed(2)}
                · 置信度 {recentChange.rationale.bktBefore.confidence.toFixed(2)} → {recentChange.rationale.bktAfter.confidence.toFixed(2)}
              </p> : null}
              {recentChange.rationale?.reasons?.length ? <p className="mt-1 leading-5 text-muted-foreground">{recentChange.rationale.reasons.join("；")}</p> : null}
              <p className="mt-1.5">下一步：{recentChange.decision === "remediate" ? "补强学习" : recentChange.decision === "advance" ? "进阶挑战" : recentChange.decision === "continue" ? "同级继续" : "先追问澄清"}</p>
            </div>
          </div>
        )}

        {(profile?.resourceMatch?.length ?? 0) > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">资源匹配建议</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {profile!.resourceMatch!.map((item) => <div key={item.resourceType} className={`rounded-xl border p-3 text-xs ${item.suitability === "recommended" ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-background"}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{item.label}</span><span className="text-muted-foreground">难度 {Math.round(item.targetDifficulty * 100)}%</span></div>
                <p className="mt-1 leading-5 text-muted-foreground">{item.note}</p>
              </div>)}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((metric) => <div key={metric.label} className="rounded-xl border bg-background p-3"><div className="text-[11px] text-muted-foreground">{metric.label}</div><div className="mt-1 text-base font-semibold">{metric.value}</div></div>)}
        </div>
      </div>

      <footer className="shrink-0 border-t bg-background px-7 py-4">
        <button type="button" onClick={() => void regenerateProfile()} disabled={regenerating} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-muted disabled:opacity-60">
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          重新生成画像
        </button>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">画像只依据真实学习证据生成：诊断与练习作答、资源反馈、学习时长。不会虚构能力评价。</p>
      </footer>
    </section>
  </div>;
}

function ProfileRadar({ items }: { items: ProfileRadarItem[] }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">积累更多学习证据后生成能力雷达。</p>;
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
    <svg width={size} height={size} role="img" aria-label="能力雷达图">
      {[0.25, 0.5, 0.75, 1].map((ring) => <polygon key={ring} points={items.map((_, index) => `${center + Math.cos(angle(index)) * radius * ring},${center + Math.sin(angle(index)) * radius * ring}`).join(" ")} fill="none" className="stroke-border" />)}
      {items.map((_, index) => <line key={index} x1={center} y1={center} x2={center + Math.cos(angle(index)) * radius} y2={center + Math.sin(angle(index)) * radius} className="stroke-border" />)}
      <polygon points={polygon} className="fill-foreground/15 stroke-foreground" strokeWidth={1.5} />
      {items.map((item, index) => {
        const labelRadius = radius + 18;
        return <text key={item.name} x={center + Math.cos(angle(index)) * labelRadius} y={center + Math.sin(angle(index)) * labelRadius} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{item.name}</text>;
      })}
    </svg>
    <ul className="min-w-0 space-y-2">
      {items.map((item) => <li key={item.name} className="text-xs"><span className="font-medium">{item.name}</span><span className="ml-2 text-muted-foreground">{Math.round(item.score * 100)}%</span>{item.reason ? <p className="mt-0.5 leading-5 text-muted-foreground">{item.reason}</p> : null}</li>)}
    </ul>
  </div>;
}
