import { useEffect, useState } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import { isServerConfigured } from "@/lib/api"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { OnboardingPage } from "@/features/onboarding/OnboardingPage"
import { ChatPage } from "@/features/chat/ChatPage"
import { NotesPage } from "@/features/notes/NotesPage"
import { NoteDetailPage } from "@/features/notes/NoteDetailPage"
import { DocumentViewPage } from "@/features/knowledge-base/DocumentViewPage"
import { UploadPage } from "@/features/knowledge-base/UploadPage"
import { LearningAnalyticsPage } from "@/features/learning/LearningAnalyticsPage"
import { TargetedTrainingPage } from "@/features/learning/TargetedTrainingPage"
import { ProfilePage } from "@/features/profile/ProfilePage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { ServerSetupPage } from "@/features/setup/ServerSetupPage"
import { QuizBookListPage } from "@/features/quiz/QuizBookListPage"
import { QuizDocDetailPage } from "@/features/quiz/QuizDocDetailPage"
import { QuizOngoingPage } from "@/features/quiz/QuizOngoingPage"
import { QuizPage } from "@/features/quiz/QuizPage"
import { QuestionGenDocPage } from "@/features/question-gen/QuestionGenDocPage"
import { CompanionReadPage } from "@/features/companion/CompanionReadPage"
import { DocParsePage } from "@/features/doc-parse/DocParsePage"
import { TasksPage } from "@/features/tasks/TasksPage"

function RequireServer({ children }: { children: React.ReactElement }) {
  const { checkServer } = useAuth()
  const [status, setStatus] = useState<"checking" | "ok" | "fail">("checking")

  useEffect(() => {
    let cancelled = false
    checkServer().then((ok) => {
      if (cancelled) return
      setStatus(ok ? "ok" : "fail")
    })
    return () => {
      cancelled = true
    }
  }, [checkServer])

  if (!isServerConfigured()) return <Navigate to="/setup" replace />
  if (status === "checking") {
    return <div className="h-full flex items-center justify-center bg-ink"><div className="text-body text-mist">正在检测服务器连接...</div></div>
  }
  if (status === "fail") {
    return (
      <div className="h-full flex items-center justify-center bg-ink">
        <div className="text-center px-6">
          <div className="text-body text-mist mb-4">无法连接服务器</div>
          <a href="/setup" onClick={(e) => { e.preventDefault(); window.location.href = "/setup" }} className="text-sea underline">重新配置服务器地址</a>
        </div>
      </div>
    )
  }
  return children
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<ServerSetupPage />} />
      <Route path="/onboarding" element={<RequireServer><OnboardingPage /></RequireServer>} />
      <Route path="/" element={<RequireServer><DashboardPage /></RequireServer>} />
      <Route path="/chat" element={<RequireServer><ChatPage /></RequireServer>} />
      <Route path="/notes" element={<RequireServer><NotesPage /></RequireServer>} />
      <Route path="/notes/:noteId" element={<RequireServer><NoteDetailPage /></RequireServer>} />
      <Route path="/knowledge" element={<Navigate to="/quiz" replace />} />
      <Route path="/knowledge/doc/:docId" element={<RequireServer><DocumentViewPage /></RequireServer>} />
      <Route path="/knowledge/upload" element={<RequireServer><UploadPage /></RequireServer>} />
      <Route path="/tasks" element={<RequireServer><TasksPage /></RequireServer>} />
      <Route path="/analytics" element={<RequireServer><LearningAnalyticsPage /></RequireServer>} />
      <Route path="/training/targeted/*" element={<RequireServer><TargetedTrainingPage /></RequireServer>} />
      <Route path="/achievements" element={<Navigate to="/analytics" replace />} />
      <Route path="/plans" element={<Navigate to="/" replace />} />
      <Route path="/profile" element={<RequireServer><ProfilePage /></RequireServer>} />
      <Route path="/settings" element={<RequireServer><SettingsPage /></RequireServer>} />
      <Route path="/quiz" element={<RequireServer><QuizBookListPage /></RequireServer>} />
      <Route path="/quiz/ongoing" element={<RequireServer><QuizOngoingPage /></RequireServer>} />
      <Route path="/quiz/doc/:docId" element={<RequireServer><QuizDocDetailPage /></RequireServer>} />
      <Route path="/quiz/session" element={<RequireServer><QuizPage /></RequireServer>} />
      <Route path="/question-gen" element={<Navigate to="/quiz" replace />} />
      <Route path="/question-gen/doc/:documentId" element={<RequireServer><QuestionGenDocPage /></RequireServer>} />
      <Route path="/companion" element={<Navigate to="/quiz" replace />} />
      <Route path="/companion/doc/:docId" element={<RequireServer><CompanionReadPage /></RequireServer>} />
      <Route path="/doc-parse" element={<RequireServer><DocParsePage /></RequireServer>} />
      <Route path="/settings/diagnostics" element={<Navigate to="/settings" replace />} />
      <Route path="*" element={<Navigate to={isServerConfigured() ? "/" : "/setup"} replace />} />
    </Routes>
  )
}