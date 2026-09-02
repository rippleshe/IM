ALTER TABLE "users" ADD COLUMN "knowledge_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 兼容历史数据库结构；不再授予任何用户资料库审核权限，审核由服务端智能策展负责。
