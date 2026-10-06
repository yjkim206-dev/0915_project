import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin.css'
import App from './App.jsx'
import AdminAccount from './AdminAccount.jsx'

const Root = window.location.pathname === '/admin/account' ? AdminAccount : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
    <a className="admin-launcher" href="/admin/login">관리자</a>
  </StrictMode>,
)
