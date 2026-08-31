"use client";

import { Check, Copy } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

/**
 * 轻量 Markdown 富文本渲染（模型输出的正文/回答统一入口）。
 * 支持：围栏代码块、Markdown 表格、多级标题、有序/无序列表、引用、
 * 加粗/斜体/行内代码/链接。不引入第三方解析器，保证无安全面与包体增长。
 */
type RichTextProps = {
  text: string;
  /** 反色场景（用户气泡：深底白字） */
  invert?: boolean;
  /** chat=消息气泡紧凑排版；doc=讲义正文阅读排版 */
  variant?: "chat" | "doc";
};

type Token =
  | { kind: "code"; language: string; code: string; caption?: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "line"; text: string };

/** 把 Markdown 文本拆成块级 token：代码块与表格成块，其余逐行 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.trim().match(/^```(\w*)\s*$/);
    if (fence) {
      const language = fence[1] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // 跳过结束围栏
      tokens.push({ kind: "code", language, code: code.join("\n") });
      continue;
    }
    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] ?? "")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(cells(lines[index] ?? ""));
        index += 1;
      }
      if (header.length > 0) {
        tokens.push({ kind: "table", header, rows });
        continue;
      }
    }
    tokens.push({ kind: "line", text: line });
    index += 1;
  }
  return tokens;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** 行内 Markdown 渲染（加粗/斜体/行内代码/链接），供标题等单行场景单独使用 */
export function RichInlineText({ text }: { text: string }) {
  const parts = text.split(INLINE_PATTERN).filter(Boolean);
  return <>
    {parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
      if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{part.slice(1, -1)}</code>;
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2 hover:text-blue-700">{link[1]}</a>;
      return <Fragment key={index}>{part}</Fragment>;
    })}
  </>;
}

const InlineText = RichInlineText;

/** 学习路径节点描述：按「；」拆分为要点列表（无分隔符时整句呈现） */
export function DescriptionList({ text, compact = false }: { text: string; compact?: boolean }) {
  const parts = (text ?? "").split("；").map((part) => part.trim().replace(/[。.]$/, "")).filter(Boolean);
  if (parts.length <= 1) {
    return <p className={compact ? "text-[11px] leading-4" : "text-sm leading-6"}><InlineText text={text ?? ""} /></p>;
  }
  return <ul className={compact ? "mt-1.5 space-y-1" : "mt-1 space-y-1.5"}>
    {parts.map((part, index) => <li key={index} className={`flex gap-2 ${compact ? "text-[11px] leading-4" : "text-sm leading-6"}`}>
      <span className={`${compact ? "mt-[6px] h-1 w-1" : "mt-[10px] h-1.5 w-1.5"} shrink-0 rounded-full bg-muted-foreground/50`} />
      <span className="text-muted-foreground"><InlineText text={part} /></span>
    </li>)}
  </ul>;
}

function CodeFigure({ language, code, caption }: { language: string; code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch { /* 剪贴板不可用时忽略 */ }
  };
  return <figure className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
    <figcaption className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3.5 py-2">
      <span className="truncate text-[11px] font-medium text-zinc-300">{caption ?? (language || "代码")}</span>
      <button type="button" onClick={() => void copy()} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "已复制" : "复制"}
      </button>
    </figcaption>
    <pre className="overflow-x-auto px-3.5 py-3 text-xs leading-6"><code className="font-mono text-zinc-100">{code}</code></pre>
  </figure>;
}

function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return <div className="my-3 overflow-hidden rounded-xl border">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b bg-muted/25 text-muted-foreground">{header.map((cell, index) => <th key={index} className="whitespace-nowrap px-3 py-2 font-medium"><InlineText text={cell} /></th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b last:border-b-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-muted-foreground"><InlineText text={cell} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function RichText({ text, invert = false, variant = "chat" }: RichTextProps) {
  const tokens = tokenize(text ?? "");
  const isDoc = variant === "doc";
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    nodes.push(isDoc ? (
      listOrdered
        ? <ol key={key} className="my-2 space-y-1.5 ps-1">{items.map((item, index) => <li key={index} className="flex gap-2.5 text-[15px] leading-7 text-muted-foreground"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">{index + 1}</span><span><InlineText text={item} /></span></li>)}</ol>
        : <ul key={key} className="my-2 space-y-1.5 ps-1">{items.map((item, index) => <li key={index} className="flex gap-2.5 text-[15px] leading-7 text-muted-foreground"><span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" /><span><InlineText text={item} /></span></li>)}</ul>
    ) : (
      <div key={key} className="space-y-1">
        {items.map((item, index) => listOrdered
          ? <div key={index} className="flex gap-2"><span className="shrink-0 font-medium opacity-70">{index + 1}.</span><span><InlineText text={item} /></span></div>
          : <div key={index} className="flex gap-2"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-current/55" /><span><InlineText text={item} /></span></div>)}
      </div>
    ));
  };

  tokens.forEach((token, tokenIndex) => {
    if (token.kind === "code") {
      flushList(`pre-list-${tokenIndex}`);
      nodes.push(<div key={tokenIndex} className={invert ? "[&_figure]:border-zinc-700" : ""}><CodeFigure language={token.language} code={token.code} caption={token.caption} /></div>);
      return;
    }
    if (token.kind === "table") {
      flushList(`pre-table-${tokenIndex}`);
      nodes.push(<div key={tokenIndex} className={invert ? "[&_div]:border-zinc-700 [&_th]:text-zinc-300 [&_td]:text-zinc-300 [&_thead_tr]:bg-zinc-800/60" : ""}><MarkdownTable header={token.header} rows={token.rows} /></div>);
      return;
    }
    const raw = token.text;
    const trimmed = raw.trim();
    if (!trimmed) { flushList(`blank-${tokenIndex}`); return; }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList(`pre-h-${tokenIndex}`);
      const level = heading[1]!.length;
      const content = <InlineText text={heading[2]!} />;
      nodes.push(isDoc ? (
        level <= 1 ? <h2 key={tokenIndex} className="mt-6 mb-2 text-lg font-semibold tracking-tight text-foreground first:mt-0">{content}</h2>
        : level === 2 ? <h3 key={tokenIndex} className="mt-5 mb-1.5 text-base font-semibold tracking-tight text-foreground">{content}</h3>
        : <h4 key={tokenIndex} className="mt-4 mb-1 text-sm font-semibold text-foreground">{content}</h4>
      ) : (
        <div key={tokenIndex} className={`mt-2 font-semibold first:mt-0 ${level <= 2 ? "text-[15px]" : "text-sm"}`}><InlineText text={heading[2]!} /></div>
      ));
      return;
    }
    const ordered = trimmed.match(/^(\d+)[.、)]\s+(.*)$/);
    const unordered = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered);
      if (listItems.length > 0 && isOrdered !== listOrdered) flushList(`switch-${tokenIndex}`);
      listOrdered = isOrdered;
      listItems.push((ordered ? ordered[2] : unordered![1]) ?? "");
      return;
    }
    if (/^>\s?/.test(trimmed)) {
      flushList(`pre-quote-${tokenIndex}`);
      nodes.push(<blockquote key={tokenIndex} className={`my-2 rounded-r-lg border-l-2 border-foreground/30 px-3 py-2 text-[13px] leading-6 ${invert ? "bg-background/10 text-background/85" : "bg-muted/40 text-muted-foreground"}`}><InlineText text={trimmed.replace(/^>\s?/, "")} /></blockquote>);
      return;
    }
    flushList(`pre-p-${tokenIndex}`);
    nodes.push(isDoc
      ? <p key={tokenIndex} className="text-[15px] leading-8 text-muted-foreground"><InlineText text={trimmed} /></p>
      : <p key={tokenIndex} className="whitespace-pre-wrap leading-6"><InlineText text={trimmed} /></p>);
  });
  flushList("tail-list");
  return <div className={invert ? "text-background" : "text-foreground"}>{nodes}</div>;
}
