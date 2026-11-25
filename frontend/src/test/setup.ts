import "@testing-library/jest-dom/vitest"
import { beforeEach, vi } from "vitest"

// jsdom 未实现 matchMedia，部分组件（如 ResponsivePanel）依赖它
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!window.ResizeObserver) {
  // 必须是真的 class：组件里是 `new ResizeObserver(...)`，
  // 用 vi.fn() 当构造器会抛 "is not a constructor"
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
}

// 每个测试前清空 localStorage，保证 api 地址等状态隔离
beforeEach(() => {
  localStorage.clear()
})
