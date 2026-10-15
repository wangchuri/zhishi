/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 纸本设定集色彩系统
        // 约定：颜色一律走 rgb(var(--x-rgb) / <alpha-value>)，这样 /xx 透明度修饰符才生效；
        // 纯 rgba 令牌（-soft/-subtle/line）保持原样，不参与透明度修饰。
        // 墨色系 - 文字与主操作
        ink: {
          DEFAULT: "rgb(var(--ink-rgb) / <alpha-value>)",
          soft: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
          disabled: "rgb(var(--ink-disabled-rgb) / <alpha-value>)",
          // 语义别名：primary/secondary/tertiary 与 DEFAULT/soft/disabled 同色，统一层级写法
          primary: "rgb(var(--ink-rgb) / <alpha-value>)",
          secondary: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
          tertiary: "rgb(var(--ink-disabled-rgb) / <alpha-value>)",
        },
        // 纸色系 - 背景
        paper: {
          DEFAULT: "rgb(var(--paper-rgb) / <alpha-value>)",
          2: "rgb(var(--paper-2-rgb) / <alpha-value>)",
          deep: "rgb(var(--paper-deep-rgb) / <alpha-value>)",
        },
        // 抬升面 - 卡片/输入框等「浮在纸上」的一层
        surface: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          soft: "rgb(var(--surface-soft-rgb) / <alpha-value>)",
        },
        // 青绿 - 品牌强调色
        sea: {
          DEFAULT: "rgb(var(--sea-rgb) / <alpha-value>)",
          bright: "rgb(var(--sea-bright-rgb) / <alpha-value>)",
          subtle: "var(--sea-subtle)",
        },
        // 赭石 - 点缀色
        ember: {
          DEFAULT: "rgb(var(--ember-rgb) / <alpha-value>)",
          subtle: "var(--ember-subtle)",
        },
        // 柔和分隔
        mist: "rgb(var(--mist-rgb) / <alpha-value>)",
        // 描边（rgba 令牌：不参与 /xx 修饰）
        line: {
          DEFAULT: "var(--line)",
          light: "var(--line-light)",
          soft: "var(--line-light)",
        },
        // 语义色
        success: {
          DEFAULT: "rgb(var(--success-rgb) / <alpha-value>)",
          soft: "var(--success-soft)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning-rgb) / <alpha-value>)",
          soft: "var(--warning-soft)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger-rgb) / <alpha-value>)",
          soft: "var(--danger-soft)",
          foreground: "rgb(var(--paper-rgb) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--info-rgb) / <alpha-value>)",
          soft: "var(--info-soft)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        // 兼容 shadcn 既有令牌
        border: "var(--line)",
        input: "var(--line)",
        ring: "rgb(var(--sea-rgb) / <alpha-value>)",
        background: "rgb(var(--paper-rgb) / <alpha-value>)",
        foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        // 少数页面用 bg-bg 作页面底色
        bg: "rgb(var(--paper-rgb) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--sea-rgb) / <alpha-value>)",
          foreground: "rgb(var(--paper-rgb) / <alpha-value>)",
          soft: "var(--sea-subtle)",
        },
        secondary: {
          DEFAULT: "rgb(var(--paper-2-rgb) / <alpha-value>)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--paper-2-rgb) / <alpha-value>)",
          foreground: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "var(--sea-subtle)",
          foreground: "rgb(var(--sea-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--danger-rgb) / <alpha-value>)",
          foreground: "rgb(var(--paper-rgb) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          elevated: "rgb(var(--surface-rgb) / <alpha-value>)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--paper-rgb) / <alpha-value>)",
          foreground: "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "rgb(var(--paper-rgb) / <alpha-value>)",
          foreground: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
          primary: "rgb(var(--sea-rgb) / <alpha-value>)",
          "primary-foreground": "rgb(var(--paper-rgb) / <alpha-value>)",
          accent: "var(--sea-subtle)",
          "accent-foreground": "rgb(var(--sea-rgb) / <alpha-value>)",
          border: "var(--line-light)",
          ring: "rgb(var(--sea-rgb) / <alpha-value>)",
        },
      },
      borderRadius: {
        xs: "4px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "16px",
        // 与 2xl 合一，收敛圆角档位（原 3xl 走 Tailwind 默认 24px，过大）
        "3xl": "16px",
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
        // 页头标题：单一真实档位（此前 text-page-title 未定义 → 页头其实是 15px 正文）
        "page-title": ["22px", { lineHeight: "1.3", fontWeight: "700" }],
        "title-s": ["17px", { lineHeight: "1.3", fontWeight: "500" }],
        // 卡片标题/区块标题：只加重不加粗放大，省纵向空间
        "card-title": ["15px", { lineHeight: "1.4", fontWeight: "600" }],
        "section-title": ["13px", { lineHeight: "1.4", fontWeight: "600" }],
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
