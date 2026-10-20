create table public.shop_categories (
  id text primary key,
  name text not null check(length(trim(name)) between 1 and 60),
  description text not null default '' check(length(description)<=500),
  category_type text not null default 'content' check(category_type in ('subscription','credits','content')),
  sort_order integer not null default 0 check(sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shop_category_name on public.shop_categories(lower(trim(name)));
insert into public.shop_categories(id,name,description,category_type,sort_order) values
  ('subscriptions','구독·이용권','월간 멤버십과 1개월 이용권','subscription',10),
  ('credits','크레딧','서비스에서 사용하는 포인트 충전','credits',20),
  ('ebooks','전자책·자료','전자책과 학습·업무에 필요한 디지털 자료','content',30),
  ('templates','템플릿·디자인','바로 활용할 수 있는 템플릿과 디자인 리소스','content',40),
  ('courses','영상·강의','영상 콘텐츠와 온라인 강의','content',50);
alter table public.shop_products add column category_id text references public.shop_categories(id);
update public.shop_products set category_id=case product_type when 'subscription' then 'subscriptions' else 'credits' end;
alter table public.shop_products alter column category_id set not null;
create index shop_product_category on public.shop_products(category_id);
alter table public.shop_categories enable row level security;
revoke all on public.shop_categories from public,anon,authenticated;
grant all on public.shop_categories to service_role;
