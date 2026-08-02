/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 纸本设定集色彩系统
        // 墨色系 - 文字与主操作
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          disabled: "var(--ink-disabled)",
        },
        // 纸色系 - 背景
        paper: {
          DEFAULT: "var(--paper)",
          2: "var(--paper-2)",
          deep: "var(--paper-deep)",
        },
        // 青绿 - 品牌强调色（替换原紫色）
        sea: {
          DEFAULT: "var(--sea)",
          bright: "var(--sea-bright)",
          subtle: "var(--sea-subtle)",
        },
        // 赭石 - 点缀色
        ember: {
          DEFAULT: "var(--ember)",
          subtle: "var(--ember-subtle)",
        },
        // 柔和分隔
        mist: "var(--mist)",
        // 描边
        line: {
          DEFAULT: "var(--line)",
          light: "var(--line-light)",
        },
        // 语义色
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
          foreground: "var(--ink)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
          foreground: "var(--ink)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
          foreground: "var(--paper)",
        },
        info: {
          DEFAULT: "var(--info)",
          soft: "var(--info-soft)",
          foreground: "var(--ink)",
        },
        // 兼容 shadcn 既有令牌
        border: "var(--line)",
        input: "var(--line)",
        ring: "var(--sea)",
        background: "var(--paper)",
        foreground: "var(--ink)",
        primary: {
          DEFAULT: "var(--sea)",
          foreground: "var(--paper)",
        },
        secondary: {
          DEFAULT: "var(--paper-2)",
          foreground: "var(--ink)",
        },
        muted: {
          DEFAULT: "var(--paper-2)",
          foreground: "var(--ink-soft)",
        },
        accent: {
          DEFAULT: "var(--sea-subtle)",
          foreground: "var(--sea)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "var(--paper)",
        },
        card: {
          DEFAULT: "var(--paper-2)",
          foreground: "var(--ink)",
        },
        popover: {
          DEFAULT: "var(--paper)",
          foreground: "var(--ink)",
        },
        sidebar: {
          DEFAULT: "var(--paper)",
          foreground: "var(--ink-soft)",
          primary: "var(--sea)",
          "primary-foreground": "var(--paper)",
          accent: "var(--sea-subtle)",
          "accent-foreground": "var(--sea)",
          border: "var(--line-light)",
          ring: "var(--sea)",
        },
      },
      borderRadius: {
        xs: "4px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "16px",
        full: "9999px",
      },
      boxShadow: {
        xs: "0 2px 8px rgba(20, 33, 43, 0.06)",
        sm: "0 4px 16px rgba(20, 33, 43, 0.08)",
        md: "0 8px 24px rgba(20, 33, 43, 0.10)",
        lg: "0 18px 50px rgba(20, 33, 43, 0.12)",
        sea: "0 4px 16px rgba(31, 92, 90, 0.12)",
      },
      fontSize: {
        "display-xl": ["48px", { lineHeight: "1.1", fontWeight: "700" }],
        "display-l": ["32px", { lineHeight: "1.15", fontWeight: "700" }],
        "display-m": ["24px", { lineHeight: "1.2", fontWeight: "700" }],
        "title-s": ["17px", { lineHeight: "1.3", fontWeight: "500" }],
        body: ["15px", { lineHeight: "1.6", fontWeight: "400" }],
        caption: ["13px", { lineHeight: "1.4", fontWeight: "400" }],
        small: ["12px", { lineHeight: "1.3", fontWeight: "400" }],
      },
      fontFamily: {
        display: ['"Fraunces"', '"Songti SC"', '"Noto Serif SC"', '"宋体"', 'serif'],
        sans: ['"Outfit"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
      },
      transitionDuration: {
        "150": "150ms",
        "200": "200ms",
        "300": "300ms",
        "400": "400ms",
      },
      keyframes: {
        "page-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "panel-in": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "msg-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-paper": {
          "0%, 100%": { backgroundColor: "var(--paper-2)" },
          "50%": { backgroundColor: "var(--paper-deep)" },
        },
      },
      animation: {
        "page-in": "page-in 300ms ease-out both",
        "panel-in": "panel-in 220ms ease-out both",
        "msg-in": "msg-in 240ms ease-out both",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-paper": "pulse-paper 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    ({ addVariant }) => {
      // 触屏/平板：无 hover 能力，依赖 hover 显隐的控件改为常显
      addVariant("can-hover", "@media (hover: hover) and (pointer: fine)")
      // 短屏（如 800px 高平板）：收紧页面间距
      addVariant("short", "@media (max-height: 820px)")
    },
  ],
}
