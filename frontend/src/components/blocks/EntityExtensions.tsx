import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Pause, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { canSpeak, speakText, stopSpeaking } from "@/lib/speech"
import type { EntityAudio, EntityExtensionData, EntityExtensions, EntityWord } from "@/types"

/**
 * 插件扩展槽的通用渲染器。
 *
 * 后端插件（如「英语」）往实体的 `extensions` 里塞数据，前端只按固定键渲染：
 * audio → 发音按钮、words → 词条 chip、dict → 词典卡。
 *
 * **插件永远不碰前端代码**，加新领域（物理的受力图、化学的结构式）时只要复用
 * 已有键，或者在这里加一个新键 + 一个渲染器。
 */

/** 离开页面时停掉朗读，别让声音跟着用户走 */
function useStopOnUnmount() {
  useEffect(() => stopSpeaking, [])
}

// ---- 发音按钮 ----

/**
 * 发音按钮：`src` 有值就播音频文件，否则用浏览器 TTS 朗读 `text`。
 *
 * 第一版英语插件只给 `text`（零依赖、离线可用）；以后接真人录音或云端 TTS 时，
 * 插件把 `src` 填上，这里自动优先用它。
 */
export const AudioButton = memo(function AudioButton({
  audio,
  label,
  className,
}: {
  audio: EntityAudio
  /** 覆盖显示文字；不传就只显示喇叭图标 */
  label?: string
  className?: string
}) {
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useStopOnUnmount()

  const usable = Boolean(audio.src) || Boolean(audio.text && canSpeak())

  const toggle = useCallback(() => {
    if (!usable || failed) return
    if (playing) {
      audioRef.current?.pause()
      stopSpeaking()
      setPlaying(false)
      return
    }
    if (audio.src) {
      const el = audioRef.current
      if (!el) return
      el.currentTime = 0
      void el
        .play()
        .then(() => setPlaying(true))
        .catch(() => setFailed(true))
      return
    }
    const ok = speakText(audio.text || "", audio.lang || "en-US", () => setPlaying(false))
    if (ok) setPlaying(true)
    else setFailed(true)
  }, [audio.lang, audio.src, audio.text, failed, playing, usable])

  const text = label ?? audio.label ?? "发音"
  const icon = playing ? (
    <Pause className="w-3.5 h-3.5" strokeWidth={2} />
  ) : (
    <Volume2 className="w-3.5 h-3.5" strokeWidth={2} />
  )

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!usable || failed}
      title={failed ? "这个设备不支持朗读" : text}
      aria-label={text}
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2 rounded-full border text-caption transition-colors",
        playing
          ? "border-sea/50 bg-sea-subtle text-sea"
          : "border-line-soft bg-paper text-ink-soft hover:border-sea/40 hover:text-sea",
        (!usable || failed) && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {icon}
      {label ? <span>{label}</span> : null}
      {audio.src ? (
        <audio
          ref={audioRef}
          src={audio.src}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
          preload="none"
        />
      ) : null}
    </button>
  )
})

// ---- 词条 chip ----

/** 生词 chip：点一下念，有音标/释义时点「?」展开 */
export const WordChip = memo(function WordChip({ word }: { word: EntityWord }) {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  useStopOnUnmount()

  const speakWord = useCallback(() => {
    const audio = word.audio
    if (audio?.src) {
      const el = new Audio(audio.src)
      el.onended = () => setPlaying(false)
      el.onerror = () => setPlaying(false)
      setPlaying(true)
      void el.play().catch(() => setPlaying(false))
      return
    }
    const ok = speakText(word.word, audio?.lang || "en-US", () => setPlaying(false))
    if (ok) setPlaying(true)
  }, [word.audio, word.word])

  const detail = [word.phonetic, word.meaning].filter(Boolean).join(" ")

  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-line-soft bg-paper">
      <button
        type="button"
        onClick={speakWord}
        title={`朗读 ${word.word}`}
        className={cn(
          "inline-flex items-center gap-1 h-6 pl-2 pr-1.5 text-caption transition-colors",
          playing ? "text-sea" : "text-ink-soft hover:text-sea",
        )}
      >
        <Volume2 className="w-3 h-3" strokeWidth={2} />
        <span className="font-medium">{word.word}</span>
      </button>
      {detail ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="音标 / 释义"
          className="h-6 px-1.5 text-caption text-ink-tertiary hover:text-ink-soft"
        >
          {open ? "×" : "?"}
        </button>
      ) : null}
      {open && detail ? (
        <span className="px-1.5 text-caption text-ink-tertiary">{detail}</span>
      ) : null}
    </span>
  )
})

// ---- 词典卡 ----

const DictCard = memo(function DictCard({
  dict,
}: {
  dict: NonNullable<EntityExtensionData["dict"]>
}) {
  return (
    <div className="w-full rounded-lg border border-line-soft bg-paper-2/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-display text-[15px] text-ink">{dict.word}</span>
        {dict.phonetic ? (
          <span className="text-caption text-ink-tertiary">{dict.phonetic}</span>
        ) : null}
      </div>
      {dict.meanings?.length ? (
        <ul className="mt-1 space-y-0.5 text-small text-ink-soft">
          {dict.meanings.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {dict.examples?.length ? (
        <ul className="mt-1 space-y-0.5 text-caption text-ink-tertiary">
          {dict.examples.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
})

// ---- 汇总渲染 ----

/** 渲染一个实体的全部插件扩展；没有扩展时返回 null（不占位） */
export const EntityExtensionsView = memo(function EntityExtensionsView({
  extensions,
  className,
}: {
  extensions?: EntityExtensions | null
  className?: string
}) {
  if (!extensions) return null
  const entries = Object.entries(extensions).filter(
    ([, data]) => data && typeof data === "object",
  )
  if (!entries.length) return null

  return (
    <div className={cn("space-y-2", className)}>
      {entries.map(([pluginId, data]) => {
        const audios = data.audio ?? []
        const words = data.words ?? []
        const dict = data.dict
        if (!audios.length && !words.length && !dict) return null
        return (
          <div
            key={pluginId}
            className="flex flex-wrap items-center gap-2"
            data-plugin={pluginId}
          >
            {audios.map((audio, i) => (
              <AudioButton key={`a${i}`} audio={audio} />
            ))}
            {words.map((word, i) => (
              <WordChip key={`w${i}`} word={word} />
            ))}
            {dict ? <DictCard dict={dict} /> : null}
          </div>
        )
      })}
    </div>
  )
})
