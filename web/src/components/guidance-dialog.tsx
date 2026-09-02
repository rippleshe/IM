"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lightbulb, Loader2, Send, X } from "lucide-react";
type SessionView = {
  sessionId: string;
  knowledgePointId: string;
  label: string;
  status: "active" | "finished";
  roundCount: number;
  question: { round: number; question: string } | null;
  decision: Record<string, unknown> | null;
};

type AnswerOutcome = {
  evaluation: { verdict: "correct" | "partial" | "incorrect"; comment: string };
  bkt: { before: { pMastery: number; confidence: number }; after: { pMastery: number; confidence: number } };
  next: { type: "question"; question: { round: number; question: string } } | { type: "finished"; decision: Record<string, unknown> };
};

type TurnView = {
  question: string;
  answer: string;
  verdict: AnswerOutcome["evaluation"]["verdict"];
  comment: string;
  confidenceAfter: number;
};

type GuidanceDialogProps = {
  apiBase: string;
  pathNodeId: string | null;
  onClose: () => void;
  /** 终态决策：带知识点跳到学习页生成对应资源 */
  onGenerateResource: (knowledgePointId: string, resourceType: "lecture" | "tiered_quiz") => void;
};

const VERDICT_LABELS: Record<AnswerOutcome["evaluation"]["verdict"], string> = {
  correct: "回答到位",
  partial: "部分正确",
  incorrect: "还不充分",
};

function confidenceText(value: number): string {
  if (value >= 0.8) return "较高";
  if (value >= 0.5) return "中等";
  return "还需要更多回答";
}

/** 苏格拉底启发式追问弹窗（总规 §7.4）：每轮一个问题，最多 5 轮，回答驱动 BKT 更新。 */
export function GuidanceDialog({ apiBase, pathNodeId, onClose, onGenerateResource }: GuidanceDialogProps) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [finished, setFinished] = useState<Record<string, unknown> | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        const response = await fetch(`${apiBase}/api/learning/guidance/sessions`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathNodeId }),
        });
        const data = await response.json() as { success?: boolean; error?: string } & Partial<SessionView>;
        if (!active) return;
        if (!response.ok || !data.success || !data.sessionId) {
          setError(data.error || "学习追问创建失败");
          return;
        }
        setSession({
          sessionId: data.sessionId,
          knowledgePointId: data.knowledgePointId ?? "",
          label: data.label ?? "",
          status: "active",
          roundCount: 0,
          question: data.question ?? null,
          decision: null,
        });
      } catch {
        if (active) setError("学习追问创建失败，请稍后重试");
      } finally {
        if (active) setLoading(false);
      }
    };
    void start();
    return () => { active = false; };
  }, [apiBase, pathNodeId]);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [turns, submitting, session?.question?.round]);

  const submitAnswer = async () => {
    if (!session || !draft.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    const answer = draft.trim();
    try {
      const response = await fetch(`${apiBase}/api/learning/guidance/sessions/${encodeURIComponent(session.sessionId)}/answers`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await response.json() as { success?: boolean; error?: string } & Partial<AnswerOutcome>;
      if (!response.ok || !data.success || !data.evaluation || !data.next) throw new Error(data.error || "回答提交失败");
      setTurns((current) => [...current, {
        question: session.question?.question ?? "",
        answer,
        verdict: data.evaluation!.verdict,
        comment: data.evaluation!.comment,
        confidenceAfter: data.bkt?.after.confidence ?? 0,
      }]);
      setDraft("");
      if (data.next.type === "question") {
        const nextQuestion = data.next.question;
        setSession((current) => current ? { ...current, question: nextQuestion, roundCount: nextQuestion.round - 1 } : current);
      } else {
        const decision = data.next.decision;
        setFinished(decision);
        setSession((current) => current ? { ...current, status: "finished", question: null, decision } : current);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "回答提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const decisionType = finished ? String(finished["type"] ?? "") : "";
  // 追问结论必须映射到已发布的四类资源；历史 challenge_task 从未有生成器或入库类型。
  const suggestedType = decisionType === "generate_resource" ? "tiered_quiz" as const : "lecture" as const;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-6" role="dialog" aria-modal="true" aria-label="学习追问">
    <section className="flex h-[min(680px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4" />一步步想清楚{session?.label ? ` · ${session.label}` : ""}</div>
        <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </header>

      <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在准备问题…</div>
        ) : error && !session ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, index) => <div key={index} className="space-y-2">
              <div className="border-l border-slate-200 pl-3 text-[13px] leading-6"><p className="text-[11px] font-medium text-muted-foreground">追问 {index + 1}</p><p className="mt-1">{turn.question}</p></div>
              <div className="ml-auto max-w-[88%] border-r border-blue-200 pr-3 text-right text-[13px] leading-6 text-blue-950"><p className="whitespace-pre-wrap">{turn.answer}</p></div>
              <div className="rounded-xl border bg-background px-3.5 py-2.5 text-xs">
                <span className={`mr-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${turn.verdict === "correct" ? "bg-emerald-100 text-emerald-700" : turn.verdict === "partial" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{VERDICT_LABELS[turn.verdict]}</span>
                <span className="leading-5 text-muted-foreground">{turn.comment}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">判断把握度：{confidenceText(turn.confidenceAfter)}</span>
              </div>
            </div>)}

            {session?.question && !finished ? (
              <div className="rounded-2xl border border-foreground/20 bg-card px-4 py-3 text-sm leading-6 shadow-sm">
                <p className="text-[11px] font-medium text-muted-foreground">追问 {session.question.round} / 5</p>
                <p className="mt-1">{session.question.question}</p>
              </div>
            ) : null}

            {finished ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs">
                <p className="font-semibold">{decisionType === "generate_resource" ? "追问完成：可以进阶了" : "追问完成：建议补强"}</p>
                <p className="mt-1.5 leading-5 text-muted-foreground">我们已经根据这次回答安排了下一步学习，你可以继续学习或尝试新的挑战。</p>
                <button type="button" onClick={() => onGenerateResource(String(finished!["knowledgePointId"] ?? session?.knowledgePointId ?? ""), suggestedType)} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground/25 bg-background px-3.5 text-xs font-medium hover:bg-muted">
                  按这个知识点生成{suggestedType === "tiered_quiz" ? "分层习题" : "补强讲义"} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {session?.question && !finished ? (
        <div className="shrink-0 border-t bg-background p-4">
          {error && <p className="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitAnswer(); } }} rows={2} placeholder="说说你的理解" className="max-h-28 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" />
            <button type="button" disabled={!draft.trim() || submitting} onClick={() => void submitAnswer()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-400 text-white shadow-sm shadow-blue-200 disabled:opacity-35" aria-label="提交回答">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
          </div>
        </div>
      ) : null}
    </section>
  </div>;
}
