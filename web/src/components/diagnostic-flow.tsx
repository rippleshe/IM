"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";

type DiagnosticOption = { id: string; text: string };
type DiagnosticQuestion = { id: string; code: string; dimension: string; level: "L1" | "L2" | "L3"; prompt: string; options: DiagnosticOption[] };
type DiagnosticReview = { questionId: string; prompt: string; yourAnswer: string; correctAnswer: string; correct: boolean; explanation: string };
type DimensionScore = { dimension: string; total: number; correct: number };
type AttemptResult = { sessionId: string; total: number; correct: number; byDimension: DimensionScore[] | Record<string, Omit<DimensionScore, "dimension">>; review: DiagnosticReview[] };

const DIMENSION_LABELS: Record<string, string> = {
  python: "Python 基础",
  data_processing: "数据处理",
  statistics: "统计基础",
  time_series: "时序分析",
  device_diagnosis: "设备诊断",
};

type DiagnosticFlowProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onFinished: (user: AuthenticatedUser) => void;
};

/** 建档后强制进入的 12 题初始诊断（总规 §7.3）：服务端判分，答案不下发，作答驱动 BKT 初始状态。 */
export function DiagnosticFlow({ apiBase, user, onFinished }: DiagnosticFlowProps) {
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/learning/diagnostic`, { credentials: "include" })
      .then((response) => response.json() as Promise<{ success?: boolean; questions?: DiagnosticQuestion[] }>)
      .then((data) => {
        if (active && data.success && data.questions) setQuestions(data.questions);
        else if (active) setLoadError("诊断题加载失败，请刷新重试");
      })
      .catch(() => { if (active) setLoadError("诊断题加载失败，请检查服务后刷新"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiBase]);

  const question = questions[index];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;
  const dimensionSummary = useMemo<DimensionScore[]>(() => {
    const raw = result?.byDimension;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return Object.entries(raw).map(([dimension, score]) => ({ dimension, total: score.total, correct: score.correct }));
  }, [result]);

  const choose = (optionId: string) => {
    if (!question || submitting) return;
    const next = { ...answers, [question.id]: optionId };
    setAnswers(next);
    // 选择后短暂停顿自动前进，最后一题停留等待检查提交
    window.setTimeout(() => {
      setIndex((current) => (current < questions.length - 1 && next[question.id] ? current + 1 : current));
    }, 260);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/learning/diagnostic-attempts`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: questions.map((item) => ({ questionId: item.id, answerId: answers[item.id] ?? "" })) }),
      });
      const data = await response.json() as { success?: boolean; error?: string } & Partial<AttemptResult>;
      if (!response.ok || !data.success || !data.sessionId) throw new Error(data.error || "诊断提交失败");
      setResult({ sessionId: data.sessionId, total: data.total ?? 0, correct: data.correct ?? 0, byDimension: data.byDimension ?? [], review: data.review ?? [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "诊断提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
    <div className="w-full max-w-3xl rounded-2xl border bg-card shadow-sm">
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-10 py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在准备入学诊断…</div>
      ) : loadError ? (
        <div className="px-10 py-20 text-center text-sm text-destructive">{loadError}</div>
      ) : result ? (
        <div className="px-8 py-9 sm:px-10">
          <div className="text-center">
            <div className="text-xs font-medium text-muted-foreground">入学诊断完成</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">{result.correct} / {result.total}</div>
          </div>
          <div className="mt-7 space-y-2.5">
            {dimensionSummary.map((item) => {
              const percent = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
              return <div key={item.dimension} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-muted-foreground">{DIMENSION_LABELS[item.dimension] ?? item.dimension}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/70" style={{ width: `${percent}%` }} /></span>
                <span className="w-16 text-right font-medium">{item.correct}/{item.total}</span>
              </div>;
            })}
          </div>
          <div className="mt-7 max-h-72 space-y-3 overflow-y-auto rounded-xl border bg-muted/20 p-4">
            {result.review.map((item, itemIndex) => <div key={item.questionId} className="text-xs">
              <div className="flex items-start gap-2">
                {item.correct ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />}
                <div className="min-w-0"><p className="font-medium leading-5">{itemIndex + 1}. {item.prompt}</p>
                  <p className="mt-1 leading-5 text-muted-foreground">正确答案：{item.correctAnswer} · {item.explanation}</p>
                </div>
              </div>
            </div>)}
          </div>
          <button type="button" onClick={() => onFinished({ ...user, diagnosticCompleted: true })} className="mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-medium text-background hover:opacity-90">
            进入学习工作台 <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : question ? (
        <div className="px-8 py-9 sm:px-10">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>入学诊断 · {DIMENSION_LABELS[question.dimension] ?? question.dimension} · {question.level}</span>
            <span>{index + 1} / {questions.length}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/70 transition-all" style={{ width: `${Math.round(((index + 1) / questions.length) * 100)}%` }} /></div>
          <h1 className="mt-7 text-lg font-semibold leading-7">{question.prompt}</h1>
          <div className="mt-6 space-y-2.5">
            {question.options.map((option) => {
              const selected = answers[question.id] === option.id;
              return <button key={option.id} type="button" onClick={() => choose(option.id)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-6 transition-all ${selected ? "border-foreground/70 bg-muted shadow-sm" : "hover:border-foreground/35 hover:bg-muted/25 hover:shadow-sm"}`}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors ${selected ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}>{option.id}</span>
                <span>{option.text}</span>
              </button>;
            })}
          </div>
          {error && <p className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="mt-7 flex items-center justify-between">
            <button type="button" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-xs font-medium hover:bg-muted disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" />上一题</button>
            {allAnswered
              ? <button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-medium text-background disabled:opacity-50">{submitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />正在判分</> : "提交诊断"}</button>
              : <span className="text-xs text-muted-foreground">已答 {answeredCount}/{questions.length} 题</span>}
          </div>
        </div>
      ) : null}
    </div>
  </main>;
}
