import { useState, useEffect } from "react"
import {
  Trophy,
  Loader2,
  Lock,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { achievementsApi } from "@/lib/api"
import type { Achievement } from "@/types"

export function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    achievementsApi
      .list()
      .then((res) => setAchievements(res.achievements || []))
      .catch(() => setAchievements([]))
      .finally(() => setLoading(false))
  }, [])

  const unlockedCount = achievements.filter((a) => a.unlocked).length
  const unlocked = achievements.filter((a) => a.unlocked)
  const locked = achievements.filter((a) => !a.unlocked)

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="成就墙"
        subtitle={`已解锁 ${unlockedCount} / ${achievements.length} 枚徽章，坚持就是胜利`}
      >
        <div className="flex items-center gap-2 text-body text-ink-soft">
          <Trophy className="w-5 h-5 text-amber-500" strokeWidth={2} />
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink-tertiary">
          <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
          <span className="text-body">加载中...</span>
        </div>
      ) : achievements.length === 0 ? (
        <Card className="p-10 text-center text-body text-ink-tertiary">
          成就数据加载失败，请稍后重试
        </Card>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="font-display text-title-s text-ink mb-4">已解锁</h2>
            {unlocked.length === 0 ? (
              <Card className="p-8 text-center text-body text-ink-tertiary">
                还没有解锁成就，去学习、刷题、打卡点亮第一枚徽章吧
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {unlocked.map((a) => (
                  <AchievementCard key={a.id} achievement={a} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-display text-title-s text-ink mb-4">未解锁</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {locked.map((a) => (
                <AchievementCard key={a.id} achievement={a} />
              ))}
            </div>
          </section>
        </div>
      )}
    </AppShell>
  )
}

export function AchievementCard({ achievement }: { achievement: Achievement }) {
  const percent = Math.min(100, Math.round((achievement.progress / Math.max(achievement.target, 1)) * 100))
  const glyph = achievement.icon?.trim() || "🏆"

  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        achievement.unlocked
          ? "bg-surface border-sea/30 shadow-xs"
          : "bg-paper border-line-soft"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-11 h-11 rounded-[4px] flex items-center justify-center shrink-0 text-xl ${
            achievement.unlocked ? "bg-sea-subtle" : "bg-paper-2 grayscale opacity-50"
          }`}
        >
          {achievement.unlocked ? glyph : <Lock className="w-5 h-5 text-ink-disabled" strokeWidth={2} />}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`text-body font-medium truncate ${
              achievement.unlocked ? "text-ink" : "text-ink-soft"
            }`}
          >
            {achievement.name}
          </div>
          <div className="text-caption text-ink-tertiary mt-0.5 leading-snug">
            {achievement.description}
          </div>
        </div>
      </div>

      {!achievement.unlocked && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-caption text-ink-tertiary mb-1">
            <span>
              {achievement.progress} / {achievement.target}
            </span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-sea/60 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
