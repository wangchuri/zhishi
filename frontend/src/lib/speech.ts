/**
 * 浏览器 TTS（Web Speech API）。
 *
 * 插件扩展槽里的发音按钮走这里：插件只给 `{text, lang}`，不依赖任何后端服务，
 * 离线可用。以后接真人录音或云端 TTS 时，插件把 `audio.src` 填上，
 * `AudioButton` 会自动优先用它，不用改这里。
 */

let activeUtterance: SpeechSynthesisUtterance | null = null

/** 当前环境是否支持朗读（jsdom / 老浏览器为 false） */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

/** 停掉当前朗读 */
export function stopSpeaking(): void {
  if (!canSpeak()) return
  window.speechSynthesis.cancel()
  activeUtterance = null
}

/**
 * 朗读一段文本。返回是否成功开始（不支持 / 空文本时返回 false）。
 *
 * 同一时刻只念一个：开始前会先 cancel 掉上一段，避免叠音。
 */
export function speakText(text: string, lang = "en-US", onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false
  stopSpeaking()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.95
  utterance.onend = () => {
    if (activeUtterance === utterance) activeUtterance = null
    onEnd?.()
  }
  utterance.onerror = () => {
    if (activeUtterance === utterance) activeUtterance = null
    onEnd?.()
  }
  activeUtterance = utterance
  window.speechSynthesis.speak(utterance)
  return true
}
