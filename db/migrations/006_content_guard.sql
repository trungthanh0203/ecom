-- 006_content_guard.sql — trang (kind='page') nằm ở URL cấp một /{lang}/{slug}/ nên slug KHÔNG được trùng đường dẫn hệ thống.
-- Danh sách này phải khớp PATHS trong src/i18n.js (+ tiền tố nội dung). Thêm đường dẫn hệ thống mới => thêm vào đây.
create or replace function public._reserved_slugs() returns text[] language sql immutable as
$$ select array['san-pham','products','gio-hang','cart','thanh-toan','checkout','dat-hang-thanh-cong','order-confirmation',
  'bao-gia-so-luong-lon','request-quote','lien-he','contact','tin-tuc','news','dich-vu','services','chinh-sach','policies',
  'api','assets','quan-tri','vi','en','sitemap','robots'] $$;

create or replace function public.content_slug_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select kind into k from content_items where id = new.item_id;
  if k = 'page' and new.slug = any (public._reserved_slugs()) then
    raise exception 'RESERVED_SLUG' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_content_slug_guard before insert or update of slug on public.content_translations
  for each row execute function public.content_slug_guard();

-- Đổi loại nội dung thành 'page' cũng phải kiểm tra các slug đã có
create or replace function public.content_kind_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'page' and old.kind <> 'page'
     and exists (select 1 from content_translations where item_id = new.id and slug = any (public._reserved_slugs())) then
    raise exception 'RESERVED_SLUG' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_content_kind_guard before update of kind on public.content_items
  for each row execute function public.content_kind_guard();
