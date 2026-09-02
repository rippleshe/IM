-- Run 请求幂等键（总规 §3）：同 learner 同 key 幂等返回已有 runId
ALTER TABLE "study_runs" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_study_runs_idempotency" ON "study_runs" ("learner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
