import { Link } from 'react-router-dom'
import { MyInquiries, MyReports } from './Support.jsx'

export function InquiryHistoryPage() { return <div className="container narrow support-history-page"><Link to="/profile" className="back">← 프로필로 돌아가기</Link><div className="title"><p className="eyebrow">SUPPORT</p><h1>문의 상세 내역</h1><p>작성한 문의와 관리자 답변을 확인하세요.</p></div><div className="support-history-actions"><Link to="/inquiry" className="button">새 문의 작성</Link><Link to="/profile/reports" className="outline">신고 내역 보기</Link></div><MyInquiries /></div> }
export function ReportHistoryPage() { return <div className="container narrow support-history-page"><Link to="/profile" className="back">← 프로필로 돌아가기</Link><div className="title"><p className="eyebrow">SUPPORT</p><h1>신고 상세 내역</h1><p>작성한 신고의 처리 상태와 내용을 확인하세요.</p></div><div className="support-history-actions"><Link to="/profile/inquiries" className="outline">문의 내역 보기</Link></div><MyReports /></div> }
