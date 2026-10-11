import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin.css'
import App from './App.jsx'
import AdminAccount from './AdminAccount.jsx'
import FooterLegalModal from './FooterLegalModal.jsx'

const Root = window.location.pathname === '/admin/account' ? AdminAccount : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
    <FooterLegalModal />
  </StrictMode>,
)
