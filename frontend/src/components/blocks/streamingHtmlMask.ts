/**
 * 流式输出里把 ```html 代码块抠掉。
 *
 * 流式期间是纯文本渲染，代码块会原样显示成一堆 `<svg>` 源码；与其让用户看代码，
 * 不如先藏起来，等这条消息结束（换回 Markdown）再渲染成图。
 */
export function maskStreamingHtml(text: string): { text: string; drawing: boolean } {
  if (!text || !text.includes("```")) return { text, drawing: false }
  let drawing = false
  const out = text.replace(/```html\b[\s\S]*?(?:```|$)/gi, (block) => {
    const trimmed = block.trimEnd()
    // "```html" 本身 7 个字符：只有开头没有结尾说明还在写
    const closed = trimmed.length > 7 && trimmed.endsWith("```")
    if (!closed) drawing = true
    return closed ? "\n（图示已生成，输出结束后显示）\n" : "\n"
  })
  return { text: out, drawing }
}
