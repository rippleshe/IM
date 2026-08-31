"use client";

import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

type ContextClearDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * 对话上下文的可逆入口、不可逆确认统一在产品内完成，避免落回浏览器原生提示框。
 */
export function ContextClearDialog({
  open,
  title,
  description,
  confirmLabel = "清除对话",
  pending = false,
  onConfirm,
  onClose,
}: ContextClearDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, pending]);

  if (!open) return null;

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-700/15 p-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section role="alertdialog" aria-modal="true" aria-labelledby="context-clear-title" aria-describedby="context-clear-description" className="w-full max-w-[430px] rounded-2xl border border-[#dce6f1] bg-[#fbfdff] p-5 shadow-[0_18px_42px_rgb(57_86_120_/_16%)]">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600"><AlertTriangle className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><h2 id="context-clear-title" className="text-sm font-semibold tracking-tight text-slate-700">{title}</h2><p id="context-clear-description" className="mt-1.5 text-[13px] leading-5 text-slate-500">{description}</p></div>
        <button type="button" disabled={pending} onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40" aria-label="关闭确认窗口"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 rounded-xl border border-[#e5edf5] bg-white/80 px-3 py-2.5 text-[11px] leading-5 text-slate-500">此操作不可恢复，但不会影响已保存的学习成果。</div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button ref={cancelRef} type="button" disabled={pending} onClick={onClose} className="inline-flex h-8 items-center justify-center rounded-lg border border-[#d7e2ee] bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">保留对话</button>
        <button type="button" disabled={pending} onClick={onConfirm} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-55">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{pending ? "正在清除" : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
