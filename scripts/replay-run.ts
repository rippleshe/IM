/**
 * 离线回放（docs/挑战杯多智能体可信协同升级计划.md 里程碑 F）
 *
 * 用法：pnpm replay:run data/exports/<file>.json
 * 不连接模型：根据导出包内的 artifact 与 Claim 重算每轮幻觉率、确定性门禁，
 * 与在线记录的裁决对照；输出"通过/失败 + 具体差异"。退出码 1 = 校验失败。
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { replayExport, type ExportPayloadLike } from '../server/runs/metrics.js';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('[replay-run] 用法：pnpm replay:run <导出包.json>');
    process.exit(2);
  }
  let payload: ExportPayloadLike;
  try {
    payload = JSON.parse(await readFile(file, 'utf8')) as ExportPayloadLike;
  } catch (error) {
    console.error(`[replay-run] 读取失败：${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  const result = replayExport(payload);
  console.log(`[replay-run] 回放对象：${payload.run?.id ?? '未知运行'}`);
  for (const attempt of result.attempts) {
    console.log(
      `  第 ${attempt.attempt} 轮：可审计声明 ${attempt.auditableClaims} 条、unsupported ${attempt.unsupportedClaims} 条、`
      + `幻觉率 ${attempt.hallucinationRate === null ? 'N/A（空分母）' : `${(attempt.hallucinationRate * 100).toFixed(1)}%`}、`
      + `重算门禁 ${attempt.ruleGate}、在线裁决 ${attempt.recordedVerdict ?? '缺记录'} → ${attempt.match ? '一致（不更松）' : '✘ 不一致'}`,
    );
  }
  console.log(
    `[replay-run] 初稿幻觉率 ${result.draftFinal.draftRate === null ? 'N/A' : (result.draftFinal.draftRate * 100).toFixed(1) + '%'}`
    + ` → 终稿幻觉率 ${result.draftFinal.finalRate === null ? 'N/A' : (result.draftFinal.finalRate * 100).toFixed(1) + '%'}`
    + `（门禁净增益 ${result.draftFinal.gateNetGain === null ? 'N/A' : (result.draftFinal.gateNetGain * 100).toFixed(1) + '%'}）`,
  );
  if (result.differences.length > 0) {
    console.log('[replay-run] 差异清单：');
    for (const difference of result.differences) console.log(`  - ${difference}`);
  }
  if (!result.passed) {
    console.error('[replay-run] ✘ 离线回放未通过');
    process.exit(1);
  }
  console.log('[replay-run] ✔ 离线回放与在线记录一致');
  process.exit(0);
}

main().catch((error) => {
  console.error('[replay-run] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
