/** drizzle 迁移共享库：db-migrate CLI 与 Compose bootstrap 共用（总规 §6.2）。 */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function applyMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('缺少 DATABASE_URL（见 .env.example）');
  const db = drizzle(url);
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/drizzle');
  await migrate(db, { migrationsFolder });
}
