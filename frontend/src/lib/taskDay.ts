/** 任务日：本地每天 04:00 换日（与后端 task.py 一致）。0–4 点仍算前一天。 */

const TASK_DAY_HOUR = 4

function formatYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** 当前（或指定时刻）所属的任务日 YYYY-MM-DD */
export function taskDayISO(d = new Date()): string {
  const shifted = new Date(d.getTime() - TASK_DAY_HOUR * 60 * 60 * 1000)
  return formatYMD(shifted)
}

/** 任务日的前一天 */
export function previousTaskDayISO(d = new Date()): string {
  const parts = taskDayISO(d).split("-").map(Number)
  const day = new Date(parts[0], parts[1] - 1, parts[2])
  day.setDate(day.getDate() - 1)
  return formatYMD(day)
}
