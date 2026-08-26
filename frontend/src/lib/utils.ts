import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 后端 accuracy_rate 为 0–1；若已是百分数则原样使用。 */
export function accuracyPercent(rate: number | null | undefined): number | null {
  if (rate == null || Number.isNaN(Number(rate))) return null
  const n = Number(rate)
  const pct = n <= 1 ? n * 100 : n
  return Math.round(pct * 10) / 10
}

export function formatAccuracy(rate: number | null | undefined): string {
  const pct = accuracyPercent(rate)
  return pct == null ? "—" : `${pct}%`
}

/** 去掉误入库的 JSON 列表碎片：`["高等数学"` / `"零基础"` / `"归纳法"]` */
export function sanitizeTagLabel(raw: string | null | undefined): string {
  let t = String(raw ?? "").trim()
  if (t.startsWith("[") && !t.endsWith("]")) t = t.slice(1).trim()
  if (t.endsWith("]") && !t.startsWith("[")) t = t.slice(0, -1).trim()
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    t = t.slice(1, -1).trim()
  }
  return t
}

/** 把「零基础, 数列, 等比数列」拆成多枚；JSON 碎片不拆。 */
export function splitTagLabels(raw: string | null | undefined): string[] {
  const t = sanitizeTagLabel(raw)
  if (!t) return []
  if (/[\[\]]/.test(t)) return [t]
  const parts = t.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : [t]
}
