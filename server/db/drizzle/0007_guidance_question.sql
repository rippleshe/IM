-- 苏格拉底会话持久化当前问题：round-1 评价需要问题上下文（此前首轮问题只返回给前端、未落库）
ALTER TABLE "guidance_sessions" ADD COLUMN IF NOT EXISTS "current_question" text;
