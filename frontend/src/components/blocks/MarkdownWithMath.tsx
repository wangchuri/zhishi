import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { cn } from "@/lib/utils"

/** 默认 prose 样式，适用于助手消息 / 正文 */
export const markdownProseClass =
  "prose prose-sm max-w-none prose-headings:text-ink-primary prose-p:text-ink-primary prose-p:my-1 prose-strong:text-ink-primary prose-a:text-primary prose-code:bg-surface-soft prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-surface-soft prose-pre:border prose-pre:border-line-soft prose-ul:my-1 prose-ol:my-1"

/** 危机模式助手正文 */
export const markdownProseDangerClass =
  "prose prose-sm max-w-none prose-headings:text-danger prose-p:text-danger prose-p:my-1 prose-strong:text-danger prose-a:text-danger prose-code:bg-danger-soft prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-danger-soft prose-pre:border prose-pre:border-danger/20 prose-ul:my-1 prose-ol:my-1 prose-li:text-danger"

/** 用户消息（深色背景）prose 样式 */
export const markdownProseInvertClass =
  "prose prose-sm prose-invert max-w-none prose-p:my-1 prose-p:text-white prose-strong:text-white prose-a:text-white prose-code:bg-white/15 prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-white/10 prose-pre:border prose-pre:border-white/20 prose-ul:my-1 prose-ol:my-1"

interface MarkdownWithMathProps {
  children: string
  className?: string
  proseClass?: string
  /** 图片相对路径的前缀（如文档图片接口 base），提供后 images/xxx 会拼成完整 URL */
  imageBaseUrl?: string
}

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "{") depth++
    else if (s[i] === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const BARE_ARG_COMMANDS = /\\(?:sin|cos|tan|cot|sec|csc|ln|log|exp|lim|sup|inf|min|max|det|gcd|Pr|arcsin|arccos|arctan)\s*$/

/** 从 `\` 起消费一个 LaTeX 命令及其下标/参数（含 `\lim_{...}`、`\frac{a}{b}`）。 */
function consumeLatexCommand(s: string, start: number): number {
  let i = start + 1
  if (i >= s.length) return start
  if (/[a-zA-Z]/.test(s[i])) {
    while (i < s.length && /[a-zA-Z]/.test(s[i])) i++
  } else {
    return start
  }
  if (s[i] === "*") i++

  while (i < s.length) {
    if (s[i] === "{") {
      const end = findMatchingBrace(s, i)
      if (end < 0) break
      i = end + 1
      continue
    }
    if (s[i] === "[") {
      const close = s.indexOf("]", i)
      if (close < 0) break
      i = close + 1
      continue
    }
    if (s[i] === "_" || s[i] === "^") {
      i++
      if (s[i] === "{") {
        const end = findMatchingBrace(s, i)
        if (end < 0) break
        i = end + 1
      } else if (i < s.length && s[i] !== " ") {
        i++
      }
      continue
    }
    break
  }

  if (BARE_ARG_COMMANDS.test(s.slice(start, i))) {
    const rest = s.slice(i)
    const m = rest.match(/^(?:\s+[A-Za-z0-9()+\-*/.=]+)(?=\s|$|[，。；、：？！\u4e00-\u9fff])/)
    if (m) i += m[0].length
  }
  return i
}

/** 把未用 $ 包裹的 `\lim` / `\frac` 等片段包成行内公式。 */
function wrapBareLatex(text: string): string {
  const placeholders: string[] = []
  const stash = (m: string) => {
    placeholders.push(m)
    return `\u0000${placeholders.length - 1}\u0000`
  }
  let s = text.replace(/\$\$[\s\S]*?\$\$/g, stash).replace(/\$[^$\n]+\$/g, stash)

  let out = ""
  let i = 0
  while (i < s.length) {
    if (s[i] === "\\" && /[a-zA-Z]/.test(s[i + 1] || "")) {
      let end = consumeLatexCommand(s, i)
      while (true) {
        let j = end
        while (j < s.length && s[j] === " ") j++
        if (s[j] === "\\" && /[a-zA-Z]/.test(s[j + 1] || "")) {
          end = consumeLatexCommand(s, j)
          continue
        }
        break
      }
      out += `$${s.slice(i, end)}$`
      i = end
      continue
    }
    out += s[i]
    i++
  }

  return out.replace(/\u0000(\d+)\u0000/g, (_, n) => placeholders[Number(n)])
}

/**
 * 支持 GFM + LaTeX（$...$ 行内、$$...$$ 块级）的 Markdown 渲染。
 *
 * 同时兼容 \(...\)、\[...\]，以及出题模型常见的裸命令（\lim / \frac）。
 */
export function preprocessLatex(content: string): string {
  let result = content.replace(/\\\(/g, "$").replace(/\\\)/g, "$")
  result = result.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$")
  result = wrapBareLatex(result)
  return result
}

export function MarkdownWithMath({
  children,
  className,
  proseClass = markdownProseClass,
  imageBaseUrl,
}: MarkdownWithMathProps) {
  if (!children) return null

  const processed = preprocessLatex(children)

  // 把相对图片路径 images/xxx 解析为完整 URL（图床式引用）
  const urlTransform = (url: string): string => {
    if (!imageBaseUrl || !url) return url
    if (/^(https?:|data:|blob:|#|\/)/i.test(url)) return url
    // 接口路径已含 /images，markdown 的 images/xxx 只取文件名
    const cleaned = url.replace(/^(?:\.\/)?images\//, "").replace(/^\.\//, "")
    return `${imageBaseUrl.replace(/\/$/, "")}/${cleaned}`
  }

  return (
    <div className={cn(proseClass, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={{
          img: ({ src, alt, ...props }) => (
            <img
              {...props}
              src={src}
              alt={alt || ""}
              loading="lazy"
              decoding="async"
              data-tip-image
              className="max-w-full h-auto rounded-md"
            />
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
