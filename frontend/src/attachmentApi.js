import { authStorage } from './authStorage.js'
export const attachmentHeaders = () => ({ Authorization: `Bearer ${authStorage.getItem('token')}`, 'Content-Type': 'application/json' })
export const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
