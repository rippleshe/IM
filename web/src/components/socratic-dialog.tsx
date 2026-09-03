"use client";

import { useEffect, useState } from "react";
import { Lightbulb, MessageCircle, Send, X, CheckCircle2, AlertCircle, Minus } from "lucide-react";

interface SocraticDialogProps {
  apiBase: string;
  onClose: () => void;
}

interface SocraticTurn {
  round: number;
  question: string;
  answer: string;
  verdict: "correct" | "partial" | "incorrect";
  comment: string;
}

export function SocraticDialog({ apiBase, onClose }: SocraticDialogProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<SocraticTurn[]>([]);
  const [round, setRound] = useState(0);
  const [confidence, setConfidence] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/learning/socratic/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        const data = await response.json() as {
          success?: boolean;
          error?: string;
          session?: { id: string; targetLabel: string; round: number; question: string };
        };
        if (!response.ok || !data.success || !data.session) throw new Error(data.error || "启动引导对话失败");
        if (active) {
          setSessionId(data.session.id);
          setTargetLabel(data.session.targetLabel);
          setCurrentQuestion(data.session.question);
          setRound(0);
        }
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "启动失败"); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [apiBase]);

  const submitAnswer = async () => {
    if (!answer.trim() || !sessionId || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(`${apiBase}/api/learning/socratic/answer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answer }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        evaluation?: { verdict: "correct" | "partial" | "incorrect"; comment: string };
        shouldContinue?: boolean;
        confidence?: number;
        nextQuestion?: string | null;
        round?: number;
      };

      if (!response.ok || !data.success || !data.evaluation) {
        throw new Error(data.error || "回答提交失败");
      }

      const newTurn: SocraticTurn = {
        round: round + 1,
        question: currentQuestion,
        answer,
        verdict: data.evaluation.verdict,
        comment: data.evaluation.comment,
      };

      setHistory((prev) => [...prev, newTurn]);
      setAnswer("");
      setRound((prev) => prev + 1);
      setConfidence(data.confidence ?? 0.5);

      if (data.shouldContinue && data.nextQuestion) {
        setCurrentQuestion(data.nextQuestion);
      } else {
        setCompleted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "回答提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (sessionId) {
      await fetch(`${apiBase}/api/learning/socratic/end`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => undefined);
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") void handleClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sessionId, handleClose]);

  if (loading) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">正在准备引导对话...</div>
      </div>
    </div>;
  }

  if (error && !sessionId) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="text-xl font-semibold">启发式引导</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="py-8 text-center text-sm text-destructive">{error}</div>
      </div>
    </div>;
  }

  const verdictIcon = (verdict: SocraticTurn["verdict"]) => {
    if (verdict === "correct") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (verdict === "partial") return <Minus className="h-4 w-4 text-amber-600" />;
    return <AlertCircle className="h-4 w-4 text-rose-600" />;
  };

  const verdictLabel = (verdict: SocraticTurn["verdict"]) => {
    if (verdict === "correct") return "理解准确";
    if (verdict === "partial") return "部分正确";
    return "需要再想想";
  };

  const verdictColor = (verdict: SocraticTurn["verdict"]) => {
    if (verdict === "correct") return "border-emerald-200 bg-emerald-50";
    if (verdict === "partial") return "border-amber-200 bg-amber-50";
    return "border-rose-200 bg-rose-50";
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => void handleClose()}>
    <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {/* 标题栏 */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
            <Lightbulb className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">苏格拉底式引导</h2>
            <p className="text-xs text-muted-foreground">通过追问帮助你自主发现答案</p>
          </div>
        </div>
        <button type="button" onClick={() => void handleClose()} className="rounded-lg p-2 transition-colors hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-6">
        {/* 目标知识点 */}
        <div className="mb-4 rounded-lg border bg-blue-50 p-3">
          <div className="text-xs text-blue-700">当前主题</div>
          <div className="mt-1 text-sm font-semibold text-blue-900">{targetLabel}</div>
          <div className="mt-2 flex items-center gap-3">
            <div className="text-xs text-blue-700">理解进度</div>
            <div className="flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-blue-200">
                <div style={{ width: `${Math.round(confidence * 100)}%` }} className="h-full bg-blue-600 transition-all duration-500" />
              </div>
            </div>
            <div className="text-xs font-semibold tabular-nums text-blue-900">{Math.round(confidence * 100)}%</div>
          </div>
        </div>

        {/* 对话历史 */}
        {history.length > 0 && (
          <div className="mb-4 space-y-3">
            {history.map((turn, index) => (
              <div key={index} className="space-y-2">
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-muted-foreground">第{turn.round}轮 · 引导问题</div>
                      <p className="mt-1 text-sm leading-6">{turn.question}</p>
                    </div>
                  </div>
                </div>
                <div className={`rounded-lg border p-3 ${verdictColor(turn.verdict)}`}>
                  <div className="flex items-start gap-2">
                    {verdictIcon(turn.verdict)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span>你的回答</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{verdictLabel(turn.verdict)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{turn.answer}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{turn.comment}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 当前问题或完成状态 */}
        {completed ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <p className="mt-3 text-sm font-semibold text-emerald-900">引导对话完成</p>
            <p className="mt-1 text-xs text-emerald-700">
              经过 {history.length} 轮追问，你的理解已经达到 {Math.round(confidence * 100)}%
            </p>
            <button
              type="button"
              onClick={() => void handleClose()}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              关闭对话
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="flex items-start gap-2">
                <MessageCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <div className="text-xs text-blue-700">第{round + 1}轮 · 引导问题</div>
                  <p className="mt-1 text-sm leading-6 text-blue-900">{currentQuestion}</p>
                </div>
              </div>
            </div>

            {error && <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}

            <div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.ctrlKey) {
                    e.preventDefault();
                    void submitAnswer();
                  }
                }}
                rows={4}
                placeholder="写下你的思考... (Ctrl+Enter 提交)"
                className="w-full resize-none rounded-lg border bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">提示：不要害怕答错，追问的目的是帮助你思考</p>
                <button
                  type="button"
                  onClick={() => void submitAnswer()}
                  disabled={!answer.trim() || submitting}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "提交中..." : "提交回答"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>;
}
