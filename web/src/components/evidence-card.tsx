"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";

interface EvidenceItem {
  id: string;
  source: string;
  sourceType: "structured" | "document" | "web";
  content: string;
  confidence: number;
  validationStatus: "supported" | "partial" | "conflict";
  metadata?: {
    datasetName?: string;
    lineNumber?: number;
    cardId?: string;
    url?: string;
  };
}

interface EvidenceCardProps {
  evidence: EvidenceItem;
  onJumpToSource?: (evidence: EvidenceItem) => void;
}

export function EvidenceCard({ evidence, onJumpToSource }: EvidenceCardProps) {
  const statusColors = {
    supported: "border-emerald-200 bg-emerald-50",
    partial: "border-amber-200 bg-amber-50",
    conflict: "border-rose-200 bg-rose-50",
  };

  const statusLabels = {
    supported: "已验证",
    partial: "部分支持",
    conflict: "存在冲突",
  };

  const statusIcons = {
    supported: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
    partial: <span className="h-3.5 w-3.5 text-amber-600">⚠</span>,
    conflict: <span className="h-3.5 w-3.5 text-rose-600">✕</span>,
  };

  const sourceTypeLabels = {
    structured: "结构化数据",
    document: "知识文档",
    web: "网络搜索",
  };

  const renderSourceDetail = () => {
    if (evidence.sourceType === "structured" && evidence.metadata?.datasetName) {
      return (
        <span className="text-[10px] text-muted-foreground">
          {evidence.metadata.datasetName}
          {evidence.metadata.lineNumber ? ` 第${evidence.metadata.lineNumber}行` : ""}
        </span>
      );
    }
    if (evidence.sourceType === "document" && evidence.metadata?.cardId) {
      return <span className="text-[10px] text-muted-foreground">卡片 {evidence.metadata.cardId}</span>;
    }
    if (evidence.sourceType === "web" && evidence.metadata?.url) {
      return (
        <a
          href={evidence.metadata.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
        >
          外部链接 <ExternalLink className="h-2.5 w-2.5" />
        </a>
      );
    }
    return null;
  };

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${statusColors[evidence.validationStatus]} hover:shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
              {sourceTypeLabels[evidence.sourceType]}
            </span>
            <div className="flex items-center gap-1">
              {statusIcons[evidence.validationStatus]}
              <span className="text-[10px] font-medium text-slate-700">
                {statusLabels[evidence.validationStatus]}
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-700">
            {evidence.content.length > 200 ? `${evidence.content.slice(0, 200)}...` : evidence.content}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">来源</span>
              <span className="text-[10px] font-medium text-slate-700">{evidence.source}</span>
            </div>
            {renderSourceDetail()}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-muted-foreground">置信度</div>
          <div className="text-lg font-bold text-slate-800">{Math.round(evidence.confidence * 100)}%</div>
          {onJumpToSource && (
            <button
              type="button"
              onClick={() => onJumpToSource(evidence)}
              className="mt-2 text-[10px] font-medium text-blue-600 hover:underline"
            >
              查看原始数据
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface EvidenceListProps {
  evidences: EvidenceItem[];
  title?: string;
  onJumpToSource?: (evidence: EvidenceItem) => void;
}

export function EvidenceList({ evidences, title = "证据依据", onJumpToSource }: EvidenceListProps) {
  if (evidences.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 text-center">
        <p className="text-sm text-muted-foreground">暂无证据记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="text-xs text-muted-foreground">{evidences.length} 条证据</span>
      </div>
      <div className="space-y-3">
        {evidences.map((evidence) => (
          <EvidenceCard key={evidence.id} evidence={evidence} onJumpToSource={onJumpToSource} />
        ))}
      </div>
    </div>
  );
}
