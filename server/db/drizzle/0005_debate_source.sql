-- 独立批评 Agent（总规 §5.2 升级）：质询议题区分来源（规则兜底 rule / LLM 批评 critic）
ALTER TABLE "debate_issues" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'rule';
