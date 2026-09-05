import { TooltipProvider } from './components/ui/tooltip'
import { RouterProvider } from './router'
import router from './router'

// ponytail: SP §7 step 5 — App is the RouterProvider host. TooltipProvider wraps the routes
// so Radix tooltips work app-wide. NavBridge (imperative navigate() for vanilla views) lives
// inside Shell.tsx so useNavigate() has the router context it needs.
export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}
