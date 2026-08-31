"use client";

import { Loader2, MessageCircleQuestion, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RichText } from "@/components/rich-text";

type QaMessage = { id: string; role: "user" | "assistant"; content: string; metadata?: { assetId?: string | null }; createdAt: number };

type ResourceQuestionDialogProps = {
  apiBase: string;
  selectedAssetId: string | null;
  selectedAssetTitle?: string;
  onClose: () => void;
};

export function ResourceQuestionDialog({ apiBase, selectedAssetId, selectedAssetTitle, onClose }: ResourceQuestionDialogProps) {
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/learning/resource-qa`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; messages?: QaMessage[]; error?: string };
        if (!response.ok || !data.success) throw new Error(data.error || "问答记录读取失败");
        if (active) setMessages(data.messages ?? []);
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "问答记录读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, sending]);

  const send = async () => {
    const question = draft.trim();
    if (!question || sending) return;
    setDraft("");
    setSending(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/resource-qa`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, assetId: selectedAssetId }),
      });
      const data = await response.json() as { success?: boolean; error?: string; userMessage?: QaMessage; assistantMessage?: QaMessage };
      if (!response.ok || !data.success || !data.userMessage || !data.assistantMessage) throw new Error(data.error || "提问失败");
      setMessages((current) => [...current, data.userMessage!, data.assistantMessage!]);
    } catch (error) {
      setDraft(question);
      setNotice(error instanceof Error ? error.message : "提问失败");
    } finally { setSending(false); }
  };

  const clearConversation = async () => {
    if (clearing || !messages.length) return;
    if (!window.confirm("清除全部资源问答历史和后续模型对话上下文？不会删除学习资源。")) return;
    setClearing(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/chat?surface=resource_qa`, { method: "DELETE", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "清除问答失败");
      setMessages([]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "清除问答失败"); }
    finally { setClearing(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4" role="dialog" aria-modal="true" aria-label="资源问答">
    <section className="flex h-[min(720px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
        <div>{selectedAssetTitle ? <h2 className="text-sm font-semibold">资源问答 · 聚焦《{selectedAssetTitle}》</h2> : <h2 className="text-sm font-semibold">资源问答</h2>}</div>
        <div className="flex items-center gap-1"><button type="button" disabled={clearing || sending || messages.length === 0} onClick={() => void clearConversation()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />{clearing ? "清除中" : "清除上下文"}</button><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭资源问答"><X className="h-4 w-4" /></button></div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {loading ? <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取问答记录</div> : messages.length === 0 ? <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm leading-6 text-muted-foreground"><MessageCircleQuestion className="mb-3 h-7 w-7 text-muted-foreground/45" />还没有提问记录，例如：「这几份资源里对这个概念的解释有什么区别？」</div> : messages.map((message) => message.role === "user"
          ? <article key={message.id} className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm leading-6 text-blue-950"><p className="whitespace-pre-wrap">{message.content}</p></article>
          : <article key={message.id} className="max-w-[92%] rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm leading-6"><RichText text={message.content} /></article>)}
        {sending ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在根据资源整理回答</div> : null}
      </div>
      <footer className="shrink-0 border-t bg-background p-4">
        {notice ? <div className="mb-2 text-xs text-destructive">{notice}</div> : null}
        <div className="flex items-end gap-2 rounded-xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="针对资源提出问题" className="min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground" /><button type="button" disabled={!draft.trim() || sending} onClick={() => void send()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400 text-white shadow-sm shadow-blue-200 disabled:opacity-35" aria-label="发送问题"><Send className="h-4 w-4" /></button></div>
      </footer>
    </section>
  </div>;
}
