import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from './App'
import './index.css'

// ponytail: <React.StrictMode> dev double-mounts useEffects (theme shift, watchers).
// Acceptable for Epic D â catches missing cleanup. In prod builds StrictMode is a no-op.
const el = document.getElementById('app')
if (!el) throw new Error('No #app mount point in index.html')
createRoot(el).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
