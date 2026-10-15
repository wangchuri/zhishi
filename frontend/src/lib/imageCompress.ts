/**
 * 上传前压缩图片。
 *
 * 手机随手一张照片 3–5MB，原样上传又慢又费流量；压到长边 ≤1600px 的 JPEG
 * 通常 <1MB，对"拍作业/拍题"这类用途肉眼几乎无差。
 *
 * 任何一步失败（HEIC 解码不了、canvas 不可用、压完反而更大）都**原样返回**，
 * 保证上传永远不因为压缩而失败。
 */
export interface CompressImageOptions {
  /** 长边上限（px） */
  maxEdge?: number
  /** JPEG 质量 0–1 */
  quality?: number
  /** 小于这个字节数就跳过压缩 */
  skipUnderBytes?: number
}

const DEFAULTS: Required<CompressImageOptions> = {
  maxEdge: 1600,
  quality: 0.82,
  skipUnderBytes: 500 * 1024,
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  const w = (src as ImageBitmap).width || (src as HTMLImageElement).naturalWidth || 0
  const h = (src as ImageBitmap).height || (src as HTMLImageElement).naturalHeight || 0
  return { w, h }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      /* 有些浏览器对 HEIC/异常文件会抛，退回 <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("decode failed"))
      el.src = url
    })
  } finally {
    // 注意：<img> 已加载完成，可以安全释放
    URL.revokeObjectURL(url)
  }
}

export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const { maxEdge, quality, skipUnderBytes } = { ...DEFAULTS, ...options }
  if (!file.type.startsWith("image/")) return file
  if (file.size <= skipUnderBytes) return file

  let src: ImageBitmap | HTMLImageElement
  try {
    src = await loadBitmap(file)
  } catch {
    return file
  }

  const { w, h } = sizeOf(src)
  if (!w || !h) return file

  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  try {
    const canvas = document.createElement("canvas")
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    // 白底：透明 PNG 转 JPEG 否则会变黑
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, tw, th)
    ctx.drawImage(src as CanvasImageSource, 0, 0, tw, th)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    )
    if (!blob || blob.size >= file.size) return file
    const name = `${file.name.replace(/\.[^.]+$/, "") || "image"}.jpg`
    return new File([blob], name, { type: "image/jpeg" })
  } catch {
    return file
  } finally {
    if (typeof (src as ImageBitmap).close === "function") (src as ImageBitmap).close()
  }
}
