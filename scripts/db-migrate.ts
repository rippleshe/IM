/**
 * 编程式执行 drizzle 迁移（pnpm db:migrate）
 * drizzle-kit migrate 在本机静默退出，改用 drizzle-orm 官方 migrator API。
 */
import 'dotenv/config';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('[db:migrate] 缺少 DATABASE_URL（见 .env.example）');
    process.exit(2);
  }
  const db = drizzle(databaseUrl);
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/drizzle');
  await migrate(db, { migrationsFolder });
  console.log('[db:migrate] ✔ 迁移已应用：', migrationsFolder);
  process.exit(0);
}

main().catch((error) => {
  console.error('[db:migrate] 迁移失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
