import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useWarehouse } from './store/warehouseStore.ts'

if (import.meta.env.DEV) {
  // Development hook for end-to-end checks (select an object, read state). Stripped from builds.
  Object.assign(window, { __waretrack: useWarehouse })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
