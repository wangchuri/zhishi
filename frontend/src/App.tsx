import { BrowserRouter } from "react-router-dom"
import { UIProvider } from "@/context/UIContext"
import { AuthProvider } from "@/context/AuthContext"
import { AppRoutes } from "@/routes"
import { Toaster } from "@/components/ui/sonner"
import { FullscreenSuggestion } from "@/components/blocks/FullscreenSuggestion"
import { useActiveTime } from "@/hooks/useActiveTime"

function App() {
  useActiveTime()

  return (
    <UIProvider>
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AppRoutes />
          <FullscreenSuggestion />
          <Toaster richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </UIProvider>
  )
}

export default App
