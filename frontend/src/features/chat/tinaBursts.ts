/** Tina 傲娇模式：心情标签 + 多段气泡 */

export const TINA_MOODS = [
  "NORMAL",
  "HAPPY",
  "SAD",
  "THINK",
  "HELPLESS",
  "MOCK",
  "DISDAIN",
] as const

export type TinaMood = (typeof TINA_MOODS)[number]

export type TinaBurst = {
  mood: TinaMood | null
  text: string
}

const MOOD_RE = /^\[(NORMAL|HAPPY|SAD|THINK|HELPLESS|MOCK|DISDAIN)\]\s*/i

export function parseTinaBursts(content: string): TinaBurst[] {
  const raw = (content || "").trim()
  if (!raw) return []

  const parts = raw
    .split(/\n\s*---\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks = parts.length > 0 ? parts : [raw]
  return chunks.map((chunk) => {
    const m = chunk.match(MOOD_RE)
    if (m) {
      return {
        mood: m[1].toUpperCase() as TinaMood,
        text: chunk.slice(m[0].length).trim(),
      }
    }
    return { mood: null, text: chunk }
  })
}

export function hasTinaMoodMarkup(content: string): boolean {
  return MOOD_RE.test((content || "").trim()) || /\n\s*---\s*\n/.test(content || "")
}

export const MOOD_LABEL: Record<TinaMood, string> = {
  NORMAL: "平静",
  HAPPY: "开心",
  SAD: "低落",
  THINK: "思考",
  HELPLESS: "无奈",
  MOCK: "傲娇",
  DISDAIN: "不屑",
}
