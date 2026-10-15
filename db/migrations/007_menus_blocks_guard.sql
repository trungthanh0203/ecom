-- 007_menus_blocks_guard.sql — siết ràng buộc menu & khối trang chủ (dữ liệu hiển thị công khai nên phải được kiểm soát ở DB).
-- Menu: tối đa 2 cấp; liên kết chỉ nhận /đường-dẫn-nội-bộ, #neo, http(s)://, mailto:, tel: (chặn javascript:, data:, //host…).
-- Chạy được khi bảng còn trống hoặc dữ liệu cũ đã hợp lệ; nếu có dòng vi phạm, lệnh sẽ báo lỗi và không đổi gì.
alter table public.menus
  add constraint menus_location_ck check (location in ('main', 'footer')),
  add constraint menus_not_self_parent check (parent_id is null or parent_id <> id),
  add constraint menus_label_len check (char_length(trim(label_vi)) between 1 and 100 and (label_en is null or char_length(trim(label_en)) between 1 and 100)),
  add constraint menus_url_safe check (
    char_length(url_vi) <= 500 and url_vi ~* '^(/([^/]|$)|#|https?://|mailto:|tel:)'
    and (url_en is null or (char_length(url_en) <= 500 and url_en ~* '^(/([^/]|$)|#|https?://|mailto:|tel:)')));

create or replace function public.menus_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare p menus;
begin
  if new.parent_id is not null then
    select * into p from menus where id = new.parent_id;
    if not found then raise exception 'MENU_PARENT_NOT_FOUND' using errcode = 'P0001'; end if;
    if p.parent_id is not null then raise exception 'MENU_MAX_DEPTH' using errcode = 'P0001'; end if;     -- cha phải là mục cấp 1
    if p.location <> new.location then raise exception 'MENU_LOCATION_MISMATCH' using errcode = 'P0001'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from menus where parent_id = new.id) then raise exception 'MENU_MAX_DEPTH' using errcode = 'P0001'; end if;  -- mục đang có con không được thành mục con
  end if;
  return new;
end $$;
create trigger trg_menus_guard before insert or update on public.menus for each row execute function public.menus_guard();

alter table public.home_blocks
  add constraint home_blocks_type_ck check (block_type in ('hero', 'categories', 'products', 'brands', 'news', 'cta', 'text', 'banner')),
  add constraint home_blocks_payload_ck check (jsonb_typeof(payload) = 'object' and char_length(payload::text) <= 30000);

-- nhật ký thao tác cho menu & khối trang chủ (dùng lại hàm audit_row ở 002)
create trigger trg_audit after insert or update or delete on public.menus for each row execute function public.audit_row();
create trigger trg_audit after insert or update or delete on public.home_blocks for each row execute function public.audit_row();
