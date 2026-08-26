import { cn } from "@/lib/utils"

/** 雾圈：知拾 logo 里那种层层晕开的圆 */
export function MistRings({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} fill="none" aria-hidden>
      <circle cx="100" cy="100" r="18" fill="currentColor" opacity="0.18" />
      <circle cx="100" cy="100" r="42" stroke="currentColor" strokeWidth="1.25" opacity="0.38" />
      <circle cx="100" cy="100" r="68" stroke="currentColor" strokeWidth="1" opacity="0.22" />
      <circle cx="100" cy="100" r="94" stroke="currentColor" strokeWidth="0.75" opacity="0.12" />
    </svg>
  )
}

/** 线描鼠尾草 */
export function SageSprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 140" className={className} fill="none" aria-hidden>
      <path
        d="M40 132C40 98 38 72 40 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M40 108C28 100 18 92 14 80M40 88C52 80 62 70 66 58M40 68C26 62 16 50 14 38M40 48C54 42 64 30 66 20"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <ellipse cx="12" cy="76" rx="9" ry="5.5" transform="rotate(-28 12 76)" fill="currentColor" opacity="0.22" />
      <ellipse cx="68" cy="54" rx="9" ry="5.5" transform="rotate(32 68 54)" fill="currentColor" opacity="0.22" />
      <ellipse cx="12" cy="36" rx="8" ry="5" transform="rotate(-24 12 36)" fill="currentColor" opacity="0.18" />
      <ellipse cx="68" cy="18" rx="8" ry="5" transform="rotate(28 68 18)" fill="currentColor" opacity="0.18" />
    </svg>
  )
}

/** 日出细弧 */
export function SunArc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} fill="none" aria-hidden>
      <circle cx="60" cy="52" r="14" stroke="currentColor" strokeWidth="1.4" />
      <path d="M60 22V12M86 36l8-8M34 36l-8-8M96 52h10M14 52H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 70h104" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** 月牙 */
export function MoonArc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} fill="none" aria-hidden>
      <path
        d="M48 14a28 28 0 1 0 14 48 22 22 0 1 1-14-48z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="58" cy="22" r="1.4" fill="currentColor" />
      <circle cx="66" cy="34" r="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function TimeMotif({ hour, className }: { hour: number; className?: string }) {
  if (hour < 6 || hour >= 19) return <MoonArc className={className} />
  return <SunArc className={className} />
}

/** 完成印章 */
export function SealMark({
  className,
  label = "成",
}: {
  className?: string
  label?: string
}) {
  return (
    <svg viewBox="0 0 72 72" className={className} aria-hidden>
      <circle cx="36" cy="36" r="33" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="36" cy="36" r="27" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
      <text
        x="36"
        y="44"
        textAnchor="middle"
        fill="currentColor"
        fontSize="22"
        fontFamily="Fraunces, Songti SC, serif"
      >
        {label}
      </text>
    </svg>
  )
}

export function EmptyNotes({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 88" className={cn("text-sea", className)} fill="none" aria-hidden>
      <rect x="28" y="18" width="88" height="58" rx="6" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
      <path d="M42 36h60M42 48h44M42 60h52" stroke="currentColor" strokeWidth="1.1" opacity="0.35" strokeLinecap="round" />
      <rect x="48" y="10" width="88" height="58" rx="6" stroke="currentColor" strokeWidth="1.2" transform="rotate(8 92 39)" opacity="0.7" />
      <path d="M64 30h52M64 42h36" stroke="currentColor" strokeWidth="1.1" opacity="0.5" strokeLinecap="round" />
    </svg>
  )
}
