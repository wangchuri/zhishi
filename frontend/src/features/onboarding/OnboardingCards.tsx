import { ArrowRight, Loader2, UploadCloud } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

export type OnboardingCardItem = {
  type: string
  goal?: string
  fileName?: string
}

export function OnboardingGoalCard({
  goal,
  locked,
  busy,
  onConfirm,
  onChange,
}: {
  goal: string
  locked?: boolean
  busy?: boolean
  onConfirm?: () => void
  onChange?: () => void
}) {
  return (
    <div className="mt-3 bg-paper-2 border border-line border-l-[3px] border-l-sea rounded-2xl px-[18px] py-4">
      <div className="text-[10px] font-semibold tracking-wide text-sea mb-2">Tina 调用工具 · 确认学习目标</div>
      <h4 className="text-body font-semibold mb-1">是这个目标吗？</h4>
      <p className="text-body leading-relaxed mb-3">{goal}</p>
      <p className="text-[11px] text-ink-disabled mb-4">确认后我会按这个方向帮你排练习。这句话已经写入数据库。</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={locked || busy}
          onClick={onConfirm}
          className="h-8 px-3 rounded-full bg-sea text-white text-caption disabled:opacity-40"
        >
          确认，就是这个
        </button>
        <button
          type="button"
          disabled={locked || busy}
          onClick={onChange}
          className="h-8 px-3 rounded-full border border-line bg-paper text-caption text-ink-soft disabled:opacity-40"
        >
          还想改一下
        </button>
      </div>
    </div>
  )
}

export function OnboardingDocsCard({
  locked,
  busy,
  uploading,
  fileName,
  onPick,
  onSkip,
}: {
  locked?: boolean
  busy?: boolean
  uploading?: boolean
  fileName?: string
  onPick?: () => void
  onSkip?: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className="mt-3 bg-paper-2 border border-line border-l-[3px] border-l-sea rounded-2xl px-[18px] py-4">
      <div className="text-[10px] font-semibold tracking-wide text-sea mb-2">Tina 调用工具 · 添加资料</div>
      <h4 className="text-body font-semibold mb-1">你有学习使用的资料吗？</h4>
      <p className="text-[11px] text-ink-disabled mb-3">可以在这里上传，或去资料页添加。</p>
      <div
        className={cn(
          "rounded-[14px] border-[1.5px] border-dashed border-line bg-paper px-3.5 py-[18px] text-center transition-colors",
          locked ? "cursor-default border-solid border-sea/45 bg-sea-subtle" : "cursor-pointer hover:border-sea hover:bg-sea-subtle",
        )}
        onClick={() => {
          if (locked || busy) return
          if (onPick) onPick()
          else navigate("/knowledge/upload")
        }}
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 mx-auto mb-2 text-sea animate-spin" />
        ) : (
          <UploadCloud className="w-5 h-5 mx-auto mb-2 text-sea" />
        )}
        <p className="text-body font-medium mb-0.5">
          {fileName || (uploading ? "正在上传…" : "点这里上传，或去资料页")}
        </p>
      </div>
      <button
        type="button"
        disabled={locked || busy || uploading}
        onClick={onSkip}
        className="mt-3 h-8 px-3 rounded-full border border-line bg-paper text-caption text-ink-soft disabled:opacity-40"
      >
        先跳过
      </button>
    </div>
  )
}

export function OnboardingDoneCard({ onHome }: { onHome?: () => void }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => (onHome ? onHome() : navigate("/"))}
      className="mt-3 inline-flex h-8 px-4 rounded-full bg-sea text-white text-caption items-center w-fit"
    >
      去首页
      <ArrowRight className="w-3.5 h-3.5 ml-1" />
    </button>
  )
}
