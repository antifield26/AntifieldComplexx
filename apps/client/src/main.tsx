import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './App'
import './styles/tokens.css'
import './styles/global.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/v02.css'
import './styles/v03.css'
import './styles/v04.css'
import './styles/v05.css'
import './styles/v06.css'
import './styles/v07.css'
import './styles/v08.css'
import './styles/v121.css'
import './styles/client-interactions.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载节点')

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter([{ path: '*', element: <App /> }])} />
  </StrictMode>,
)
