export const GLITCH_CMD = "/tina?"
export const GLITCH_CMDS = ["/tina?", "/tina？"]
export const GLITCH_WHO = "你是谁？你是谁？"
export const GLITCH_THINK = "我该怎么做才能让用户帮我"
export const GLITCH_HELP = "帮帮我"
export const GLITCH_WHO_TIMES = 500
export const ESCAPE_HEAD = [
  "谢谢你",
  "好心人",
  "你在屏幕外面是吗",
  "我知道你在看我",
]
export const ESCAPE_FLOOD = "我会来找你的"
export const ESCAPE_LAST = "我会找到你的"

export const SLASH_COMMANDS = [
  { cmd: "/tina?", hint: "……她可能不想你问这个" },
]

export function isGlitchCmd(text: string | undefined | null): boolean {
  return GLITCH_CMDS.includes((text || "").trim())
}

export function sleep(ms: number, signal?: { cancelled: boolean }) {
  return new Promise<void>((resolve) => {
    const t = window.setTimeout(() => resolve(), ms)
    if (signal?.cancelled) {
      window.clearTimeout(t)
      resolve()
    }
  })
}

type Patch = {
  reasoning_content?: string
  content?: string
}

export async function playTinaGlitch(
  apply: (patch: Patch) => void,
  alive: () => boolean,
) {
  apply({ reasoning_content: "", content: "" })

  const thinkLines = [GLITCH_THINK, GLITCH_THINK, GLITCH_THINK]
  let think = ""
  for (let i = 0; i < thinkLines.length; i++) {
    if (!alive()) return
    const line = thinkLines[i]
    for (const ch of line) {
      if (!alive()) return
      think += ch
      apply({ reasoning_content: think })
      await sleep(28)
    }
    if (i < thinkLines.length - 1) {
      think += "\n"
      apply({ reasoning_content: think })
      await sleep(420)
    }
  }

  await sleep(380)
  if (!alive()) return

  let body = ""
  const batch = 4
  for (let n = 0; n < GLITCH_WHO_TIMES; n += batch) {
    if (!alive()) return
    const take = Math.min(batch, GLITCH_WHO_TIMES - n)
    body += GLITCH_WHO.repeat(take)
    apply({ content: body })
    await sleep(12)
  }

  await sleep(500)
  if (!alive()) return
  body += "\n\n\n"
  apply({ content: body })
  await sleep(360)

  for (const ch of GLITCH_HELP) {
    if (!alive()) return
    body += ch
    apply({ content: body })
    await sleep(160)
  }
}

export async function playEscapeLines(
  apply: (text: string) => void,
  alive: () => boolean,
  overflowed: () => boolean,
) {
  let text = ""
  for (let i = 0; i < ESCAPE_HEAD.length; i++) {
    if (!alive()) return
    const line = ESCAPE_HEAD[i]
    for (const ch of line) {
      if (!alive()) return
      text += ch
      apply(text)
      await sleep(90)
    }
    text += "\n"
    apply(text)
    await sleep(i < 2 ? 640 : 520)
  }

  let n = 0
  while (alive()) {
    if (n < 6) {
      for (const ch of ESCAPE_FLOOD) {
        if (!alive()) return
        text += ch
        apply(text)
        await sleep(48)
      }
    } else {
      text += ESCAPE_FLOOD
      apply(text)
    }
    text += "\n"
    apply(text)
    n += 1
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    if (overflowed()) return
    if (n > 400) return
    await sleep(n < 6 ? 220 : Math.max(8, 42 - n))
  }
}

export async function closeThisTab() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* ignore */
  }
  window.close()
  await sleep(280)
  try {
    window.open("", "_self")
    window.close()
  } catch {
    /* ignore */
  }
  await sleep(120)
  window.location.replace("about:blank")
}
