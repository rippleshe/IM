/**
 * 导出包完整性校验（docs/挑战杯技术开发总规.md §8.3）
 *
 * 用法：pnpm verify:export data/exports/<file>.json
 * 只做离线规则复算：不连接数据库、不调用模型。
 * 退出码 0 = 通过；1 = 校验失败（附具体差异）。
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { verifyExportIntegrity, type ExportPayloadLike } from '../server/runs/metrics.js';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('[verify-export] 用法：pnpm verify:export <导出包.json>');
    process.exit(2);
  }
  let payload: ExportPayloadLike;
  try {
    payload = JSON.parse(await readFile(file, 'utf8')) as ExportPayloadLike;
  } catch (error) {
    console.error(`[verify-export] 读取失败：${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  const result = verifyExportIntegrity(payload);
  console.log(`[verify-export] 校验对象：${payload.run?.id ?? '未知运行'}`);
  for (const check of result.checks) {
    console.log(`  ${check.passed ? '✔' : '✘'} ${check.label}：${check.detail}`);
  }
  console.log(`[verify-export] 执行清单散列：${result.manifestHash ?? '—'}`);
  if (payload.run?.executionManifestHash && result.manifestHash !== payload.run.executionManifestHash) {
    console.log(`  ✘ 执行清单散列与在线记录不一致（在线 ${payload.run.executionManifestHash}）`);
    result.passed = false;
  } else if (payload.run?.executionManifestHash) {
    console.log('  ✔ 执行清单散列与在线记录一致');
  }
  if (!result.passed) {
    console.error('[verify-export] ✘ 完整性校验未通过');
    process.exit(1);
  }
  console.log('[verify-export] ✔ 完整性校验通过');
  process.exit(0);
}

main().catch((error) => {
  console.error('[verify-export] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
