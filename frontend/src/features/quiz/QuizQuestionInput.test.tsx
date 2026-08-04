import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { QuizAnswerResult, QuizSessionQuestion } from "@/types"
import { QuizQuestionInput } from "./QuizQuestionInput"

function choiceQuestion(over: Partial<QuizSessionQuestion> = {}): QuizSessionQuestion {
  return {
    question_id: "q1",
    order_index: 0,
    stem: "1+1=?",
    question_type: "single_choice",
    options: [
      { key: "A", text: "2" },
      { key: "B", text: "3" },
    ],
    ...over,
  }
}

const baseProps = {
  selectedOption: null,
  textAnswer: "",
  blankAnswers: [],
  customAnswers: {},
  lastResult: null,
  submitting: false,
  onSelectOption: () => {},
  onTextAnswerChange: () => {},
  onBlankAnswersChange: () => {},
  onCustomAnswersChange: () => {},
}

describe("QuizQuestionInput", () => {
  it("选择题渲染选项并可点击选中", () => {
    const onSelectOption = vi.fn()
    render(
      <QuizQuestionInput
        {...baseProps}
        question={choiceQuestion()}
        onSelectOption={onSelectOption}
      />
    )
    expect(screen.getByText("A.")).toBeInTheDocument()
    const optB = screen.getByText("B.")
    fireEvent.click(optB)
    expect(onSelectOption).toHaveBeenCalledWith("B")
  })

  it("作答后选项被禁用", () => {
    render(
      <QuizQuestionInput
        {...baseProps}
        question={choiceQuestion()}
        lastResult={{ status: "correct" } as QuizAnswerResult}
      />
    )
    const optA = screen.getByText("A.").closest("button")!
    expect(optA).toBeDisabled()
  })

  it("填空题渲染空位输入框", () => {
    const onBlankAnswersChange = vi.fn()
    render(
      <QuizQuestionInput
        {...baseProps}
        question={choiceQuestion({
          question_id: "q2",
          stem: "___ 是首都，___ 是魔都",
          question_type: "fill_blank",
        })}
        onBlankAnswersChange={onBlankAnswersChange}
      />
    )
    const inputs = screen.getAllByPlaceholderText(/空\d/) as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    fireEvent.change(inputs[0], { target: { value: "北京" } })
    expect(onBlankAnswersChange).toHaveBeenCalledWith(["北京", ""])
  })

  it("简答题渲染 textarea", () => {
    render(
      <QuizQuestionInput
        {...baseProps}
        question={choiceQuestion({ question_type: "short_answer" })}
      />
    )
    expect(screen.getByPlaceholderText("请输入你的答案…")).toBeInTheDocument()
  })
})
