-- HOTEL MANAGER PRO 4.0.0
-- Chạy toàn bộ tệp này một lần trong Supabase SQL Editor.

create table if not exists public.hotel_app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.hotel_app_state enable row level security;

-- Không tạo policy công khai. Trình duyệt không truy cập Supabase trực tiếp.
-- Chỉ Vercel Serverless API dùng service role mới đọc/ghi được bảng này.

create or replace function public.save_hotel_state(
  p_id text,
  p_expected_version bigint,
  p_state jsonb
)
returns table(saved boolean, current_version bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hotel_app_state%rowtype;
begin
  select * into v_row from public.hotel_app_state where id = p_id for update;

  if not found then
    if p_expected_version <> 0 then
      return query select false, 0::bigint, now();
      return;
    end if;
    insert into public.hotel_app_state(id, state, version, updated_at)
    values (p_id, p_state, 1, now())
    returning * into v_row;
    return query select true, v_row.version, v_row.updated_at;
    return;
  end if;

  if v_row.version <> p_expected_version then
    return query select false, v_row.version, v_row.updated_at;
    return;
  end if;

  update public.hotel_app_state
  set state = p_state,
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;

  return query select true, v_row.version, v_row.updated_at;
end;
$$;

revoke all on function public.save_hotel_state(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_hotel_state(text, bigint, jsonb) to service_role;

create index if not exists hotel_app_state_updated_at_idx on public.hotel_app_state(updated_at desc);
