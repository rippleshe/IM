import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// 领域模型见 server/db/schema.ts（docs/挑战杯技术开发总规.md §6）
// 生成：pnpm db:generate；应用迁移：pnpm db:migrate
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://im_training:im_training_dev@localhost:5432/im_training',
  },
});
