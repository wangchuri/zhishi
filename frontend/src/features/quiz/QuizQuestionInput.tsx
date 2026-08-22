import { useCallback, useEffect, useRef } from "react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { getApiBase } from "@/lib/api"
import type { QuizAnswerResult, QuizSessionQuestion } from "@/types"
import { cn } from "@/lib/utils"
import {
  getBlankCount,
  isChoiceQuestion,
  isCustomQuestion,
  isFillBlankQuestion,
  isTextQuestion,
  parseAnswerParams,
  splitStemWithBlanks,
} from "./quizQuestionUtils"

type QuizQuestionInputProps = {
  question: QuizSessionQuestion
  selectedOption: string | null
  textAnswer: string
  blankAnswers: string[]
  customAnswers: Record<string, string>
  lastResult: QuizAnswerResult | null
  submitting: boolean
  onSelectOption: (key: string) => void
  onTextAnswerChange: (value: string) => void
  onBlankAnswersChange: (values: string[]) => void
  onCustomAnswersChange?: (values: Record<string, string>) => void
  /** 来源文档 id，用于解析题目中的图片相对路径（images/xxx） */
  documentId?: string | null
}

export function QuizQuestionInput({
  question,
  selectedOption,
  textAnswer,
  blankAnswers,
  customAnswers,
  lastResult,
  submitting,
  onSelectOption,
  onTextAnswerChange,
  onBlankAnswersChange,
  onCustomAnswersChange,
  documentId,
}: QuizQuestionInputProps) {
  const qtype = question.question_type || "single_choice"
  const disabled = !!lastResult || submitting
  const isCustom = isCustomQuestion(qtype)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // 题目来源文档的图片 base（图床式：images/xxx → 完整 URL）
  const imageBase = documentId
    ? `${getApiBase().replace(/\/$/, "")}/api/v1/kb/documents/${encodeURIComponent(documentId)}/images`
    : undefined

  const handleCustomChange = useCallback(
    (key: string, value: string) => {
      if (!onCustomAnswersChange) return
      const next = { ...customAnswers }
      next[key] = value
      onCustomAnswersChange(next)
    },
    [customAnswers, onCustomAnswersChange]
  )

  // 把 HTML 里 data-answer-key 输入框的值桥接到组件状态，
  // 这样在 iframe 内直接填写也能被 canSubmitAnswer 识别。
  const syncToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(
      {
        type: "zhishi-custom-init",
        values: customAnswers,
        disabled: !!lastResult || submitting,
      },
      "*"
    )
  }, [customAnswers, lastResult, submitting])

  useEffect(() => {
    if (!isCustom) return
    syncToIframe()
  }, [isCustom, syncToIframe])

  useEffect(() => {
    if (!isCustom) return
    const win = iframeRef.current?.contentWindow
    const handler = (e: MessageEvent) => {
      if (win && e.source !== win) return
      const d = e.data
      if (!d) return
      if (d.type === "zhishi-custom-ready") {
        syncToIframe()
        return
      }
      if (d.type === "zhishi-custom-answer") {
        handleCustomChange(d.key, String(d.value ?? ""))
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [isCustom, handleCustomChange, syncToIframe])

  if (isChoiceQuestion(qtype)) {
    return (
      <>
        <MarkdownWithMath
          className="text-card-title font-semibold mb-6 leading-relaxed"
          imageBaseUrl={imageBase}
        >
          {question.stem}
        </MarkdownWithMath>
        <div className="space-y-2.5 mb-6">
        {(question.options || []).map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelectOption(opt.key)}
            className={cn(
              "w-full text-left rounded-lg border px-4 py-3 text-body transition-colors",
              selectedOption === opt.key
                ? "border-primary bg-primary-soft text-ink-primary"
                : "border-line-soft hover:border-primary/30 hover:bg-surface-soft",
              lastResult?.correct_answer === opt.key && "border-success bg-success-soft",
              lastResult &&
                lastResult.status !== "correct" &&
                selectedOption === opt.key &&
                "border-danger bg-danger-soft"
            )}
          >
            <span className="font-medium mr-2">{opt.key}.</span>
            <MarkdownWithMath
              proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0 prose-p:text-inherit"
              className="inline"
              imageBaseUrl={imageBase}
            >
              {opt.text}
            </MarkdownWithMath>
          </button>
        ))}
        </div>
      </>
    )
  }

  if (isFillBlankQuestion(qtype)) {
    const blankCount = getBlankCount(question)
    const parts = splitStemWithBlanks(question.stem)
    const hasInlineBlanks = parts.some((p) => p.type === "blank")
    let blankIndex = 0

    const updateBlank = (index: number, value: string) => {
      const next = [...blankAnswers]
      while (next.length < blankCount) next.push("")
      next[index] = value
      onBlankAnswersChange(next)
    }

    if (hasInlineBlanks) {
      return (
        <div className="mb-6 text-body leading-relaxed">
          {parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <MarkdownWithMath
                  key={`t-${i}`}
                  proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0"
                  className="inline"
                  imageBaseUrl={imageBase}
                >
                  {part.value}
                </MarkdownWithMath>
              )
            }
            const idx = blankIndex++
            return (
              <input
                key={`b-${i}`}
                type="text"
                value={blankAnswers[idx] ?? ""}
                onChange={(e) => updateBlank(idx, e.target.value)}
                disabled={disabled}
                className="inline-block align-baseline mx-1 min-w-[6rem] max-w-[12rem] rounded border border-line-soft bg-surface px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={`空${idx + 1}`}
              />
            )
          })}
        </div>
      )
    }

    return (
      <div className="mb-6 space-y-3">
        <MarkdownWithMath className="text-body leading-relaxed" imageBaseUrl={imageBase}>{question.stem}</MarkdownWithMath>
        {Array.from({ length: blankCount }).map((_, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-small text-ink-tertiary shrink-0 w-12">空 {idx + 1}</span>
            <input
              type="text"
              value={blankAnswers[idx] ?? ""}
              onChange={(e) => updateBlank(idx, e.target.value)}
              disabled={disabled}
              className="flex-1 rounded-lg border border-line-soft bg-surface px-4 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="请输入答案"
            />
          </div>
        ))}
      </div>
    )
  }

  if (isTextQuestion(qtype)) {
    return (
      <>
        <MarkdownWithMath className="text-card-title font-semibold mb-4 leading-relaxed" imageBaseUrl={imageBase}>
          {question.stem}
        </MarkdownWithMath>
        <textarea
          className="w-full min-h-[140px] rounded-lg border border-line-soft bg-surface px-4 py-3 text-body mb-6 focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="请输入你的答案…"
          value={textAnswer}
          onChange={(e) => onTextAnswerChange(e.target.value)}
          disabled={disabled}
        />
      </>
    )
  }

  if (isCustomQuestion(qtype)) {
    const params = parseAnswerParams(question.answer_params ?? null)
    const htmlContent = question.html_content ?? ""

    const bridgeScript = `
<script>
(function () {
  function report(key, value) {
    var el = document.querySelector('[data-answer-key="' + key + '"]');
    if (el) el.value = value == null ? "" : String(value);
    window.parent.postMessage({ type: 'zhishi-custom-answer', key: key, value: value == null ? "" : String(value) }, '*');
  }
  window.zhishiSetAnswer = report;
  function setVal(values) {
    document.querySelectorAll('[data-answer-key]').forEach(function (el) {
      var k = el.getAttribute('data-answer-key');
      if (values && Object.prototype.hasOwnProperty.call(values, k)) el.value = values[k];
    });
  }
  function setDisabled(disabled) {
    document.querySelectorAll('[data-answer-key]').forEach(function (el) { el.disabled = !!disabled; });
    document.querySelectorAll('[draggable]').forEach(function (el) { el.draggable = !disabled; });
  }
  function onField(e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-answer-key')) {
      report(t.getAttribute('data-answer-key'), t.value);
    }
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    if (d.type === 'zhishi-custom-init') { setVal(d.values || {}); setDisabled(d.disabled); }
  });
  window.parent.postMessage({ type: 'zhishi-custom-ready' }, '*');
})();
</script>`

    const srcDoc = htmlContent
      ? htmlContent.includes("</body>")
        ? htmlContent.replace(/<\/body>/i, bridgeScript + "</body>")
        : htmlContent + bridgeScript
      : ""

    return (
      <div className="mb-6 space-y-4">
        <MarkdownWithMath className="text-card-title font-semibold leading-relaxed" imageBaseUrl={imageBase}>
          {question.stem}
        </MarkdownWithMath>

        {/* HTML 渲染区域 */}
        {htmlContent && (
          <div className="border border-line-soft rounded-lg overflow-hidden">
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              title="自定义题目"
              className="w-full"
              style={{ border: "none", minHeight: 300, maxHeight: 500 }}
            />
          </div>
        )}

        {/* 答案输入表单（仅当 HTML 里没有 data-answer-key 时兜底） */}
        {params.length > 0 && !/data-answer-key/i.test(htmlContent) && (
          <div className="space-y-3 border border-line-soft rounded-lg p-4 bg-surface">
            <div className="text-small font-medium text-ink-primary mb-2">请填写答案</div>
            {params.map((p) => (
              <div key={p.key}>
                <label className="block text-small text-ink-secondary mb-1">{p.label}</label>
                {p.type === "textarea" ? (
                  <textarea
                    value={customAnswers[p.key] ?? ""}
                    onChange={(e) => handleCustomChange(p.key, e.target.value)}
                    disabled={disabled}
                    rows={3}
                    className="w-full rounded-lg border border-line-soft bg-surface px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder={`请输入${p.label}`}
                  />
                ) : (
                  <input
                    type={p.type === "number" ? "number" : "text"}
                    value={customAnswers[p.key] ?? ""}
                    onChange={(e) => handleCustomChange(p.key, e.target.value)}
                    disabled={disabled}
                    className="w-full rounded-lg border border-line-soft bg-surface px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder={`请输入${p.label}`}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}
