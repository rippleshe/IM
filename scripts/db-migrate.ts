/**
 * 编程式执行 drizzle 迁移（pnpm db:migrate）
 * drizzle-kit migrate 在本机静默退出，改用 drizzle-orm 官方 migrator API。
 */
import 'dotenv/config';
import { applyMigrations } from './db-migrate-lib.js';

async function main(): Promise<void> {
  await applyMigrations();
  console.log('[db:migrate] ✔ 迁移已应用：', 'server/db/drizzle');
  process.exit(0);
}

main().catch((error) => {
  console.error('[db:migrate] 迁移失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
