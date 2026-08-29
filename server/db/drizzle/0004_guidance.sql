-- 苏格拉底启发式追问会话（总规 §7.4）：低置信关键知识点的多轮引导，最多 5 轮
CREATE TABLE IF NOT EXISTS "guidance_sessions" (
  "id" text PRIMARY KEY,
  "learner_id" text NOT NULL,
  "path_node_id" text,
  "knowledge_point_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "round_count" integer NOT NULL DEFAULT 0,
  "decision" jsonb,
  "created_at" bigint NOT NULL,
  "finished_at" bigint,
  CONSTRAINT "ck_guidance_status" CHECK ("status" in ('active','finished'))
);
CREATE TABLE IF NOT EXISTS "guidance_turns" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "learner_id" text NOT NULL,
  "round" integer NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "evaluation" text NOT NULL,
  "correct" boolean NOT NULL,
  "bkt_before" jsonb NOT NULL,
  "bkt_after" jsonb NOT NULL,
  "created_at" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_guidance_sessions_learner" ON "guidance_sessions" ("learner_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_guidance_turns_session" ON "guidance_turns" ("session_id", "round");
