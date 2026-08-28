-- 挑战杯环境初始化：pgvector 扩展必须在 drizzle 迁移之前就绪（总规 §6.2）
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
