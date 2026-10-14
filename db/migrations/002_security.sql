-- 002_security.sql — quyền, RLS, trigger bảo vệ nghiệp vụ. Quyền thật nằm ở DB, không ở nút giao diện.

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid() and active) $$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff s join role_permissions rp on rp.role = s.role
                  where s.user_id = auth.uid() and s.active and rp.perm = p) $$;

-- ===== Trigger dùng chung =====
create or replace function public.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

create trigger trg_products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger trg_content_touch  before update on public.content_items for each row execute function public.touch_updated_at();

-- Xuất bản sản phẩm yêu cầu có bản dịch VI đã published
create or replace function public.products_publish_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if not exists (select 1 from product_translations where product_id = new.id and lang = 'vi' and status = 'published') then
      raise exception 'PUBLISH_NEEDS_VI_TRANSLATION' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_products_publish_guard before insert or update on public.products for each row execute function public.products_publish_guard();

-- Không được gỡ/xoá bản dịch VI đã publish khi sản phẩm vẫn đang published
create or replace function public.product_tr_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare o product_translations; pst text;
begin
  o := old;
  if o.lang = 'vi' and o.status = 'published' and (tg_op = 'DELETE' or new.status <> 'published') then
    select status into pst from products where id = o.product_id;
    if pst = 'published' then raise exception 'VI_TRANSLATION_REQUIRED_WHILE_PUBLISHED' using errcode = 'P0001'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;
create trigger trg_product_tr_guard before update or delete on public.product_translations for each row execute function public.product_tr_guard();

-- ===== Bảo vệ staff =====
create or replace function public.staff_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'super_admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.active)
     and not exists (select 1 from staff where role = 'super_admin' and active and user_id <> old.user_id) then
    raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;
create trigger trg_staff_guard before update or delete on public.staff for each row execute function public.staff_guard();

-- ===== Máy trạng thái đơn hàng / báo giá =====
create or replace function public._transition_ok(p_kind text, p_from text, p_to text) returns boolean
language sql immutable as $$
  select p_from = p_to or (p_kind || ':' || p_from || '>' || p_to) = any (array[
    'order:new>confirmed','order:new>cancelled','order:confirmed>preparing','order:confirmed>cancelled',
    'order:preparing>shipping','order:preparing>cancelled','order:shipping>completed','order:shipping>returned','order:completed>returned',
    'payment:unpaid>pending_verification','payment:unpaid>paid','payment:unpaid>failed',
    'payment:pending_verification>paid','payment:pending_verification>failed','payment:pending_verification>unpaid',
    'payment:failed>unpaid','payment:failed>pending_verification','payment:paid>refunded',
    'shipping:not_shipped>in_transit','shipping:in_transit>delivered','shipping:in_transit>failed','shipping:in_transit>returned',
    'shipping:failed>in_transit','shipping:failed>returned','shipping:delivered>returned',
    'quote:new>reviewing','quote:new>failed','quote:new>closed',
    'quote:reviewing>preparing_quote','quote:reviewing>failed','quote:reviewing>closed',
    'quote:preparing_quote>quote_sent','quote:preparing_quote>failed','quote:preparing_quote>closed',
    'quote:quote_sent>negotiating','quote:quote_sent>won','quote:quote_sent>failed','quote:quote_sent>closed',
    'quote:negotiating>quote_sent','quote:negotiating>won','quote:negotiating>failed','quote:negotiating>closed',
    'quote:won>closed','quote:failed>closed','quote:failed>reviewing'])
$$;

create or replace function public.orders_transition() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not _transition_ok('order', old.status, new.status) then raise exception 'INVALID_ORDER_TRANSITION %->%', old.status, new.status using errcode = 'P0001'; end if;
    insert into order_status_history(order_id, kind, from_status, to_status, actor) values (new.id, 'order', old.status, new.status, auth.uid());
  end if;
  if new.payment_status is distinct from old.payment_status then
    if not _transition_ok('payment', old.payment_status, new.payment_status) then raise exception 'INVALID_PAYMENT_TRANSITION %->%', old.payment_status, new.payment_status using errcode = 'P0001'; end if;
    insert into order_status_history(order_id, kind, from_status, to_status, actor) values (new.id, 'payment', old.payment_status, new.payment_status, auth.uid());
  end if;
  if new.shipping_status is distinct from old.shipping_status then
    if not _transition_ok('shipping', old.shipping_status, new.shipping_status) then raise exception 'INVALID_SHIPPING_TRANSITION %->%', old.shipping_status, new.shipping_status using errcode = 'P0001'; end if;
    insert into order_status_history(order_id, kind, from_status, to_status, actor) values (new.id, 'shipping', old.shipping_status, new.shipping_status, auth.uid());
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger trg_orders_transition before update on public.orders for each row execute function public.orders_transition();

create or replace function public.quotes_transition() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not _transition_ok('quote', old.status, new.status) then raise exception 'INVALID_QUOTE_TRANSITION %->%', old.status, new.status using errcode = 'P0001'; end if;
    insert into quote_activities(quote_id, actor, type, from_status, to_status) values (new.id, auth.uid(), 'status', old.status, new.status);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into quote_activities(quote_id, actor, type, note) values (new.id, auth.uid(), 'assign', coalesce(new.assigned_to::text, 'unassigned'));
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger trg_quotes_transition before update on public.quote_requests for each row execute function public.quotes_transition();

-- ===== Audit =====
create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb; eid text; k text;
begin
  if tg_op = 'UPDATE' then
    d := '{}'::jsonb;
    for k in select key from jsonb_each(to_jsonb(new)) loop
      if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) and k not in ('updated_at') then
        d := d || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(old)->k, 'new', to_jsonb(new)->k));
      end if;
    end loop;
    if d = '{}'::jsonb then return new; end if;
  else
    d := jsonb_build_object('op', tg_op);
  end if;
  eid := coalesce(to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'id',
                  to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'user_id',
                  to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'key');
  insert into audit_logs(actor, action, entity, entity_id, diff) values (auth.uid(), lower(tg_op), tg_table_name, eid, d);
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['products','orders','quote_requests','staff','site_settings','shipping_rules','redirects','content_items','categories','brands'] loop
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ===== Bảng quyền =====
-- (dữ liệu role_permissions nằm ở db/seed_core.sql)

-- ===== RLS =====
-- Nhóm bảng danh mục/nội dung: staff đọc tất cả; ghi theo quyền; người chỉ có quyền .write (Contributor)
-- chỉ được tạo/sửa bản ở trạng thái draft — mọi trạng thái khác cần quyền .publish.
do $$ declare r record; w text; pb text; stcol boolean; wcheck text; begin
  for r in select * from (values
    ('products','products.write','products.publish',true),
    ('product_translations','products.write','products.publish',true),
    ('product_images','products.write','products.write',false),
    ('categories','products.publish','products.publish',false),
    ('category_translations','products.write','products.publish',true),
    ('brands','products.publish','products.publish',false),
    ('brand_translations','products.write','products.publish',true),
    ('attribute_defs','products.publish','products.publish',false),
    ('content_items','content.write','content.publish',true),
    ('content_translations','content.write','content.publish',true),
    ('post_categories','content.publish','content.publish',false),
    ('post_category_translations','content.write','content.publish',true),
    ('menus','content.publish','content.publish',false),
    ('home_blocks','content.publish','content.publish',false),
    ('redirects','seo.write','seo.write',false),
    ('shipping_rules','settings.write','settings.write',false),
    ('site_settings','settings.write','settings.write',false)
  ) as v(tbl, w, pb, st) loop
    w := r.w; pb := r.pb; stcol := r.st;
    execute format('alter table public.%I enable row level security', r.tbl);
    wcheck := case when stcol then format('(public.has_perm(%L) and (status = ''draft'' or public.has_perm(%L)))', w, pb)
                   else format('public.has_perm(%L)', w) end;
    execute format('create policy staff_select on public.%I for select to authenticated using (public.is_staff())', r.tbl);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (%s)', r.tbl, wcheck);
    execute format('create policy staff_update on public.%I for update to authenticated using (%s) with check (%s)', r.tbl, wcheck, wcheck);
    execute format('create policy staff_delete on public.%I for delete to authenticated using (%s)', r.tbl, wcheck);
  end loop;
end $$;

-- Đọc công khai: chỉ dữ liệu đã xuất bản / đang hoạt động
create policy pub_read on public.categories for select to anon, authenticated using (active);
create policy pub_read on public.category_translations for select to anon, authenticated using (status = 'published');
create policy pub_read on public.brands for select to anon, authenticated using (active);
create policy pub_read on public.brand_translations for select to anon, authenticated using (status = 'published');
create policy pub_read on public.attribute_defs for select to anon, authenticated using (true);
create policy pub_read on public.products for select to anon, authenticated using (status = 'published');
create policy pub_read on public.product_translations for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy pub_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy pub_read on public.post_categories for select to anon, authenticated using (active);
create policy pub_read on public.post_category_translations for select to anon, authenticated using (status = 'published');
create policy pub_read on public.content_items for select to anon, authenticated
  using (status = 'published' and (publish_at is null or publish_at <= now()));
create policy pub_read on public.content_translations for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.content_items c where c.id = item_id and c.status = 'published' and (c.publish_at is null or c.publish_at <= now())));
create policy pub_read on public.menus for select to anon, authenticated using (active);
create policy pub_read on public.home_blocks for select to anon, authenticated using (enabled);
create policy pub_read on public.redirects for select to anon, authenticated using (active);
create policy pub_read on public.shipping_rules for select to anon, authenticated using (active);
create policy pub_read on public.site_settings for select to anon, authenticated using (is_public);

-- staff / role_permissions / audit
alter table public.staff enable row level security;
create policy staff_self on public.staff for select to authenticated using (user_id = auth.uid() or public.has_perm('staff.manage'));
create policy staff_manage_ins on public.staff for insert to authenticated with check (public.has_perm('staff.manage'));
create policy staff_manage_upd on public.staff for update to authenticated using (public.has_perm('staff.manage')) with check (public.has_perm('staff.manage'));
create policy staff_manage_del on public.staff for delete to authenticated using (public.has_perm('staff.manage'));

alter table public.role_permissions enable row level security;
create policy rp_read on public.role_permissions for select to authenticated using (public.is_staff());

alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated using (public.has_perm('audit.read'));

-- Đơn hàng: KHÔNG có policy insert/delete -> chỉ tạo qua RPC create_order (service_role)
do $$ declare t text; begin
  foreach t in array array['orders','order_items','order_status_history','order_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read_orders on public.%I for select to authenticated using (public.has_perm(''orders.read''))', t);
  end loop;
end $$;
create policy upd_orders on public.orders for update to authenticated using (public.has_perm('orders.write')) with check (public.has_perm('orders.write'));
create policy ins_order_notes on public.order_notes for insert to authenticated with check (public.has_perm('orders.write') and author = auth.uid());

do $$ declare t text; begin
  foreach t in array array['quote_requests','quote_request_items','quote_activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read_quotes on public.%I for select to authenticated using (public.has_perm(''quotes.read''))', t);
  end loop;
end $$;
create policy upd_quotes on public.quote_requests for update to authenticated using (public.has_perm('quotes.write')) with check (public.has_perm('quotes.write'));
create policy ins_quote_act on public.quote_activities for insert to authenticated
  with check (public.has_perm('quotes.write') and actor = auth.uid() and type in ('note','contact'));

alter table public.contact_requests enable row level security;
create policy read_contacts on public.contact_requests for select to authenticated using (public.has_perm('contacts.read'));
create policy upd_contacts on public.contact_requests for update to authenticated using (public.has_perm('contacts.write')) with check (public.has_perm('contacts.write'));

-- ===== GRANT: thu hồi mặc định của Supabase rồi cấp tối thiểu =====
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.categories, public.category_translations, public.brands, public.brand_translations,
  public.attribute_defs, public.products, public.product_translations, public.product_images,
  public.post_categories, public.post_category_translations, public.content_items, public.content_translations,
  public.menus, public.home_blocks, public.redirects, public.shipping_rules, public.site_settings to anon;

grant select, insert, update, delete on public.categories, public.category_translations, public.brands, public.brand_translations,
  public.attribute_defs, public.products, public.product_translations, public.product_images,
  public.post_categories, public.post_category_translations, public.content_items, public.content_translations,
  public.menus, public.home_blocks, public.redirects, public.shipping_rules, public.site_settings, public.staff to authenticated;
grant select on public.role_permissions, public.audit_logs, public.order_items, public.order_status_history,
  public.quote_request_items, public.orders, public.quote_requests, public.quote_activities, public.contact_requests, public.order_notes to authenticated;
grant insert on public.order_notes, public.quote_activities to authenticated;
-- chỉ cho sửa các cột xử lý; tổng tiền/giá/khách hàng bất biến với nhân viên
grant update (status, payment_status, shipping_status, assigned_to) on public.orders to authenticated;
grant update (status, assigned_to) on public.quote_requests to authenticated;
grant update (status) on public.contact_requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.is_staff(), public.has_perm(text) to authenticated;
