import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const configuredAdminName = Deno.env.get('ADMIN_NAME')?.trim() || ''
const configuredAdminEmail = Deno.env.get('ADMIN_EMAIL')?.trim().toLowerCase() || ''
const configuredAdminPassword = Deno.env.get('ADMIN_PASSWORD') || ''
const db = createClient(supabaseUrl, serviceRoleKey)
const auth = createClient(supabaseUrl, anonKey)

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const error = (message: string, status = 400) => json({ message }, status)
const bearer = (request: Request) => request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
const bodyOf = async (request: Request) => { try { return await request.json() } catch { return {} } }

async function currentUser(request: Request): Promise<User | null> {
  const token = bearer(request)
  if (!token) return null
  const { data } = await db.auth.getUser(token)
  return data.user || null
}

async function requiredUser(request: Request) {
  const user = await currentUser(request)
  if (!user) throw new Response(JSON.stringify({ message: '로그인이 필요합니다.' }), { status: 401, headers })
  return user
}

async function ensureUser(user: User) {
  const { error: userError } = await db.from('users').upsert({ id: user.id, email: user.email || '', updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (userError) throw userError
}

async function ensureProfile(user: User, name?: string) {
  await ensureUser(user)
  const profile = { id: user.id, name: name?.trim() || user.user_metadata?.name || user.email?.split('@')[0] || '회원', email: user.email || '', bio: '', profile_image: '' }
  const { data, error: profileError } = await db.from('profiles').upsert(profile, { onConflict: 'id', ignoreDuplicates: true }).select().maybeSingle()
  if (profileError) throw profileError
  if (data) {
    const { data: admin } = await db.from('admins').select('id').eq('id', user.id).maybeSingle()
    if (admin) data.role = 'admin'
    return data
  }
  const { data: existing, error: readError } = await db.from('profiles').select('*').eq('id', user.id).single()
  if (readError) throw readError
  const { data: admin } = await db.from('admins').select('id').eq('id', user.id).maybeSingle()
  if (admin) existing.role = 'admin'
  return existing
}

async function adminUser(request: Request) {
  const user = await requiredUser(request)
  await ensureProfile(user)
  const { data, error: profileError } = await db.from('profiles').select('*').eq('id', user.id).single()
  const { data: admin } = await db.from('admins').select('id').eq('id', user.id).maybeSingle()
  if (admin && data) data.role = 'admin'
  if (profileError || data?.role !== 'admin') throw new Response(JSON.stringify({ message: '관리자 권한이 필요합니다.' }), { status: 403, headers })
  return { user, profile: data }
}

async function provisionConfiguredAdmin() {
  if (!configuredAdminEmail || !configuredAdminPassword) return
  const { data: listed, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw listError
  let user = listed.users.find((item) => item.email?.toLowerCase() === configuredAdminEmail)
  if (!user) {
    const { data, error: createError } = await db.auth.admin.createUser({ email: configuredAdminEmail, password: configuredAdminPassword, email_confirm: true, user_metadata: { name: configuredAdminName || '관리자' } })
    if (createError || !data.user) throw createError || new Error('관리자 계정을 만들지 못했습니다.')
    user = data.user
  } else {
    const { error: updateError } = await db.auth.admin.updateUserById(user.id, { password: configuredAdminPassword, email_confirm: true, user_metadata: { name: configuredAdminName || '관리자' } })
    if (updateError) throw updateError
  }
  await ensureProfile(user, configuredAdminName || undefined)
  const { error: roleError } = await db.from('profiles').update({ role: 'admin', name: configuredAdminName || undefined }).eq('id', user.id)
  if (roleError) throw roleError
}

function postPayload(post: any) { return { ...post, is_hidden: Boolean(post.is_hidden), author: post.author || '알 수 없음', category: post.category || '자유' } }

async function listPosts(admin = false) {
  let query = db.from('post_list').select('*').order('created_at', { ascending: false })
  if (!admin) query = query.eq('is_hidden', false)
  const { data, error: readError } = await query
  if (readError) throw readError
  return (data || []).map(postPayload)
}

async function handleAuth(path: string, request: Request) {
  const input = await bodyOf(request)
  if (path === '/auth/signup') {
    const email = String(input.email || '').trim().toLowerCase()
    const password = String(input.password || '')
    const name = String(input.name || '').trim()
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return error('이름, 올바른 이메일, 8자 이상의 비밀번호를 입력해주세요.')
    // Supabase Auth owns account creation, so the account is visible in
    // Dashboard > Authentication > Users and database triggers can synchronize it.
    const { data: created, error: createError } = await auth.auth.signUp({ email, password, options: { data: { name } } })
    if (createError || !created.user) return error(createError?.message || '회원가입에 실패했습니다.', createError?.status || 409)
    await ensureProfile(created.user, name)
    if (!created.session) return error('Email confirmation is required before logging in.', 403)
    const { data: signed, error: signError } = await auth.auth.signInWithPassword({ email, password })
    if (signError || !signed.session) return error(signError?.message || '로그인 세션을 만들지 못했습니다.', 401)
    return json({ token: signed.session.access_token, user: { id: created.user.id, name, email } }, 201)
  }
  const email = String(input.email || '').trim().toLowerCase()
  const { data, error: signError } = await auth.auth.signInWithPassword({ email, password: String(input.password || '') })
  if (signError || !data.user || !data.session) return error('이메일 또는 비밀번호가 올바르지 않습니다.', 401)
  const profile = await ensureProfile(data.user)
  const { data: admin } = await db.from('admins').select('id').eq('id', data.user.id).maybeSingle()
  if (admin) profile.role = 'admin'
  return json({ token: data.session.access_token, user: { id: data.user.id, name: profile.name, email: data.user.email } })
}

async function handleAdminLogin(request: Request) {
  await provisionConfiguredAdmin()
  const input = await bodyOf(request)
  const email = String(input.email || '').trim().toLowerCase()
  const { data, error: signError } = await auth.auth.signInWithPassword({ email, password: String(input.password || '') })
  if (signError || !data.user || !data.session) return error('관리자 이메일 또는 비밀번호가 올바르지 않습니다.', 401)
  const profile = await ensureProfile(data.user)
  if (profile.role !== 'admin') return error('관리자 권한이 필요합니다.', 403)
  return json({ message: '관리자 로그인 성공', token: data.session.access_token, isAdmin: true, account: { id: profile.id, name: profile.name, email: profile.email } })
}

async function handleProfile(path: string, request: Request) {
  const user = await requiredUser(request)
  if (path === '/profile' && request.method === 'GET') {
    const profile = await ensureProfile(user)
    const { data: posts, error: postsError } = await db.from('posts').select('id,title,content,author_id,views,category,created_at,is_hidden').eq('author_id', user.id).order('created_at', { ascending: false })
    if (postsError) return error(postsError.message, 500)
    const { count: postCount } = await db.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id)
    const { data: topics } = await db.from('posts').select('category').eq('author_id', user.id)
    return json({ ...profile, post_count: postCount || 0, topic_count: new Set((topics || []).map((item) => item.category)).size, posts: posts || [] })
  }
  const input = await bodyOf(request)
  if (input.newPassword !== undefined) {
    const currentPassword = String(input.currentPassword || '')
    const newPassword = String(input.newPassword || '')
    if (!currentPassword || newPassword.length < 8) return error('현재 비밀번호와 8자 이상의 새 비밀번호를 입력해주세요.')
    const checked = await auth.auth.signInWithPassword({ email: user.email || '', password: currentPassword })
    if (checked.error) return error('현재 비밀번호가 올바르지 않습니다.', 401)
    const { error: passwordError } = await db.auth.admin.updateUserById(user.id, { password: newPassword })
    if (passwordError) return error(passwordError.message, 400)
    return json({ message: '비밀번호가 변경되었습니다.' })
  }
  const name = String(input.name || '').trim()
  if (!name) return error('이름을 입력해주세요.')
  const { data, error: updateError } = await db.from('profiles').update({ name, bio: String(input.bio || '').trim(), profile_image: String(input.profileImage || '') }).eq('id', user.id).select().single()
  if (updateError) return error(updateError.message, 500)
  return json(data)
}

async function handlePosts(path: string, method: string, request: Request) {
  if (path === '/posts' && method === 'GET') return json(await listPosts())
  const match = path.match(/^\/posts\/(\d+)$/)
  if (path === '/posts' && method === 'POST') {
    const user = await requiredUser(request); const input = await bodyOf(request); const title = String(input.title || '').trim(); const content = String(input.content || '').trim()
    if (!title || !content) return error('제목과 내용을 입력해주세요.')
    const { data, error: insertError } = await db.from('posts').insert({ title, content, category: String(input.category || '자유').trim() || '자유', author_id: user.id }).select('*, profiles:author_id(name)').single()
    if (insertError) return error(insertError.message, 500)
    return json({ ...data, author: data.profiles?.name || user.user_metadata?.name || '알 수 없음', likes: 0, dislikes: 0 }, 201)
  }
  if (!match) return null
  const id = Number(match[1])
  if (method === 'GET') {
    const user = await currentUser(request)
    let query = db.from('post_list').select('*').eq('id', id)
    if (user) query = query.or(`is_hidden.eq.false,author_id.eq.${user.id}`)
    else query = query.eq('is_hidden', false)
    const { data, error: readError } = await query.maybeSingle()
    if (readError) return error(readError.message, 500)
    if (!data) return error('게시글을 찾을 수 없습니다.', 404)
    return json(postPayload(data))
  }
  if (method === 'PUT') {
    const user = await requiredUser(request); const input = await bodyOf(request); const { data: post } = await db.from('posts').select('author_id').eq('id', id).single()
    if (!post) return error('게시글을 찾을 수 없습니다.', 404); if (post.author_id !== user.id) return error('작성자만 게시글을 수정할 수 있습니다.', 403)
    const { data, error: updateError } = await db.from('posts').update({ title: String(input.title || '').trim(), content: String(input.content || '').trim(), category: String(input.category || '자유').trim() || '자유' }).eq('id', id).select().single()
    if (updateError) return error(updateError.message, 500); return json(data)
  }
  if (method === 'DELETE') {
    const user = await requiredUser(request); const { data: post } = await db.from('posts').select('author_id').eq('id', id).single()
    if (!post) return error('게시글을 찾을 수 없습니다.', 404); if (post.author_id !== user.id) return error('작성자만 게시글을 삭제할 수 있습니다.', 403)
    const { error: deleteError } = await db.from('posts').delete().eq('id', id); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers })
  }
  return null
}

async function handleView(id: number, request: Request) {
  const user = await requiredUser(request)
  const { data: post } = await db.from('posts').select('views,is_hidden').eq('id', id).single()
  if (!post || post.is_hidden) return error('게시글을 찾을 수 없습니다.', 404)
  const { data: view } = await db.from('post_views').select('created_at').eq('post_id', id).eq('user_id', user.id).maybeSingle()
  const recent = view && Date.now() - new Date(view.created_at).getTime() < 24 * 60 * 60 * 1000
  if (!recent) {
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null
    const { error: saveError } = await db.from('post_views').upsert({ post_id: id, user_id: user.id, ip_address: ipAddress, created_at: new Date().toISOString() }, { onConflict: 'post_id,user_id' })
    if (saveError) return error(saveError.message, 500)
    const { data: updated, error: updateError } = await db.from('posts').update({ views: (post.views || 0) + 1 }).eq('id', id).select('views').single()
    if (updateError) return error(updateError.message, 500)
    return json({ views: updated.views, counted: true })
  }
  return json({ views: post.views, counted: false })
}

async function handleReactions(id: number, method: string, request: Request) {
  if (method === 'GET') {
    const { data, error: readError } = await db.from('post_reactions').select('reaction,user_id').eq('post_id', id); if (readError) return error(readError.message, 500)
    const user = await currentUser(request); const rows = data || []; return json({ likes: rows.filter((row) => row.reaction === 'like').length, dislikes: rows.filter((row) => row.reaction === 'dislike').length, reaction: user ? rows.find((row) => row.user_id === user.id)?.reaction || null : null })
  }
  const user = await requiredUser(request); const input = await bodyOf(request); const next = input.reaction === 'like' || input.reaction === 'dislike' ? input.reaction : null; if (!next) return error('좋아요 또는 싫어요만 선택할 수 있습니다.')
  const { data: existing } = await db.from('post_reactions').select('reaction').eq('post_id', id).eq('user_id', user.id).maybeSingle()
  if (existing?.reaction === next) await db.from('post_reactions').delete().eq('post_id', id).eq('user_id', user.id); else await db.from('post_reactions').upsert({ post_id: id, user_id: user.id, reaction: next }, { onConflict: 'post_id,user_id' })
  return handleReactions(id, 'GET', request)
}

async function handleComments(path: string, method: string, request: Request) {
  const postMatch = path.match(/^\/posts\/(\d+)\/comments$/); const commentMatch = path.match(/^\/comments\/(\d+)$/)
  if (postMatch && method === 'GET') { const { data, error: readError } = await db.from('comments').select('id,post_id,content,created_at,author_id,profiles:author_id(name)').eq('post_id', Number(postMatch[1])).eq('is_hidden', false).order('created_at', { ascending: true }); if (readError) return error(readError.message, 500); return json((data || []).map((item: any) => ({ ...item, author: item.profiles?.name || '알 수 없음' }))) }
  if (postMatch && method === 'POST') { const user = await requiredUser(request); const input = await bodyOf(request); const content = String(input.content || '').trim(); if (!content || content.length > 500) return error('댓글은 1자 이상 500자 이하로 작성해주세요.'); const { data, error: insertError } = await db.from('comments').insert({ post_id: Number(postMatch[1]), author_id: user.id, content }).select('id,post_id,content,created_at,author_id,profiles:author_id(name)').single(); if (insertError) return error(insertError.message, 500); return json({ ...data, author: data.profiles?.name || '알 수 없음' }, 201) }
  if (!commentMatch) return null
  const id = Number(commentMatch[1]); const user = await requiredUser(request); const { data: comment } = await db.from('comments').select('id,author_id').eq('id', id).single(); if (!comment) return error('댓글을 찾을 수 없습니다.', 404); if (comment.author_id !== user.id) return error('작성한 댓글만 수정·삭제할 수 있습니다.', 403)
  if (method === 'PUT') { const input = await bodyOf(request); const content = String(input.content || '').trim(); if (!content || content.length > 500) return error('댓글은 1자 이상 500자 이하로 작성해주세요.'); const { data, error: updateError } = await db.from('comments').update({ content }).eq('id', id).select('id,post_id,content,created_at,author_id,profiles:author_id(name)').single(); if (updateError) return error(updateError.message, 500); return json({ ...data, author: data.profiles?.name || user.user_metadata?.name || '알 수 없음' }) }
  if (method === 'DELETE') { const { error: deleteError } = await db.from('comments').delete().eq('id', id); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers }) }
  return null
}

async function handleAdmin(path: string, method: string, request: Request) {
  const { profile } = await adminUser(request)
  if (path === '/admin/dashboard' && method === 'GET') {
    const [{ data: posts }, { data: comments }, { data: users }, { data: views }, { data: reactions }] = await Promise.all([
      db.from('posts').select('created_at,views'),
      db.from('comments').select('created_at'),
      db.from('profiles').select('created_at'),
      db.from('post_views').select('created_at'),
      db.from('post_reactions').select('created_at,reaction'),
    ])
    const now = Date.now()
    const ranges: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 }
    const inRange = (value: string, days: number) => now - new Date(value).getTime() <= days * 86400000
    const build = (days: number) => {
      const postRows = (posts || []).filter((row) => inRange(row.created_at, days))
      const commentRows = (comments || []).filter((row) => inRange(row.created_at, days))
      const userRows = (users || []).filter((row) => inRange(row.created_at, days))
      const viewRows = (views || []).filter((row) => inRange(row.created_at, days))
      const reactionRows = (reactions || []).filter((row) => inRange(row.created_at, days))
      return { posts: postRows.length, comments: commentRows.length, users: userRows.length, views: viewRows.length, likes: reactionRows.filter((row) => row.reaction === 'like').length, dislikes: reactionRows.filter((row) => row.reaction === 'dislike').length }
    }
    return json({ metrics: { posts: (posts || []).length, comments: (comments || []).length, users: (users || []).length, views: (posts || []).reduce((sum, row) => sum + (row.views || 0), 0) }, periods: Object.fromEntries(Object.entries(ranges).map(([key, days]) => [key, build(days)])) })
  }
  if (path === '/admin/notices' && method === 'GET') {
    const { data, error: readError } = await db.from('notices').select('*').order('published_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json(data || [])
  }
  if (path === '/admin/notices' && method === 'POST') {
    const input = await bodyOf(request); const title = String(input.title || '').trim(); const content = String(input.content || '').trim()
    if (!title || !content) return error('공지 제목과 내용을 입력해주세요.')
    const { data, error: insertError } = await db.from('notices').insert({ title, content, created_by: profile.id, is_published: true, show_as_modal: true }).select().single()
    if (insertError) return error(insertError.message, 500)
    return json(data, 201)
  }
  const noticeMatch = path.match(/^\/admin\/notices\/(\d+)$/)
  if (noticeMatch && method === 'PATCH') {
    const input = await bodyOf(request)
    const changes: Record<string, boolean> = {}
    if (typeof input.published === 'boolean') changes.is_published = input.published
    if (typeof input.showAsModal === 'boolean') changes.show_as_modal = input.showAsModal
    if (!Object.keys(changes).length) return error('변경할 공개 설정을 입력해주세요.')
    const { data, error: updateError } = await db.from('notices').update(changes).eq('id', Number(noticeMatch[1])).select().single()
    if (updateError) return error(updateError.message, 500)
    return json(data)
  }
  if (path === '/admin/dashboard' && method === 'GET') {
    const [postsCount, commentsCount, usersCount, views, recentPosts, recentComments] = await Promise.all([
      db.from('posts').select('*', { count: 'exact', head: true }),
      db.from('comments').select('*', { count: 'exact', head: true }),
      db.from('profiles').select('*', { count: 'exact', head: true }),
      db.from('posts').select('views'),
      db.from('post_list').select('*').order('created_at', { ascending: false }).limit(6),
      db.from('comments').select('id,content,created_at,author_id,profiles:author_id(name)').order('created_at', { ascending: false }).limit(6),
    ])
    const queryError = [postsCount, commentsCount, usersCount, views, recentPosts, recentComments].find((result) => result.error)?.error
    if (queryError) return error(queryError.message, 500)
    return json({
      metrics: {
        posts: postsCount.count || 0,
        comments: commentsCount.count || 0,
        users: usersCount.count || 0,
        views: (views.data || []).reduce((total, post) => total + Number(post.views || 0), 0),
      },
      recentPosts: (recentPosts.data || []).map(postPayload),
      recentComments: (recentComments.data || []).map((comment: any) => ({ ...comment, author: comment.profiles?.name || '알 수 없음' })),
    })
  }
  if (path === '/admin/inquiries' && method === 'GET') {
    const { data, error: readError } = await db.from('inquiries').select('*, profiles:user_id(name,email)').order('created_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json((data || []).map((item: any) => ({ ...item, user_name: item.profiles?.name || item.profiles?.email || '알 수 없음' })))
  }
  const inquiryMatch = path.match(/^\/admin\/inquiries\/(\d+)$/)
  if (inquiryMatch && method === 'PATCH') {
    const input = await bodyOf(request); const status = String(input.status || ''); const answer = String(input.answer || '')
    if (!['received', 'in_progress', 'answered', 'closed'].includes(status)) return error('올바른 문의 상태가 아닙니다.')
    const changes: Record<string, unknown> = { status, answer, updated_at: new Date().toISOString() }
    if (typeof input.hidden === 'boolean') changes.is_hidden = input.hidden
    const { data, error: updateError } = await db.from('inquiries').update(changes).eq('id', Number(inquiryMatch[1])).select().single()
    if (updateError) return error(updateError.message, 500)
    return json(data)
  }
  if (path === '/admin/reports' && method === 'GET') {
    const { data, error: readError } = await db.from('reports').select('*, profiles:reporter_id(name,email)').order('created_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json((data || []).map((item: any) => ({ ...item, reporter: item.profiles?.name || item.profiles?.email || '알 수 없음' })))
  }
  const reportMatch = path.match(/^\/admin\/reports\/(\d+)$/)
  if (reportMatch && method === 'PATCH') {
    const input = await bodyOf(request)
    const status = String(input.status || '')
    if (!['pending', 'reviewed', 'resolved', 'dismissed'].includes(status)) return error('올바른 신고 상태가 아닙니다.')
    const changes: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (typeof input.hidden === 'boolean') changes.is_hidden = input.hidden
    const { data, error: updateError } = await db.from('reports').update(changes).eq('id', Number(reportMatch[1])).select().single()
    if (updateError) return error(updateError.message, 500)
    return json(data)
  }
  if (path === '/admin/settings' && method === 'GET') {
    const { data, error: readError } = await db.from('site_settings').select('key,value').order('key')
    if (readError) return error(readError.message, 500)
    return json(data || [])
  }
  if (path === '/admin/settings' && method === 'PATCH') {
    const input = await bodyOf(request)
    const entries = Object.entries(input || {})
    for (const [key, value] of entries) {
      const { error: updateError } = await db.from('site_settings').upsert({ key, value: String(value), updated_at: new Date().toISOString(), updated_by: profile.id }, { onConflict: 'key' })
      if (updateError) return error(updateError.message, 500)
    }
    const { data } = await db.from('site_settings').select('key,value').order('key')
    return json(data || [])
  }
  if (path === '/admin/posts' && method === 'GET') return json(await listPosts(true))
  if (path === '/admin/posts' && method === 'POST') {
    const input = await bodyOf(request); const title = String(input.title || '').trim(); const content = String(input.content || '').trim()
    if (!title || !content) return error('제목과 내용을 입력해주세요.')
    const { data, error: insertError } = await db.from('posts').insert({ title, content, category: String(input.category || '자유').trim() || '자유', author_id: profile.id }).select('*, profiles:author_id(name)').single()
    if (insertError) return error(insertError.message, 500)
    return json({ ...data, author: data.profiles?.name || profile.name, is_hidden: false, likes: 0, dislikes: 0 }, 201)
  }
  const postMatch = path.match(/^\/admin\/posts\/(\d+)(?:\/visibility)?$/)
  if (postMatch && method === 'PUT') {
    const input = await bodyOf(request); const title = String(input.title || '').trim(); const content = String(input.content || '').trim()
    if (!title || !content) return error('제목과 내용을 입력해주세요.')
    const { data, error: updateError } = await db.from('posts').update({ title, content, category: String(input.category || '자유').trim() || '자유' }).eq('id', Number(postMatch[1])).select('*, profiles:author_id(name)').single()
    if (updateError) return error(updateError.message, 500)
    return json({ ...data, author: data.profiles?.name || '알 수 없음', is_hidden: Boolean(data.is_hidden) })
  }
  if (postMatch && path.endsWith('/visibility') && method === 'PATCH') { const input = await bodyOf(request); const { data, error: updateError } = await db.from('posts').update({ is_hidden: Boolean(input.hidden) }).eq('id', Number(postMatch[1])).select('id,is_hidden').single(); if (updateError) return error(updateError.message, 500); return json(data) }
  if (postMatch && method === 'DELETE') { const { error: deleteError } = await db.from('posts').delete().eq('id', Number(postMatch[1])); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers }) }
  if (path === '/admin/comments' && method === 'GET') { const { data, error: readError } = await db.from('comments').select('id,post_id,content,created_at,author_id,is_hidden,profiles:author_id(name),posts:post_id(title)').order('created_at', { ascending: false }); if (readError) return error(readError.message, 500); return json((data || []).map((item: any) => ({ ...item, author: item.profiles?.name || '알 수 없음', post_title: item.posts?.title || '' }))) }
  const commentMatch = path.match(/^\/admin\/comments\/(\d+)(?:\/visibility)?$/)
  if (commentMatch && path.endsWith('/visibility') && method === 'PATCH') { const input = await bodyOf(request); const { data, error: updateError } = await db.from('comments').update({ is_hidden: Boolean(input.hidden) }).eq('id', Number(commentMatch[1])).select('id,is_hidden').single(); if (updateError) return error(updateError.message, 500); return json(data) }
  if (commentMatch && method === 'DELETE') { const { error: deleteError } = await db.from('comments').delete().eq('id', Number(commentMatch[1])); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers }) }
  if (path === '/admin/account' && method === 'GET') return json({ id: profile.id, name: profile.name, email: profile.email, profile_image: profile.profile_image })
  if (path === '/admin/account' && method === 'PUT') {
    const input = await bodyOf(request); const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase()
    if (!name || !email) return error('이름과 이메일을 입력해주세요.')
    if (input.newPassword) {
      const checked = await auth.auth.signInWithPassword({ email: profile.email, password: String(input.currentPassword || '') })
      if (checked.error) return error('현재 비밀번호가 올바르지 않습니다.', 401)
    }
    const authUpdate: { email?: string; password?: string; user_metadata?: { name: string } } = { email, user_metadata: { name } }
    if (input.newPassword) authUpdate.password = String(input.newPassword)
    const { error: authError } = await db.auth.admin.updateUserById(profile.id, authUpdate)
    if (authError) return error(authError.message, 400)
    const { data, error: updateError } = await db.from('profiles').update({ name, email, profile_image: String(input.profileImage || '') }).eq('id', profile.id).select().single()
    if (updateError) return error(updateError.message, 500)
    return json({ id: data.id, name: data.name, email: data.email, profile_image: data.profile_image })
  }
  return null
}

async function handleInquiries(path: string, method: string, request: Request) {
  const user = await requiredUser(request)
  if (path === '/inquiries' && method === 'POST') {
    const input = await bodyOf(request); const content = String(input.content || '').trim()
    if (!content || content.length > 5000) return error('문의 내용은 1자 이상 5000자 이하로 작성해주세요.')
    const { data, error: insertError } = await db.from('inquiries').insert({ user_id: user.id, content }).select().single()
    if (insertError) return error(insertError.message, 500)
    return json(data, 201)
  }
  if (path === '/inquiries' && method === 'GET') {
    const { data, error: readError } = await db.from('inquiries').select('*').eq('user_id', user.id).eq('is_hidden', false).order('created_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json(data || [])
  }
  const match = path.match(/^\/inquiries\/(\d+)$/)
  if (match && (method === 'PUT' || method === 'DELETE')) {
    const id = Number(match[1])
    const { data: inquiry } = await db.from('inquiries').select('id,user_id,status').eq('id', id).single()
    if (!inquiry) return error('문의를 찾을 수 없습니다.', 404)
    if (inquiry.user_id !== user.id) return error('작성자만 문의를 변경할 수 있습니다.', 403)
    if (method === 'DELETE') { const { error: deleteError } = await db.from('inquiries').delete().eq('id', id); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers }) }
    if (inquiry.status === 'answered' || inquiry.status === 'closed') return error('답변이 완료된 문의는 변경할 수 없습니다.', 409)
    const input = await bodyOf(request); const content = String(input.content || '').trim()
    if (!content || content.length > 5000) return error('문의 내용은 1자 이상 5000자 이하로 작성해주세요.')
    const { data, error: updateError } = await db.from('inquiries').update({ content, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (updateError) return error(updateError.message, 500)
    return json(data)
  }
  return null
}

async function handleNotices(path: string, method: string) {
  if (path !== '/notices' || method !== 'GET') return null
  const { data, error: readError } = await db.from('notices').select('id,title,content,published_at,show_as_modal').eq('is_published', true).order('published_at', { ascending: false })
  if (readError) return error(readError.message, 500)
  return json(data || [])
}

async function handleReports(path: string, method: string, request: Request) {
  if (path === '/reports' && method === 'GET') {
    const user = await requiredUser(request)
    const { data, error: readError } = await db.from('reports').select('id,target_type,target_id,reason,status,created_at,updated_at,is_hidden').eq('reporter_id', user.id).eq('is_hidden', false).order('created_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json(data || [])
  }
  const match = path.match(/^\/reports\/(\d+)$/)
  if (match && (method === 'PUT' || method === 'DELETE')) {
    const user = await requiredUser(request); const id = Number(match[1])
    const { data: report } = await db.from('reports').select('id,reporter_id,status').eq('id', id).single()
    if (!report) return error('신고를 찾을 수 없습니다.', 404)
    if (report.reporter_id !== user.id) return error('작성자만 신고를 변경할 수 있습니다.', 403)
    if (method === 'DELETE') { const { error: deleteError } = await db.from('reports').delete().eq('id', id); if (deleteError) return error(deleteError.message, 500); return new Response(null, { status: 204, headers }) }
    if (report.status !== 'pending') return error('처리 중인 신고는 변경할 수 없습니다.', 409)
    const input = await bodyOf(request); const reason = String(input.reason || '').trim()
    if (!reason || reason.length > 1000) return error('신고 내용을 확인해주세요.')
    const { data, error: updateError } = await db.from('reports').update({ reason, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (updateError) return error(updateError.message, 500)
    return json(data)
  }
  if (path !== '/reports' || method !== 'POST') return null
  const user = await requiredUser(request); const input = await bodyOf(request)
  const targetType = input.targetType === 'comment' ? 'comment' : input.targetType === 'post' ? 'post' : ''
  const targetId = Number(input.targetId); const reason = String(input.reason || '').trim()
  if (!targetType || !Number.isInteger(targetId) || targetId < 1 || !reason || reason.length > 1000) return error('신고 내용을 확인해주세요.')
  const { data, error: insertError } = await db.from('reports').insert({ reporter_id: user.id, target_type: targetType, target_id: targetId, reason }).select().single()
  if (insertError) return error(insertError.message, 500)
  return json(data, 201)
}

async function handleAdminUsers(path: string, method: string, request: Request) {
  const { profile } = await adminUser(request)
  if (path === '/admin/users' && method === 'GET') {
    const { data, error: readError } = await db.from('profiles').select('id,name,email,role,created_at').order('created_at', { ascending: false })
    if (readError) return error(readError.message, 500)
    return json(data || [])
  }
  const match = path.match(/^\/admin\/users\/([^/]+)$/)
  if (!match) return null
  const userId = match[1]
  if (method === 'PATCH') {
    const input = await bodyOf(request)
    const role = input.role === 'admin' ? 'admin' : input.role === 'user' ? 'user' : ''
    if (!role) return error('유효한 권한을 선택해주세요.')
    if (profile.id === userId && role !== 'admin') return error('현재 로그인한 관리자 권한은 해제할 수 없습니다.', 400)
    const { data, error: updateError } = await db.from('profiles').update({ role }).eq('id', userId).select('id,name,email,role,created_at').single()
    if (updateError) return error(updateError.message, 400)
    return json(data)
  }
  if (method === 'DELETE') {
    if (profile.id === userId) return error('현재 로그인한 관리자 계정은 삭제할 수 없습니다.', 400)
    const { error: deleteError } = await db.auth.admin.deleteUser(userId)
    if (deleteError) return error(deleteError.message, 400)
    return new Response(null, { status: 204, headers })
  }
  return null
}

async function handler(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  const url = new URL(request.url); const path = url.pathname.replace(/^\/functions\/v1\/api/, '').replace(/^\/api/, '') || '/'; const method = request.method
  try {
    if (path === '/health' && method === 'GET') return json({ status: 'ok', message: 'Backend server is running' })
    if (path === '/admin/login' && method === 'POST') return handleAdminLogin(request)
    if ((path === '/auth/login' || path === '/auth/signup') && method === 'POST') return handleAuth(path, request)
    if (path === '/profile' && (method === 'GET' || method === 'PUT')) return handleProfile(path, request)
    const viewMatch = path.match(/^\/posts\/(\d+)\/view$/); if (viewMatch && method === 'POST') return handleView(Number(viewMatch[1]), request)
    const reactionMatch = path.match(/^\/posts\/(\d+)\/reactions$/); if (reactionMatch && (method === 'GET' || method === 'POST')) return handleReactions(Number(reactionMatch[1]), method, request)
    const commentsResult = await handleComments(path, method, request); if (commentsResult) return commentsResult
    const inquiriesResult = path.startsWith('/inquiries') ? await handleInquiries(path, method, request) : null; if (inquiriesResult) return inquiriesResult
    const noticesResult = await handleNotices(path, method); if (noticesResult) return noticesResult
    const reportsResult = path.startsWith('/reports') ? await handleReports(path, method, request) : null; if (reportsResult) return reportsResult
    const adminUsersResult = path.startsWith('/admin/users') ? await handleAdminUsers(path, method, request) : null; if (adminUsersResult) return adminUsersResult
    const adminResult = path.startsWith('/admin/') ? await handleAdmin(path, method, request) : null; if (adminResult) return adminResult
    const postsResult = await handlePosts(path, method, request); if (postsResult) return postsResult
    return error('요청한 API를 찾을 수 없습니다.', 404)
  } catch (caught) {
    if (caught instanceof Response) return caught
    console.error(caught); return error(caught instanceof Error ? caught.message : '서버 오류가 발생했습니다.', 500)
  }
}

Deno.serve(handler)
