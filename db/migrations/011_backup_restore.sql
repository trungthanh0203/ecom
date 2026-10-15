-- 011_backup_restore.sql — hàm hỗ trợ KHÔI PHỤC dữ liệu từ bản sao lưu (scripts/restore.mjs). Chỉ service_role gọi được.
-- Thiết kế: mỗi lần gọi là MỘT giao dịch (nguyên tử): tắt trigger nghiệp vụ của đúng bảng đích → nạp → bật lại.
-- Nhờ tắt trigger nên dữ liệu cũ (vốn đã hợp lệ lúc sao lưu) được nạp nguyên vẹn: không bị trigger chặn theo thứ tự,
-- không bị ghi nhật ký trùng, giữ nguyên created_at/updated_at. Nếu lỗi giữa chừng, giao dịch huỷ và trigger vẫn ở trạng thái bật.
-- AN TOÀN: bảng đích phải TRỐNG ở lần nạp đầu (p_first = true), nếu không từ chối — tránh ghi đè dữ liệu đang chạy.

create or replace function public.restore_load(p_table text, p_rows jsonb, p_first boolean default true) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  allowed text[] := array['staff','role_permissions','site_settings','shipping_rules','categories','category_translations','brands','brand_translations',
    'attribute_defs','products','product_translations','product_images','post_categories','post_category_translations','content_items','content_translations',
    'menus','home_blocks','redirects','orders','order_items','order_status_history','order_notes','quote_requests','quote_request_items','quote_activities',
    'contact_requests','audit_logs'];
  nonempty boolean; n integer;
begin
  if not (p_table = any (allowed)) then raise exception 'RESTORE_TABLE_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'RESTORE_BAD_ROWS' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) = 0 then return 0; end if;
  if p_first then
    execute format('select exists (select 1 from public.%I)', p_table) into nonempty;
    if nonempty then raise exception 'RESTORE_TABLE_NOT_EMPTY' using errcode = 'P0001'; end if;
  end if;
  execute format('alter table public.%I disable trigger user', p_table);
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', p_table, p_table) using p_rows;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_table);
  return n;
end $$;
revoke all on function public.restore_load(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.restore_load(text, jsonb, boolean) to service_role;

-- Sau khi nạp id tường minh, đặt lại bộ đếm tự tăng để bản ghi MỚI không trùng id cũ
create or replace function public.restore_fix_sequences() returns integer
language plpgsql volatile security definer set search_path = public as $$
declare r record; seq text; mx bigint; n integer := 0;
begin
  for r in select c.table_name, c.column_name from information_schema.columns c
           where c.table_schema = 'public' and c.is_identity = 'YES' loop
    seq := pg_get_serial_sequence(format('public.%I', r.table_name), r.column_name);
    if seq is null then continue; end if;
    execute format('select max(%I) from public.%I', r.column_name, r.table_name) into mx;
    if mx is not null then perform setval(seq, mx, true); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.restore_fix_sequences() from public, anon, authenticated;
grant execute on function public.restore_fix_sequences() to service_role;
