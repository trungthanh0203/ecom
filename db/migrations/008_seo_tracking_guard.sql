-- 008_seo_tracking_guard.sql — SEO, chuyển hướng 301 và theo dõi (GA4/GTM).
-- Các giá trị cấu hình được chèn thẳng vào mọi trang công khai (mã GTM = chạy script bên thứ ba!) nên PHẢI kiểm định dạng ở DB,
-- và chỉ Admin/Super Admin (settings.write) mới được đổi mã theo dõi; Editor (seo.write) chỉ đổi được các khoá seo_* / social_*.

-- ===== Chuyển hướng =====
alter table public.redirects
  add constraint redirects_from_clean check (from_path !~ '[?#[:space:]]' and char_length(from_path) <= 300),
  add constraint redirects_to_safe check (char_length(to_path) <= 500 and to_path ~* '^(/([^/]|$)|https://)' and to_path !~ '[[:space:]]'),
  add constraint redirects_not_self check (from_path <> to_path);

create or replace function public.redirects_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare cur text := new.to_path; hops int := 0; nxt text;
begin
  -- phát hiện vòng lặp: đi theo chuỗi chuyển hướng tối đa 10 bước, nếu quay lại from_path => vòng lặp
  while hops < 10 loop
    if cur = new.from_path then raise exception 'REDIRECT_LOOP' using errcode = 'P0001'; end if;
    select to_path into nxt from redirects where from_path = cur and active and id is distinct from new.id limit 1;
    exit when nxt is null;
    cur := nxt; hops := hops + 1;
  end loop;
  return new;
end $$;
create trigger trg_redirects_guard before insert or update on public.redirects for each row execute function public.redirects_guard();

-- ===== Cài đặt SEO / theo dõi: kiểm định dạng =====
create or replace function public.site_settings_guard() returns trigger language plpgsql as $$
declare k text := new.key; v text; ok boolean := true; host text := '(https://[a-z0-9*.-]+(:[0-9]{1,5})?)';
begin
  if k !~ '^(ga4_id|gtm_id|tracking_consent|csp_(script|connect|img|frame)_extra|seo_.*|social_.*|brand_(logo|favicon)_path)$' then return new; end if;
  if k = 'seo_noindex' then
    if jsonb_typeof(new.value) <> 'boolean' then raise exception 'INVALID_SETTING:%', k using errcode = 'P0001'; end if;
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'string' then raise exception 'INVALID_SETTING:%', k using errcode = 'P0001'; end if;
  v := new.value #>> '{}';
  ok := case
    when k = 'ga4_id' then v ~ '^G-[A-Z0-9]{6,12}$'
    when k = 'gtm_id' then v ~ '^GTM-[A-Z0-9]{4,10}$'
    when k = 'tracking_consent' then v in ('required', 'none')
    when k ~ '^csp_' then char_length(v) <= 500 and v ~ ('^' || host || '( ' || host || ')*$')
    when k ~ '^seo_verification_' then v ~ '^[A-Za-z0-9_-]{10,100}$'
    when k in ('seo_og_image', 'brand_logo_path', 'brand_favicon_path') then v ~ '^[A-Za-z0-9._/-]{1,200}$' and v !~ '\.\.'
    when k ~ '^social_' then char_length(v) between 12 and 300 and v ~ '^https://[^[:space:]<>"'']+$'
    when k = 'seo_title_suffix' then char_length(v) <= 100
    when k ~ '^seo_home_title_' then char_length(v) <= 200
    when k ~ '^seo_home_desc_' then char_length(v) <= 300
    else char_length(v) <= 300
  end;
  if not ok then raise exception 'INVALID_SETTING:%', k using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger trg_site_settings_guard before insert or update on public.site_settings for each row execute function public.site_settings_guard();

-- Editor (seo.write) được quản lý riêng các khoá seo_* và social_*; mọi khoá khác vẫn cần settings.write
create policy seo_settings_ins on public.site_settings for insert to authenticated
  with check (public.has_perm('seo.write') and key ~ '^(seo|social)_');
create policy seo_settings_upd on public.site_settings for update to authenticated
  using (public.has_perm('seo.write') and key ~ '^(seo|social)_') with check (public.has_perm('seo.write') and key ~ '^(seo|social)_');
create policy seo_settings_del on public.site_settings for delete to authenticated
  using (public.has_perm('seo.write') and key ~ '^(seo|social)_');
