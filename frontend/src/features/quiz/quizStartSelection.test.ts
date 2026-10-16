import { describe, expect, it } from "vitest"

import type { Question } from "@/types"
import {
  buildQuizStartBody,
  countByBucket,
  countByChapter,
  countByDifficulty,
  countQuizSelection,
  customCountTotal,
  describeSelection,
  effectiveTypeCounts,
  emptyQuizStartSelection,
  questionBucket,
  questionMatchesSelection,
  quizStartTotal,
} from "./quizStartSelection"

function q(partial: Partial<Question>): Question {
  return { id: partial.id || Math.random().toString(36).slice(2), stem: "s", question_type: "single_choice", ...partial }
}

const POOL: Question[] = [
  q({ id: "1", question_type: "single_choice", chapter_id: "c1", difficulty: 1, tags: ["数列"] }),
  q({ id: "2", question_type: "single_choice", chapter_id: "c1", difficulty: 2, tags: ["数列"] }),
  q({ id: "3", question_type: "fill_blank", chapter_id: "c2", difficulty: 3, tags: ["极限"] }),
  q({ id: "4", question_type: "application", chapter_id: "c2", difficulty: null, tags: ["极限"] }),
  q({ id: "5", question_type: "short_answer", chapter_id: null, difficulty: null }),
  q({ id: "6", question_type: "single_choice", chapter_id: "c1", material_id: "m1", difficulty: 2 }),
  q({ id: "7", question_type: "single_choice", chapter_id: "c1", material_id: "m1", difficulty: 2 }),
]

describe("刷题选择模型", () => {
  it("默认全选：章节/题型/难度/知识点都不限 → 全部题目", () => {
    expect(countQuizSelection(POOL, emptyQuizStartSelection())).toBe(POOL.length)
  })

  it("章节子集只含该章；空数组=全书（含未归类）", () => {
    const sel = { ...emptyQuizStartSelection(), chapterIds: ["c1"] }
    expect(countQuizSelection(POOL, sel)).toBe(4) // 1,2,6,7
    const unfiled = { ...emptyQuizStartSelection(), chapterIds: ["c1", "c2"] }
    expect(countQuizSelection(POOL, unfiled)).toBe(6) // 未归类的 5 不入选
  })

  it("材料子题统一归到 material 桶", () => {
    expect(questionBucket(q({ question_type: "single_choice", material_id: "m1" }))).toBe("material")
    expect(questionBucket(q({ question_type: "fill_blank" }))).toBe("fill_blank")
    expect(countByBucket(POOL)).toEqual({
      single_choice: 2,
      fill_blank: 1,
      application: 1,
      short_answer: 1,
      material: 2,
    })
  })

  it("难度：不限时含未标注的老题；勾了具体难度后老题不入选", () => {
    const all = emptyQuizStartSelection()
    expect(countQuizSelection(POOL, all)).toBe(7)

    const easy = { ...all, difficulties: [1] }
    expect(countQuizSelection(POOL, easy)).toBe(1)

    const midHard = { ...all, difficulties: [2, 3] }
    expect(countQuizSelection(POOL, midHard)).toBe(4) // 2,3,6,7
    // 未标注（null）的 4、5 不进任何难度档
    expect(questionMatchesSelection(POOL[3], easy)).toBe(false)
  })

  it("知识点是并集（任一命中）", () => {
    const sel = { ...emptyQuizStartSelection(), tags: ["极限"] }
    expect(countQuizSelection(POOL, sel)).toBe(2)
  })

  it("题型 + 章节 + 难度可以叠加", () => {
    const sel = { ...emptyQuizStartSelection(), chapterIds: ["c1"], types: ["material"], difficulties: [2] }
    expect(countQuizSelection(POOL, sel)).toBe(2)
  })

  it("countByDifficulty / countByChapter 角标", () => {
    expect(countByDifficulty(POOL)).toEqual({ 1: 1, 2: 3, 3: 1 })
    expect(countByChapter(POOL)).toEqual({ c1: 4, c2: 2 })
  })
})

describe("组装创建会话请求", () => {
  it("均衡模式：只带 count 与 distribute；全选时不带筛选字段", () => {
    const sel = { ...emptyQuizStartSelection(), count: 10 }
    expect(buildQuizStartBody(sel, { documentId: "d1" })).toEqual({
      document_id: "d1",
      count: 10,
      distribute: "balanced",
    })
  })

  it("数量「全部」(0) 时不传 count", () => {
    const sel = { ...emptyQuizStartSelection(), count: 0 }
    expect(buildQuizStartBody(sel)).toEqual({ distribute: "balanced" })
  })

  it("自定义分布：传 type_counts，且丢掉 0", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      distribute: "custom" as const,
      typeCounts: { single_choice: 3, fill_blank: 0, material: 1 },
    }
    const body = buildQuizStartBody(sel, { groupId: "g1", title: "混合" })
    expect(body.type_counts).toEqual({ single_choice: 3, material: 1 })
    expect(body.count).toBeUndefined()
    expect(body.group_id).toBe("g1")
    expect(body.title).toBe("混合")
  })

  it("选择的章节/题型/难度/知识点照实传", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      chapterIds: ["c1"],
      types: ["single_choice"],
      difficulties: [1, 3],
      tags: ["数列"],
    }
    const body = buildQuizStartBody(sel)
    expect(body.chapter_ids).toEqual(["c1"])
    expect(body.question_types).toEqual(["single_choice"])
    expect(body.difficulties).toEqual([1, 3])
    expect(body.tags).toEqual(["数列"])
  })
})

describe("本次题数", () => {  it("均衡：不超过命中数", () => {
    const sel = { ...emptyQuizStartSelection(), count: 10 }
    expect(quizStartTotal(sel, 4)).toBe(4)
    expect(quizStartTotal(sel, 30)).toBe(10)
  })

  it("全部：等于命中数", () => {
    const sel = { ...emptyQuizStartSelection(), count: 0 }
    expect(quizStartTotal(sel, 12)).toBe(12)
  })

  it("自定义：等于各题型之和", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      distribute: "custom" as const,
      typeCounts: { single_choice: 3, fill_blank: 2, custom: 0 },
    }
    expect(customCountTotal(sel)).toBe(5)
    expect(quizStartTotal(sel, 99)).toBe(5)
  })

  it("自定义：只算当前勾选的题型（取消勾选的配额不计/不入参）", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      distribute: "custom" as const,
      types: ["fill_blank"],
      typeCounts: { single_choice: 3, fill_blank: 2 },
    }
    expect(effectiveTypeCounts(sel)).toEqual({ fill_blank: 2 })
    expect(customCountTotal(sel)).toBe(2)
    expect(buildQuizStartBody(sel).type_counts).toEqual({ fill_blank: 2 })
  })
})

describe("底部「本次将刷」摘要", () => {
  it("默认（全不选）：全书 · 全部题型 · 不限难度 · 共 10 题", () => {
    expect(describeSelection(emptyQuizStartSelection(), 30)).toBe(
      "全书 · 全部题型 · 不限难度 · 共 10 题",
    )
  })

  it("数量「全部」：按命中数给总数", () => {
    const sel = { ...emptyQuizStartSelection(), count: 0 }
    expect(describeSelection(sel, 274)).toContain("共 274 题")
  })

  it("单选一项：章节标题 / 单个题型 / 单档难度", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      chapterIds: ["c2"],
      types: ["fill_blank"],
      difficulties: [2],
    }
    expect(describeSelection(sel, 44, { chapterTitles: { c2: "第2章 数据的表示和运算" } })).toBe(
      "第2章 数据的表示和运算 · 填空题 · 中等 · 共 10 题",
    )
  })

  it("多选：给数量、难度用 + 连接；带知识点", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      chapterIds: ["c1", "c2"],
      types: ["fill_blank", "single_choice"],
      difficulties: [2, 3],
      tags: ["数列"],
    }
    expect(describeSelection(sel, 100)).toBe(
      "2 个章节 · 2 种题型 · 中等 + 困难 · 知识点「数列」 · 共 10 题",
    )
  })

  it("自定义分布：总数按各题型配额之和", () => {
    const sel = {
      ...emptyQuizStartSelection(),
      distribute: "custom" as const,
      typeCounts: { single_choice: 3, fill_blank: 2 },
    }
    expect(describeSelection(sel, 100)).toContain("共 5 题")
  })
})
