import PostComposer from './PostComposer.jsx'

export default function PostEdit({ post, onUpdate }) {
  return <PostComposer key={post.id} post={post} onSave={input => onUpdate(post.id, input)} />
}
