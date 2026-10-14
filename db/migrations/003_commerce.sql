-- 003_commerce.sql — nghiệp vụ tiền/đơn/báo giá. Mọi hàm ở đây CHỈ cấp quyền cho service_role
-- (Cloudflare Worker gọi sau khi qua Turnstile + rate-limit). Trình duyệt không bao giờ quyết định giá.

create or replace function public._setting_num(k text, d numeric) returns numeric
language sql stable security definer set search_path = public as
$$ select coalesce((select (value #>> '{}')::numeric from site_settings where key = k), d) $$;

create or replace function public._new_code(prefix text) returns text language sql volatile as
$$ select prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)) $$;

-- Tính giá giỏ hàng từ DB. Đầu vào CHỈ {product_id, qty}; mọi trường khác (vd unit_price) bị bỏ qua.
create or replace function public.cart_quote(p_items jsonb, p_lang text default 'vi', p_province text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e jsonb; v_rate numeric; v_sub numeric := 0; v_ship numeric := 0; v_vat numeric; v_items jsonb; v_problems jsonb;
  v_rule record; v_pid bigint; v_qty int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'product_id','') !~ '^[0-9]{1,18}$' or coalesce(e->>'qty','') !~ '^[0-9]{1,4}$'
       or (e->>'qty')::int not between 1 and 999 then
      raise exception 'INVALID_ITEM' using errcode = 'P0001';
    end if;
  end loop;

  with req as (
    select (x->>'product_id')::bigint as pid, sum((x->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) x group by 1
  ), priced as (
    select r.pid, p.sku, coalesce(tl.name, tv.name, p.sku) as name, p.price as list_price,
           case when p.sale_price is not null and now() >= coalesce(p.sale_start, '-infinity'::timestamptz) and now() < p.sale_end
                then p.sale_price else p.price end as unit_price,
           r.qty,
           case when p.id is null then 'NOT_FOUND'
                when p.status <> 'published' then 'UNAVAILABLE'
                when not p.retail_enabled then 'NOT_FOR_RETAIL'
                when p.price is null or p.price <= 0 then 'NO_PRICE'
                when r.qty > 999 then 'QTY_LIMIT' end as problem
    from req r
    left join products p on p.id = r.pid
    left join product_translations tl on tl.product_id = p.id and tl.lang = p_lang and tl.status = 'published'
    left join product_translations tv on tv.product_id = p.id and tv.lang = 'vi' and tv.status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pid, 'sku', sku, 'name', name, 'list_price', list_price,
           'unit_price', unit_price, 'qty', qty, 'line_total', unit_price * qty, 'problem', problem) order by pid), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('product_id', pid, 'problem', problem)) filter (where problem is not null), '[]'::jsonb),
         coalesce(sum(unit_price * qty) filter (where problem is null), 0)
    into v_items, v_problems, v_sub
  from priced;

  v_rate := _setting_num('vat_rate', 10);              -- giá niêm yết CHƯA gồm VAT
  v_vat := round(v_sub * v_rate / 100);
  select * into v_rule from shipping_rules
    where active and p_province is not null and lower(province) = lower(trim(p_province)) limit 1;
  if not found then select * into v_rule from shipping_rules where active and province is null limit 1; end if;
  if found then
    v_ship := case when v_rule.free_over is not null and v_sub >= v_rule.free_over then 0 else v_rule.fee end;
  end if;
  return jsonb_build_object('items', v_items, 'problems', v_problems, 'subtotal', v_sub, 'vat_rate', v_rate,
                            'vat_amount', v_vat, 'shipping_fee', v_ship, 'total', v_sub + v_vat + v_ship, 'currency', 'VND');
end $$;

create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_key text := p->>'idempotency_key'; c jsonb := p->'customer'; v_lang text := coalesce(p->>'lang', 'vi');
  v_pm text := p->>'payment_method'; q jsonb; v_id uuid; v_code text; v_exist orders; i int := 0; it jsonb;
begin
  if v_key is null or length(v_key) not between 16 and 100 then raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = 'P0001'; end if;
  select * into v_exist from orders where idempotency_key = v_key;
  if found then return jsonb_build_object('code', v_exist.code, 'total', v_exist.total, 'duplicate', true); end if;

  if coalesce(p->>'consent','') <> 'true' then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  if v_pm not in ('cod','bank_transfer') then raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001'; end if;
  if v_lang !~ '^[a-z]{2}$' then raise exception 'INVALID_LANG' using errcode = 'P0001'; end if;
  if c is null or jsonb_typeof(c) <> 'object'
     or length(trim(coalesce(c->>'name',''))) not between 2 and 120
     or coalesce(c->>'phone','') !~ '^[0-9+ ().-]{8,20}$'
     or length(trim(coalesce(c->>'province',''))) not between 2 and 100
     or length(trim(coalesce(c->>'address',''))) not between 5 and 300
     or (c->>'email' is not null and c->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
     or length(coalesce(p->>'note','')) > 1000 then
    raise exception 'INVALID_CUSTOMER' using errcode = 'P0001';
  end if;

  q := cart_quote(p->'items', v_lang, c->>'province');
  if jsonb_array_length(q->'problems') > 0 then
    raise exception 'CART_INVALID' using errcode = 'P0001', detail = (q->'problems')::text;
  end if;

  loop
    v_code := _new_code('DH'); i := i + 1;
    exit when not exists (select 1 from orders where code = v_code) or i > 5;
  end loop;
  begin
    insert into orders(code, idempotency_key, payment_method, recipient_name, phone, email, province, ward, address_line, note, lang,
                       subtotal, vat_rate, vat_amount, shipping_fee, total)
    values (v_code, v_key, v_pm, trim(c->>'name'), trim(c->>'phone'), nullif(trim(c->>'email'), ''), trim(c->>'province'),
            nullif(trim(c->>'ward'), ''), trim(c->>'address'), nullif(trim(p->>'note'), ''), v_lang,
            (q->>'subtotal')::numeric, (q->>'vat_rate')::numeric, (q->>'vat_amount')::numeric, (q->>'shipping_fee')::numeric, (q->>'total')::numeric)
    returning id into v_id;
  exception when unique_violation then
    -- gửi trùng song song: trả lại đơn đã tạo
    select * into v_exist from orders where idempotency_key = v_key;
    if found then return jsonb_build_object('code', v_exist.code, 'total', v_exist.total, 'duplicate', true); end if;
    raise;
  end;
  for it in select * from jsonb_array_elements(q->'items') loop
    insert into order_items(order_id, product_id, sku, name, list_price, unit_price, qty, line_total)
    values (v_id, (it->>'product_id')::bigint, it->>'sku', it->>'name', (it->>'list_price')::numeric,
            (it->>'unit_price')::numeric, (it->>'qty')::int, (it->>'line_total')::numeric);
  end loop;
  insert into order_status_history(order_id, kind, from_status, to_status) values (v_id, 'order', null, 'new');
  return jsonb_build_object('code', v_code, 'total', (q->>'total')::numeric, 'duplicate', false);
end $$;

-- Trang xác nhận đơn: cần cả mã đơn VÀ số điện thoại để tránh lộ thông tin khách
create or replace function public.order_lookup(p_code text, p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', o.code, 'status', o.status, 'payment_status', o.payment_status, 'payment_method', o.payment_method,
           'recipient_name', o.recipient_name, 'province', o.province, 'address_line', o.address_line,
           'subtotal', o.subtotal, 'vat_rate', o.vat_rate, 'vat_amount', o.vat_amount, 'shipping_fee', o.shipping_fee, 'total', o.total,
           'created_at', o.created_at,
           'items', (select jsonb_agg(jsonb_build_object('sku', i.sku, 'name', i.name, 'unit_price', i.unit_price, 'qty', i.qty, 'line_total', i.line_total) order by i.id)
                     from order_items i where i.order_id = o.id))
  from orders o where o.code = upper(trim(p_code)) and regexp_replace(o.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
$$;

create or replace function public.submit_quote(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_key text := p->>'idempotency_key'; v_lang text := coalesce(p->>'lang', 'vi'); v_id uuid; v_code text; v_exist quote_requests;
  it jsonb; v_pid bigint; v_sku text; v_name text; n int := 0; i int := 0;
begin
  if v_key is null or length(v_key) not between 16 and 100 then raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = 'P0001'; end if;
  select * into v_exist from quote_requests where idempotency_key = v_key;
  if found then return jsonb_build_object('code', v_exist.code, 'duplicate', true); end if;
  if coalesce(p->>'consent','') <> 'true' then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  if v_lang !~ '^[a-z]{2}$' then raise exception 'INVALID_LANG' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p->>'contact_name',''))) not between 2 and 120
     or length(trim(coalesce(p->>'company',''))) not between 2 and 200
     or coalesce(p->>'phone','') !~ '^[0-9+ ().-]{8,20}$'
     or coalesce(p->>'email','') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(coalesce(p->>'message','')) > 3000
     or length(coalesce(p->>'tax_code','')) > 20 then
    raise exception 'INVALID_QUOTE_FIELDS' using errcode = 'P0001';
  end if;
  if p->'items' is null or jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') not between 1 and 50 then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode = 'P0001';
  end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if coalesce(it->>'qty','') !~ '^[0-9]{1,9}$' or (it->>'qty')::bigint < 1
       or (it->>'product_id' is null and length(trim(coalesce(it->>'name',''))) < 2)
       or (it->>'product_id' is not null and it->>'product_id' !~ '^[0-9]{1,18}$')
       or length(coalesce(it->>'unit','')) > 30 then
      raise exception 'INVALID_QUOTE_ITEMS' using errcode = 'P0001';
    end if;
  end loop;

  loop
    v_code := _new_code('BG'); i := i + 1;
    exit when not exists (select 1 from quote_requests where code = v_code) or i > 5;
  end loop;
  begin
    insert into quote_requests(code, idempotency_key, contact_name, company, phone, email, tax_code, delivery_area, expected_time, message, lang, source)
    values (v_code, v_key, trim(p->>'contact_name'), trim(p->>'company'), trim(p->>'phone'), trim(p->>'email'), nullif(trim(p->>'tax_code'), ''),
            nullif(trim(p->>'delivery_area'), ''), nullif(trim(p->>'expected_time'), ''), nullif(trim(p->>'message'), ''), v_lang,
            left(p->>'source', 200))
    returning id into v_id;
  exception when unique_violation then
    select * into v_exist from quote_requests where idempotency_key = v_key;
    if found then return jsonb_build_object('code', v_exist.code, 'duplicate', true); end if;
    raise;
  end;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_pid := null; v_sku := null; v_name := trim(it->>'name');
    if it->>'product_id' is not null then
      select p2.id, p2.sku, coalesce(t.name, p2.sku) into v_pid, v_sku, v_name
      from products p2 left join product_translations t on t.product_id = p2.id and t.lang = 'vi' and t.status = 'published'
      where p2.id = (it->>'product_id')::bigint and p2.status = 'published';
      if v_pid is null then raise exception 'QUOTE_PRODUCT_UNAVAILABLE' using errcode = 'P0001'; end if;
    end if;
    insert into quote_request_items(quote_id, product_id, sku, name, qty, unit)
    values (v_id, v_pid, v_sku, v_name, (it->>'qty')::int, nullif(trim(it->>'unit'), ''));
    n := n + 1;
  end loop;
  insert into quote_activities(quote_id, type, to_status, note) values (v_id, 'status', 'new', 'Tiếp nhận yêu cầu');
  return jsonb_build_object('code', v_code, 'duplicate', false, 'items', n);
end $$;

create or replace function public.submit_contact(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  if coalesce(p->>'consent','') <> 'true' then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p->>'name',''))) not between 2 and 120
     or length(trim(coalesce(p->>'message',''))) not between 3 and 3000
     or (coalesce(p->>'phone','') = '' and coalesce(p->>'email','') = '')
     or (p->>'phone' is not null and p->>'phone' !~ '^[0-9+ ().-]{8,20}$')
     or (p->>'email' is not null and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'INVALID_CONTACT_FIELDS' using errcode = 'P0001';
  end if;
  insert into contact_requests(name, phone, email, message, lang)
  values (trim(p->>'name'), nullif(trim(p->>'phone'), ''), nullif(trim(p->>'email'), ''), trim(p->>'message'), coalesce(p->>'lang', 'vi'))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Dashboard CMS: số liệu thật; doanh thu chỉ cộng đơn ĐÃ xác nhận thanh toán và chưa huỷ
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_staff() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  r := jsonb_build_object(
    'products_total', (select count(*) from products),
    'products_selling', (select count(*) from products where status = 'published' and retail_enabled),
    'content_pending', (select count(*) from content_items where status = 'draft')
                     + (select count(*) from content_translations where status in ('draft','reviewed')));
  if has_perm('orders.read') then
    r := r || jsonb_build_object(
      'orders_new', (select count(*) from orders where status = 'new'),
      'orders_by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from orders group by 1) s), '{}'::jsonb),
      'revenue_paid', (select coalesce(sum(total), 0) from orders where payment_status = 'paid' and status <> 'cancelled'));
  end if;
  if has_perm('quotes.read') then
    r := r || jsonb_build_object('quotes_new', (select count(*) from quote_requests where status = 'new'));
  end if;
  return r;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_staff(), public.has_perm(text), public.dashboard_stats() to authenticated;
grant execute on function public.cart_quote(jsonb, text, text), public.create_order(jsonb), public.order_lookup(text, text),
  public.submit_quote(jsonb), public.submit_contact(jsonb) to service_role;
