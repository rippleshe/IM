-- 反馈驱动的持久化学习决策（docs/挑战杯技术开发总规.md §7）
CREATE TABLE IF NOT EXISTS "learning_decisions" (
	"id" text PRIMARY KEY,
	"learner_id" text NOT NULL,
	"run_id" text,
	"asset_id" text,
	"knowledge_point_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"input_snapshot_id" text,
	"decision" text NOT NULL,
	"recommended_resource_type" text,
	"rationale_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "ck_decision_kind" CHECK ("decision" in ('remediate','continue','advance','collect_more_evidence'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_decisions_learner" ON "learning_decisions" ("learner_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_decisions_kp" ON "learning_decisions" ("learner_id","knowledge_point_id","created_at");
