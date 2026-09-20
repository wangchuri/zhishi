import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  kbApi: {
    getLearningPath: vi.fn().mockResolvedValue({
      document_id: "d1",
      status: "generated",
      title: "一本书",
      chapters: [
        { id: "c1", title: "第一章", order: 1, key_points: ["甲", "乙"], learned: false },
        { id: "c2", title: "第二章", order: 2, key_points: ["丙"], learned: true },
      ],
    }),
  },
}))

import { BookOutline } from "./BookOutline"

describe("BookOutline", () => {
  it("点标题在目录与思维大纲之间切换", async () => {
    render(<BookOutline documentId="d1" />)
    await waitFor(() => expect(screen.getByText("书本目录")).toBeInTheDocument())
    expect(screen.queryByLabelText("书本思维大纲")).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("书本目录"))
    await waitFor(() => expect(screen.getByLabelText("书本思维大纲")).toBeInTheDocument())

    fireEvent.click(screen.getByText("书本思维大纲"))
    await waitFor(() => expect(screen.queryByLabelText("书本思维大纲")).not.toBeInTheDocument())
  })

  it("点目录里的章节直接进入思维大纲", async () => {
    render(<BookOutline documentId="d1" />)
    await waitFor(() => expect(screen.getByText("第一章")).toBeInTheDocument())

    fireEvent.click(screen.getByText("第一章"))
    await waitFor(() => expect(screen.getByLabelText("书本思维大纲")).toBeInTheDocument())
  })
})
