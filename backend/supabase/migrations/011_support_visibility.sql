alter table public.reports
  add column if not exists is_hidden boolean not null default false;

alter table public.inquiries
  add column if not exists is_hidden boolean not null default false;
