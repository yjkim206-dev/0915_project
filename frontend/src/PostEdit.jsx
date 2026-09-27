import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function PostEdit({ post, onUpdate }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(post.title)
  const [content, setContent] = useState(post.content)
  const [category, setCategory] = useState(post.category || '자유')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      await onUpdate(post.id, { title, content, category })
      navigate(`/board/${post.id}`)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return <div className="container narrow">
    <Link to={`/board/${post.id}`} className="back">← 게시글로 돌아가기</Link>
    <Title eyebrow="COMMUNITY" title="게시글 수정" />
    <form className="editor" onSubmit={submit}>
      <label>카테고리<select value={category} onChange={(event) => setCategory(event.target.value)}><option>자유</option><option>개발</option><option>모임</option></select></label>
      <label>제목<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>내용<textarea required rows="10" value={content} onChange={(event) => setContent(event.target.value)} /></label>
      {error && <p className="profile-message">{error}</p>}
      <div className="form-actions"><Link to={`/board/${post.id}`} className="outline">취소</Link><button className="button">수정사항 저장</button></div>
    </form>
  </div>
}

function Title({ eyebrow, title }) { return <div className="title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div> }
