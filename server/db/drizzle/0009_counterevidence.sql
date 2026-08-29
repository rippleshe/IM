-- 里程碑 D：批评 Agent 可提出反证检索请求（升级计划 §里程碑D 第 7 条）
-- 议题类型扩展 counterevidence_request；旧数据均在原枚举内，约束重建无损。
ALTER TABLE "debate_issues" DROP CONSTRAINT IF EXISTS "ck_debate_issue_type";
ALTER TABLE "debate_issues" ADD CONSTRAINT "ck_debate_issue_type" CHECK ("issue_type" in ('no_evidence','conflict','out_of_scope_causality','difficulty_mismatch','counterevidence_request'));
