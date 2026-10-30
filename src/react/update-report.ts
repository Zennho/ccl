import type { UpdateReport } from './content-state';

export function updateReport(r: UpdateReport | null, fallback: string) {
  return r
    ? `已检查 ${r.checked} 个，发现 ${r.updates.length} 个可更新；${r.unknown} 个无法识别或确认，${r.failed} 个检查失败。`
    : fallback;
}
