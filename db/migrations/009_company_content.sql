-- 009_company_content.sql — FAQ, đối tác, chứng nhận, dự án, tuyển dụng (dùng chung bảng content_items/content_translations).
-- Thêm cột `meta` (trường riêng từng loại, không phụ thuộc ngôn ngữ) có kiểm định chặt, đường dẫn dành riêng, và hàm cho biết ngôn ngữ nào đã có nội dung loại nào.

alter table public.content_items add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.content_items add constraint content_items_meta_object check (jsonb_typeof(meta) = 'object' and char_length(meta::text) <= 4000);

-- Khoá meta được phép theo loại:
--   partner: url · certification: issuer, year, url · project: client, year, url · career: location, type, deadline, salary, apply_email
create or replace function public.content_meta_guard() returns trigger language plpgsql as $$
declare allowed text[]; k text; v jsonb; s text;
begin
  if jsonb_typeof(new.meta) <> 'object' then raise exception 'INVALID_META:meta' using errcode = 'P0001'; end if;
  allowed := case new.kind
    when 'partner' then array['url'] when 'certification' then array['issuer', 'year', 'url'] when 'project' then array['client', 'year', 'url']
    when 'career' then array['location', 'type', 'deadline', 'salary', 'apply_email'] else array[]::text[] end;
  for k, v in select key, value from jsonb_each(new.meta) loop
    if not (k = any (allowed)) then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
    if k = 'year' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 1900 and 2100 then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
      continue;
    end if;
    if jsonb_typeof(v) <> 'string' then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
    s := v #>> '{}';
    if k = 'url' then
      if char_length(s) > 500 or s !~ '^https://[^[:space:]<>"'']+$' then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
    elsif k = 'apply_email' then
      if char_length(s) > 200 or s !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
    elsif k = 'deadline' then
      if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
      begin perform s::date; exception when others then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end;
    elsif k = 'type' then
      if s not in ('full_time', 'part_time', 'contract', 'intern', 'freelance') then raise exception 'INVALID_META:%', k using errcode = 'P0001'; end if;
    elsif char_length(trim(s)) not between 1 and 200 then raise exception 'INVALID_META:%', k using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
create trigger trg_content_meta_guard before insert or update of meta, kind on public.content_items for each row execute function public.content_meta_guard();

-- Đường dẫn dành riêng: thêm các mục mới (trang cấp một không được trùng). Phải khớp PATHS trong src/i18n.js.
create or replace function public._reserved_slugs() returns text[] language sql immutable as
$$ select array['san-pham','products','gio-hang','cart','thanh-toan','checkout','dat-hang-thanh-cong','order-confirmation',
  'bao-gia-so-luong-lon','request-quote','lien-he','contact','tin-tuc','news','dich-vu','services','chinh-sach','policies',
  'hoi-dap','faq','doi-tac','partners','chung-nhan','certifications','du-an','projects','tuyen-dung','careers',
  'api','assets','quan-tri','vi','en','sitemap','robots'] $$;

-- Cho biết (ngôn ngữ, loại) nào ĐÃ có nội dung hiển thị công khai. Chạy với quyền người gọi => RLS áp dụng (anon chỉ thấy phần đã xuất bản).
create or replace function public.content_presence() returns table (lang text, kind text) language sql stable as
$$ select distinct t.lang, i.kind from public.content_translations t join public.content_items i on i.id = t.item_id $$;
revoke all on function public.content_presence() from public;
grant execute on function public.content_presence() to anon, authenticated, service_role;
