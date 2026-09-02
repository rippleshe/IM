-- VACP 可验证协同协议（docs/挑战杯技术开发总规.md §4、§6）
-- 全部新增列为 nullable 或带默认值，保留历史行：已有运行与演示数据不受影响。
CREATE TABLE IF NOT EXISTS "collaboration_artifacts" (
	"id" text PRIMARY KEY,
	"run_id" text NOT NULL,
	"learner_id" text NOT NULL,
	"node_key" text NOT NULL,
	"actor_key" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"artifact_type" text NOT NULL,
	"input_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload_json" jsonb NOT NULL,
	"public_rationale_json" jsonb NOT NULL,
	"producer_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "uq_artifact_node_attempt" UNIQUE ("run_id","node_key","attempt","artifact_type","actor_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artifacts_run" ON "collaboration_artifacts" ("run_id","attempt","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artifacts_learner" ON "collaboration_artifacts" ("learner_id");
--> statement-breakpoint
ALTER TABLE "collaboration_artifacts" ADD CONSTRAINT "ck_artifact_type" CHECK ("artifact_type" in
    ('learner_snapshot','design_constraints','evidence_set','domain_brief','resource_draft',
     'claim_audit','challenge_set','adjudication','privacy_decision','publication_decision','learning_decision'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_state_snapshots" (
	"id" text PRIMARY KEY,
	"run_id" text NOT NULL,
	"learner_id" text NOT NULL,
	"snapshot_type" text NOT NULL,
	"path_node_id" text,
	"skill_states_json" jsonb NOT NULL,
	"profile_summary_json" jsonb NOT NULL,
	"source_event_id" text,
	"content_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "uq_snapshot_run_type" UNIQUE ("run_id","snapshot_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_learner" ON "run_state_snapshots" ("learner_id","created_at");
--> statement-breakpoint
ALTER TABLE "run_state_snapshots" ADD CONSTRAINT "ck_snapshot_type" CHECK ("snapshot_type" in ('run_start','generation_end','feedback_update'));
--> statement-breakpoint
-- claims：运行/轮次/草稿产物关联（升级计划 G2）
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "run_id" text;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attempt" integer;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "draft_artifact_id" text;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "claim_type" text;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "logical_key" text;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "supersedes_claim_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_run_attempt" ON "claims" ("run_id","attempt");
--> statement-breakpoint
-- study_run_nodes：执行者键与主产物引用（升级计划 §4.3）
ALTER TABLE "study_run_nodes" ADD COLUMN IF NOT EXISTS "actor_key" text;
ALTER TABLE "study_run_nodes" ADD COLUMN IF NOT EXISTS "primary_artifact_id" text;
--> statement-breakpoint
-- study_runs：起止快照、检索后策略与执行清单（升级计划 §5.1）
ALTER TABLE "study_runs" ADD COLUMN IF NOT EXISTS "start_snapshot_id" text;
ALTER TABLE "study_runs" ADD COLUMN IF NOT EXISTS "verification_policy_json" jsonb;
ALTER TABLE "study_runs" ADD COLUMN IF NOT EXISTS "execution_manifest_hash" text;
