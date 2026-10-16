import { cn } from "@/lib/utils"

/** 按「字素」切分：中文/emoji 不会被切成半截（Intl 不可用时退回按码位）。 */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].map(
      (p) => p.segment,
    )
  }
  return Array.from(text)
}

/** 只有末尾这么多个字带渐显动画：够看出"在写"，又不必每帧重建整段 DOM。 */
const INK_TAIL = 18

/**
 * 流式输出的「墨迹」效果：末尾 INK_TAIL 个字包一层 `.stream-ink-char`
 * （模糊 4px + 透明 → 清晰，0.38s），前面已稳定的字原样输出。
 *
 * 备注：动画期间这里渲染的是**纯文本**（不解析 markdown），
 * 流结束后由调用方换回 MarkdownWithMath —— 聊天页与辅导面板都是这个约定。
 */
export function StreamingInk({
  text,
  crimson = false,
  className,
}: {
  text: string
  crimson?: boolean
  className?: string
}) {
  const chars = graphemes(text)
  const split = Math.max(0, chars.length - INK_TAIL)
  const head = chars.slice(0, split).join("")
  const tail = chars.slice(split)
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words leading-relaxed",
        crimson ? "text-danger" : "text-ink",
        className,
      )}
    >
      {head}
      {tail.map((ch, i) => (
        <span key={split + i} className="stream-ink-char">
          {ch}
        </span>
      ))}
    </div>
  )
}
