import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Plug, Puzzle, RefreshCw, Server, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { systemApi, type PluginsStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * 插件页：内置领域插件（可开关）+ 外部 MCP server（只读状态）。
 *
 * 插件的配置存在服务器 `config.yml` 的 `plugins` 段，这里改的是那份文件；
 * 开关会立即重载（不用重启后端）。
 */
export function PluginsPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<PluginsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await systemApi.getPlugins())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载插件状态失败")
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (pluginId: string, enabled: boolean) => {
    setBusy(pluginId)
    try {
      setStatus(await systemApi.setPluginEnabled(pluginId, enabled))
      toast.success(enabled ? "插件已启用" : "插件已停用")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换失败")
    } finally {
      setBusy(null)
    }
  }

  const reload = async () => {
    setBusy("*")
    try {
      setStatus(await systemApi.reloadPlugins())
      toast.success("已重新加载")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重载失败")
    } finally {
      setBusy(null)
    }
  }

  const builtin = status?.builtin ?? []
  const mcp = status?.mcp
  const errors = status?.errors ?? []

  return (
    <AppShell maxWidth={720}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="inline-flex items-center gap-1 text-caption text-ink-soft hover:text-sea"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
          返回设置
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reload()}
          disabled={busy === "*"}
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5 mr-1", busy === "*" && "animate-spin")}
            strokeWidth={2}
          />
          重新加载
        </Button>
      </div>

      <PageHeader
        title="插件"
        subtitle="按领域扩展 Tina 的能力：发音、词典、判题器、复习算法……"
      />

      <div className="space-y-5">
        {/* 内置插件 */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
              <Puzzle className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1">
              <h3 className="text-card-title font-semibold text-ink">内置插件</h3>
              <p className="text-caption text-ink-tertiary">
                跑在本机后端里，能读你自己的资料和题库
              </p>
            </div>
          </div>

          <div className="divide-y divide-line-light">
            {loading ? (
              <div className="px-5 py-6 text-small text-ink-tertiary">加载中…</div>
            ) : builtin.length === 0 ? (
              <div className="px-5 py-6 text-small text-ink-tertiary">没有内置插件</div>
            ) : (
              builtin.map((plugin) => (
                <div key={plugin.plugin_id} className="px-5 py-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-body font-medium text-ink">{plugin.name}</span>
                      <Badge variant={plugin.enabled ? "primary" : "neutral"} size="sm">
                        {plugin.enabled ? "已启用" : "已停用"}
                      </Badge>
                      {plugin.routes.length > 0 ? (
                        <span className="text-caption text-ink-tertiary">
                          {plugin.routes.length} 个接口
                        </span>
                      ) : null}
                      {plugin.tools.length > 0 ? (
                        <span className="text-caption text-ink-tertiary">
                          {plugin.tools.length} 个工具
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-small text-ink-soft">{plugin.description}</p>
                    {plugin.enabled && plugin.tools.length > 0 ? (
                      <p className="mt-1 text-caption text-ink-disabled break-all">
                        工具：{plugin.tools.join("、")}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={plugin.enabled ?? false}
                    disabled={busy !== null}
                    onCheckedChange={(next) => void toggle(plugin.plugin_id, next)}
                    aria-label={`${plugin.name} 开关`}
                  />
                </div>
              ))
            )}
          </div>
        </Card>

        {/* MCP */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-ink-tertiary/10 text-ink-soft flex items-center justify-center">
              <Server className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1">
              <h3 className="text-card-title font-semibold text-ink">MCP 服务</h3>
              <p className="text-caption text-ink-tertiary">
                外部工具服务，在服务器 config.yml 的 plugins.mcp_servers 里配置
              </p>
            </div>
            <Badge variant={mcp?.connected ? "primary" : "neutral"} size="sm">
              {mcp?.connected ? "已连接" : mcp?.configured ? "未连上" : "未配置"}
            </Badge>
          </div>
          <div className="px-5 py-4">
            {mcp?.servers?.length ? (
              <div className="space-y-2">
                {mcp.servers.map((server) => (
                  <div key={server.server_id} className="text-small text-ink-soft">
                    <span className="font-medium text-ink">{server.server_id}</span>
                    <span className="text-ink-tertiary">
                      {" · "}
                      {server.tools.length} 个工具
                    </span>
                    <div className="mt-0.5 text-caption text-ink-disabled break-all">
                      {server.tools.join("、")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-small text-ink-tertiary">
                还没有接 MCP 服务。想接 Notion / Obsidian / 学校教务这类外部服务时，
                在服务器上编辑 config.yml 的 <code className="px-1 rounded bg-surface-soft">plugins.mcp_servers</code>，
                然后点右上角「重新加载」。
              </p>
            )}
          </div>
        </Card>

        {/* 错误 */}
        {errors.length > 0 ? (
          <Card className="overflow-hidden border-danger/30">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-danger/20 bg-danger-soft/40">
              <TriangleAlert className="w-4 h-4 text-danger" strokeWidth={2} />
              <h3 className="text-card-title font-semibold text-danger">加载问题</h3>
            </div>
            <ul className="px-5 py-4 space-y-1.5">
              {errors.map((item, i) => (
                <li key={i} className="text-small text-danger break-all">
                  {item.plugin_id || item.server_id || "*"}：{item.error}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="text-caption text-ink-disabled flex items-center gap-1.5">
          <Plug className="w-3.5 h-3.5" strokeWidth={2} />
          插件的配置存在服务器的 config.yml 里，改完点「重新加载」即刻生效。
        </p>
      </div>
    </AppShell>
  )
}
