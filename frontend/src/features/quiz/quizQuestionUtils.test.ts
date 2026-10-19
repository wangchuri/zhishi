import { describe, expect, it } from "vitest"

import {
  canSubmitAnswer,
  countBlankSlots,
  formatCorrectAnswerDisplay,
  getBlankCount,
  isAiGradedQuestion,
  isChoiceQuestion,
  isCustomQuestion,
  isFillBlankQuestion,
  isTextQuestion,
  parseAnswerParams,
  parseBlankAnswers,
  serializeBlankAnswers,
  splitStemWithBlanks,
  buildUserAnswerPayload,
  QUESTION_TYPE_LABEL,
} from "./quizQuestionUtils"

describe("题型判断", () => {
  it("isChoiceQuestion 缺省视为选择题", () => {
    expect(isChoiceQuestion()).toBe(true)
    expect(isChoiceQuestion("single_choice")).toBe(true)
    expect(isChoiceQuestion("fill_blank")).toBe(false)
  })

  it("fill_blank / short_answer / application / custom", () => {
    expect(isFillBlankQuestion("fill_blank")).toBe(true)
    expect(isTextQuestion("short_answer")).toBe(true)
    expect(isTextQuestion("application")).toBe(true)
    expect(isCustomQuestion("custom")).toBe(true)
    expect(isAiGradedQuestion("fill_blank")).toBe(true)
    expect(isAiGradedQuestion("short_answer")).toBe(true)
    expect(isAiGradedQuestion("single_choice")).toBe(false)
  })

  it("题型标签映射", () => {
    expect(QUESTION_TYPE_LABEL["single_choice"]).toBe("选择题")
    expect(QUESTION_TYPE_LABEL["multiple_choice"]).toBe("多选题")
    expect(QUESTION_TYPE_LABEL["fill_blank"]).toBe("填空题")
  })
})

describe("填空相关工具", () => {
  it("countBlankSlots 识别 ___ 与 {{blank}}", () => {
    expect(countBlankSlots("___ 和 ___")).toBe(2)
    expect(countBlankSlots("a {{blank}} b {{blank}} c")).toBe(2)
    expect(countBlankSlots("没有空")).toBe(0)
  })

  it("getBlankCount 无空时默认 1", () => {
    expect(getBlankCount({ question_id: "q1", order_index: 0, stem: "x", question_type: "fill_blank" })).toBe(1)
    expect(getBlankCount({ question_id: "q1", order_index: 0, stem: "___ 与 ___", question_type: "fill_blank" })).toBe(2)
  })

  it("parseBlankAnswers 解析 JSON 数组，失败回退单值", () => {
    expect(parseBlankAnswers('["北京","上海"]')).toEqual(["北京", "上海"])
    expect(parseBlankAnswers("北京")).toEqual(["北京"])
    expect(parseBlankAnswers("")).toEqual([])
  })

  it("serializeBlankAnswers 序列化", () => {
    expect(serializeBlankAnswers(["A", "B"])).toBe('["A","B"]')
  })

  it("splitStemWithBlanks 切分文本与空位", () => {
    const parts = splitStemWithBlanks("北京___上海")
    expect(parts).toEqual([
      { type: "text", value: "北京" },
      { type: "blank", value: "___" },
      { type: "text", value: "上海" },
    ])
  })

  it("splitStemWithBlanks 无空位返回整段文本", () => {
    expect(splitStemWithBlanks("普通文本")).toEqual([{ type: "text", value: "普通文本" }])
  })
})

describe("答案展示与提交", () => {
  it("formatCorrectAnswerDisplay 填空多空：解析数组并按空编号", () => {
    expect(formatCorrectAnswerDisplay('["A","B"]', "fill_blank")).toBe("（1）A　（2）B")
    expect(formatCorrectAnswerDisplay("正确答案", "single_choice")).toBe("正确答案")
  })

  it("canSubmitAnswer 按题型校验", () => {
    expect(canSubmitAnswer("single_choice", "A", "", [])).toBe(true)
    expect(canSubmitAnswer("single_choice", null, "", [])).toBe(false)
    expect(canSubmitAnswer("fill_blank", null, "", ["A"])).toBe(true)
    expect(canSubmitAnswer("fill_blank", null, "", ["", ""])).toBe(false)
    expect(canSubmitAnswer("short_answer", null, "答案", [])).toBe(true)
    expect(canSubmitAnswer("short_answer", null, "  ", [])).toBe(false)
    expect(canSubmitAnswer("custom", null, "", [], { a: "x" })).toBe(true)
    expect(canSubmitAnswer("custom", null, "", [], {})).toBe(false)
  })

  it("buildUserAnswerPayload 按题型构造 payload", () => {
    expect(buildUserAnswerPayload("single_choice", "B", "", [])).toBe("B")
    expect(buildUserAnswerPayload("fill_blank", null, "", ["A", "B"])).toBe('["A","B"]')
    expect(buildUserAnswerPayload("short_answer", null, " 答 ", [])).toBe("答")
    expect(buildUserAnswerPayload("custom", null, "", [], { x: "1" })).toBe('{"x":"1"}')
  })

  it("parseAnswerParams 解析 answer_params", () => {
    expect(parseAnswerParams('{"a":1}')).toEqual([])
    expect(parseAnswerParams('[{"key":"x","label":"X","type":"text"}]')).toEqual([
      { key: "x", label: "X", type: "text" },
    ])
    expect(parseAnswerParams(null)).toEqual([])
  })
})


/** 填空题答案在库里是 JSON 数组字符串，展示时不能把原始 JSON 露出来 */
describe("formatCorrectAnswerDisplay 答案展示", () => {
  it("填空题多空：解析数组 + 编号 + 裸 LaTeX 补美元符", () => {
    const out = formatCorrectAnswerDisplay('["u_{max}", "n $\\\\cdot$ u_{max}"]', "fill_blank")
    expect(out).not.toContain("[")
    expect(out).toContain("（1）")
    expect(out).toContain("（2）")
    expect(out).toContain("$u_{max}$")
  })

  it("填空题单空：不加编号", () => {
    expect(formatCorrectAnswerDisplay('["k+1"]', "fill_blank")).toBe("k+1")
  })

  it("填空题中文答案：不包美元符", () => {
    const out = formatCorrectAnswerDisplay('["有理式","代数式"]', "fill_blank")
    expect(out).toContain("（1）有理式")
    expect(out).not.toContain("$有理式$")
  })

  it("非填空但存成 JSON 数组：也不露出原始 JSON", () => {
    const out = formatCorrectAnswerDisplay('["A","B"]')
    expect(out).toContain("（1）A")
    expect(out).toContain("（2）B")
  })
})
