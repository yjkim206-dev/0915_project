import { Link } from 'react-router-dom'
import { DESCRIPTION, FAQS } from '../seo/site.mjs'

export default function AboutPage() {
  return <div className="container narrow"><div className="title"><p className="eyebrow">ABOUT MOA</p><h1>모아 소개</h1><p>{DESCRIPTION}</p></div><section className="detail"><h2>연결하고, 나누고, 함께 성장해요</h2><p>모아에서는 관심사가 비슷한 사람들과 게시글과 댓글로 이야기를 나눌 수 있습니다. 공지사항에서 서비스 소식을 확인하고, 상점에서 멤버십과 크레딧을 살펴보세요.</p><h2>자주 묻는 질문</h2>{FAQS.map(([question,answer]) => <section key={question}><h3>{question}</h3><p>{answer}</p></section>)}<nav aria-label="서비스 바로가기"><Link to="/board">게시판 둘러보기</Link> · <Link to="/notices">공지사항</Link> · <Link to="/shop">상점</Link></nav></section></div>
}
