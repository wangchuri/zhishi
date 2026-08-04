import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { Citation } from "@/types"
import { CitationCard } from "./CitationCard"

function renderCard(props: React.ComponentProps<typeof CitationCard>) {
  return render(
    <MemoryRouter>
      <CitationCard {...props} />
    </MemoryRouter>
  )
}

describe("CitationCard", () => {
  it("无 doc_id 且无 snippet 时返回 null", () => {
    const { container } = renderCard({ citation: {} as Citation })
    expect(container.firstChild).toBeNull()
  })

  it("渲染标题与 snippet", () => {
    renderCard({
      citation: {
        doc_id: "d1",
        title: "微积分定义",
        snippet: "导数与微分是核心概念……",
      },
    })
    expect(screen.getByText("微积分定义")).toBeInTheDocument()
    expect(screen.getByText("导数与微分是核心概念……")).toBeInTheDocument()
  })

  it("无标题时回退为原文引用", () => {
    renderCard({ citation: { doc_id: "d1", snippet: "片段内容" } })
    expect(screen.getByText("原文引用")).toBeInTheDocument()
  })

  it("default 变体显示查看文档按钮", () => {
    renderCard({ citation: { doc_id: "d1", title: "T", snippet: "S" } })
    expect(screen.getByText("查看文档")).toBeInTheDocument()
  })

  it("inline 变体点击触发 onSelect", () => {
    const onSelect = vi.fn()
    renderCard({
      citation: { doc_id: "d1", title: "inline标题" },
      variant: "inline",
      onSelect,
    })
    const btn = screen.getByText("inline标题")
    btn.click()
    expect(onSelect).toHaveBeenCalledWith({ doc_id: "d1", title: "inline标题" })
  })

  it("显示 showIndex 序号", () => {
    renderCard({ citation: { doc_id: "d1", title: "T" }, showIndex: 3 })
    expect(screen.getByText("3. T")).toBeInTheDocument()
  })
})
