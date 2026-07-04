import { BrowserRouter } from "react-router-dom"
import { UIProvider } from "@/context/UIContext"
import { AuthProvider } from "@/context/AuthContext"
import { AppRoutes } from "@/routes"

function App() {
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
        </BrowserRouter>
      </AuthProvider>
    </UIProvider>
  )
}

export default App
