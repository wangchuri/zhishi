import { Navigate, Route, Routes } from "react-router-dom"
import { TargetedTrainingReportPage } from "@/features/learning/TargetedTrainingReportPage"
import { TargetedTrainingSessionPage } from "@/features/learning/TargetedTrainingSessionPage"

/** 针对训练：从进度页点报告进入，不再单独占侧栏。 */
export function TargetedTrainingPage() {
  return (
    <Routes>
      <Route index element={<Navigate to="/analytics" replace />} />
      <Route path="report/:reportId" element={<TargetedTrainingReportPage />} />
      <Route path="session/:sessionId" element={<TargetedTrainingSessionPage />} />
      <Route path="*" element={<Navigate to="/analytics" replace />} />
    </Routes>
  )
}
