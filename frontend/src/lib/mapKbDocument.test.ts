import { describe, expect, it } from "vitest"

import { mapFileType, mapKbDocument, mapStatus } from "./mapKbDocument"

describe("mapFileType", () => {
  it("按扩展名识别文件类型", () => {
    expect(mapFileType({ name: "a.pdf" })).toBe("pdf")
    expect(mapFileType({ name: "b.txt" })).toBe("txt")
    expect(mapFileType({ file_name: "c.md" })).toBe("md")
    expect(mapFileType({ name: "d.docx" })).toBe("docx")
    expect(mapFileType({ name: "e.unknown" })).toBe("txt")
  })
})

describe("mapStatus", () => {
  it("indexing_status 完成映射为 indexed", () => {
    expect(mapStatus({ indexing_status: "completed" })).toBe("indexed")
    expect(mapStatus({ status: "indexed" })).toBe("indexed")
  })

  it("处理中 / 失败 / 默认", () => {
    expect(mapStatus({ indexing_status: "processing" })).toBe("processing")
    expect(mapStatus({ status: "splitting" })).toBe("processing")
    expect(mapStatus({ status: "failed" })).toBe("failed")
    expect(mapStatus({ status: "error" })).toBe("failed")
    expect(mapStatus({})).toBe("pending")
  })

  it("ocr_status 处理中优先", () => {
    expect(mapStatus({ ocr_status: "processing", indexing_status: "completed" })).toBe(
      "processing"
    )
  })
})

describe("mapKbDocument", () => {
  it("完整映射字段", () => {
    const d = mapKbDocument(
      {
        id: "doc1",
        file_name: "chapter.pdf",
        indexing_status: "completed",
        tags: ["数学"],
        word_count: 1200,
        updated_at: "2024-01-01T00:00:00Z",
        segment_status: "completed",
      },
      "study"
    )
    expect(d.id).toBe("doc1")
    expect(d.name).toBe("chapter.pdf")
    expect(d.type).toBe("pdf")
    expect(d.status).toBe("indexed")
    expect(d.zone).toBe("study")
    expect(d.wordCount).toBe(1200)
    expect(d.tags).toEqual(["数学"])
  })

  it("缺省值兜底", () => {
    const d = mapKbDocument({ id: "doc2" })
    expect(d.name).toBe("doc2")
    expect(d.type).toBe("txt")
    expect(d.status).toBe("pending")
    expect(d.wordCount).toBe(0)
  })
})
