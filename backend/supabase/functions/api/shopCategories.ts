import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
const fields = 'id,name,description,category_type,sort_order,is_active'
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
export async function handleShopCategories(path: string, method: string, request: Request, db: SupabaseClient, requireAdmin: (request: Request) => Promise<unknown>) {
  const isPublic = path === '/shop/categories' && method === 'GET'
  if (!isPublic) await requireAdmin(request)
  if ((path === '/shop/categories' || path === '/admin/shop/categories') && method === 'GET') {
    let query = db.from('shop_categories').select(fields).order('sort_order').order('created_at')
    if (isPublic) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) throw new Error('Cannot load shop categories')
    return json(data || [])
  }
  const match = path.match(/^\/admin\/shop\/categories\/([a-z0-9_-]{1,80})$/)
  if ((path === '/admin/shop/categories' && method === 'POST') || (match && method === 'PATCH')) {
    let input: any
    try { input = await request.json() } catch { return json({ message: '올바른 설정을 입력해주세요.' }, 400) }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (!name || name.length > 60 || description.length > 500 || typeof input.is_active !== 'boolean'
      || !Number.isInteger(input.sort_order) || input.sort_order < 0 || input.sort_order > 9999) return json({ message: '분류명(60자 이하), 설명(500자 이하), 표시 순서(0~9999)를 확인해주세요.' }, 400)
    const values = { name, description, sort_order: input.sort_order, is_active: input.is_active, updated_at: new Date().toISOString() }
    const result = match
      ? await db.from('shop_categories').update(values).eq('id', match[1]).select(fields).maybeSingle()
      : await db.from('shop_categories').insert({ ...values, id: 'category_' + crypto.randomUUID().replaceAll('-', ''), category_type: 'content' }).select(fields).single()
    if (result.error?.code === '23505') return json({ message: '같은 이름의 카테고리가 이미 있습니다.' }, 409)
    if (result.error) throw new Error('Cannot save shop category')
    if (!result.data) return json({ message: '카테고리를 찾을 수 없습니다.' }, 404)
    return json(result.data, match ? 200 : 201)
  }
  return json({ message: '요청한 카테고리 API가 없습니다.' }, 404)
}
