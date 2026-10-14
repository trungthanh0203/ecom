// Kiểm thử schema + RLS + nghiệp vụ trên Postgres thật (PGlite). Chạy: npm test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const db = new PGlite();

let pass = 0, fail = 0; const failures = [];
const ok = (name) => { pass++; console.log('  ✔', name); };
const bad = (name, why) => { fail++; failures.push(name); console.log('  ✘', name, '->', why); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = '') => { if (!v) throw new Error('not truthy ' + m); };
async function throws(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  if (!err) throw new Error('expected error ' + re + ' but succeeded');
  if (re && !re.test(err.message + ' ' + (err.detail || ''))) throw new Error(`error mismatch: ${err.message}`);
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function as(role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}

// ---------- setup ----------
await db.exec(read('auth_stub.sql'));
for (const f of ['001_core.sql', '002_security.sql', '003_commerce.sql']) await db.exec(read(`../db/migrations/${f}`));
await db.exec(read('../db/seed_core.sql'));
await db.exec(read('../db/seed_xe_dien.sql'));

const U = { sa: '00000000-0000-0000-0000-000000000001', adm: '00000000-0000-0000-0000-000000000002', ed: '00000000-0000-0000-0000-000000000003',
  con: '00000000-0000-0000-0000-000000000004', sales: '00000000-0000-0000-0000-000000000005', om: '00000000-0000-0000-0000-000000000006',
  nobody: '00000000-0000-0000-0000-000000000009' };
const roles = { sa: 'super_admin', adm: 'admin', ed: 'editor', con: 'contributor', sales: 'sales', om: 'order_manager' };
for (const u of Object.values(U)) await q('insert into auth.users(id) values ($1)', [u]);
for (const [k, r] of Object.entries(roles)) await q('insert into staff(user_id, role, display_name) values ($1,$2,$3)', [U[k], r, k]);

async function mkProduct({ sku, price, status = 'published', retail = true, name }) {
  const [p] = await q('insert into products(sku, price, retail_enabled, category_id) values ($1,$2,$3,4) returning id', [sku, price, retail]);
  await q("insert into product_translations(product_id, lang, slug, name, status) values ($1,'vi',$2,$3,'published')", [p.id, sku.toLowerCase(), name || 'SP ' + sku]);
  if (status !== 'draft') await q('update products set status=$2 where id=$1', [p.id, status]);
  return p.id;
}
const A = await mkProduct({ sku: 'XM-A', price: 10000000, name: 'Xe máy điện A' });
const B = await mkProduct({ sku: 'XD-B', price: 5000000, name: 'Xe đạp điện B' });
const DRAFT = await mkProduct({ sku: 'DR-1', price: 1000, status: 'draft' });
const NORETAIL = await mkProduct({ sku: 'NR-1', price: 9000000, retail: false });
await q("insert into shipping_rules(province, fee, free_over) values (null, 50000, 100000000), ('Hà Nội', 30000, 20000000)");

const goodOrder = (over = {}) => ({
  idempotency_key: 'key-' + Math.random().toString(36).slice(2) + 'xxxxxxxxxx', consent: 'true', payment_method: 'cod', lang: 'vi',
  customer: { name: 'Nguyễn Văn A', phone: '0901234567', province: 'Hà Nội', address: '12 Phố Huế' },
  items: [{ product_id: A, qty: 1 }], ...over });
const place = (o) => as('service_role', null, () => q('select create_order($1::jsonb) r', [JSON.stringify(o)]).then((r) => r[0].r));

console.log('\n[1] Ràng buộc dữ liệu');
await test('xuất bản SP bán lẻ thiếu giá bị chặn', async () => {
  const [p] = await q("insert into products(sku, price) values ('NP-1', null) returning id");
  await q("insert into product_translations(product_id, lang, slug, name, status) values ($1,'vi','np-1','x','published')", [p.id]);
  await throws(() => q("update products set status='published' where id=$1", [p.id]), /products_publish_needs_price/);
});
await test('xuất bản SP thiếu bản dịch VI đã published bị chặn', async () => {
  const [p] = await q("insert into products(sku, price) values ('NT-1', 100) returning id");
  await throws(() => q("update products set status='published' where id=$1", [p.id]), /PUBLISH_NEEDS_VI_TRANSLATION/);
});
await test('giá KM >= giá gốc, hoặc không có hạn kết thúc, bị chặn', async () => {
  await throws(() => q('update products set sale_price=10000000, sale_end=now()+interval \'1 day\' where id=$1', [A]), /products_sale_valid/);
  await throws(() => q('update products set sale_price=100 where id=$1', [A]), /products_sale_valid/);
});
await test('không gỡ bản dịch VI khi SP đang published', async () => {
  await throws(() => q("update product_translations set status='draft' where product_id=$1 and lang='vi'", [A]), /VI_TRANSLATION_REQUIRED/);
  await throws(() => q("delete from product_translations where product_id=$1 and lang='vi'", [A]), /VI_TRANSLATION_REQUIRED/);
});
await test('trùng SKU / trùng slug cùng ngôn ngữ bị chặn', async () => {
  await throws(() => q("insert into products(sku) values ('XM-A')"), /products_sku_unique|duplicate/);
  const [p] = await q("insert into products(sku) values ('SL-1') returning id");
  await throws(() => q("insert into product_translations(product_id, lang, slug, name) values ($1,'vi','xm-a','x')", [p.id]), /duplicate|unique/);
});

console.log('\n[2] Khách ẩn danh (anon)');
await test('anon chỉ thấy SP published', async () => {
  const rows = await as('anon', null, () => q('select id from products order by id'));
  eq(rows.map((r) => r.id).sort(), [A, B, NORETAIL].sort(), 'ids');
  eq((await as('anon', null, () => q('select 1 from product_translations where product_id=$1', [DRAFT]))).length, 0);
});
await test('anon không đọc được orders/quotes/staff/audit/contact', async () => {
  for (const t of ['orders', 'quote_requests', 'staff', 'audit_logs', 'contact_requests', 'order_items'])
    await throws(() => as('anon', null, () => q(`select * from ${t}`)), /permission denied/);
});
await test('anon không ghi được vào bảng nào / không gọi được RPC', async () => {
  await throws(() => as('anon', null, () => q("insert into products(sku) values ('HACK')")), /permission denied/);
  await throws(() => as('anon', null, () => q('select create_order($1::jsonb)', [JSON.stringify(goodOrder())])), /permission denied/);
  await throws(() => as('anon', null, () => q("select submit_quote('{}'::jsonb)")), /permission denied/);
  await throws(() => as('anon', null, () => q("select dashboard_stats()")), /permission denied/);
});
await test('anon chỉ thấy cài đặt công khai', async () => {
  await q("insert into site_settings(key, value, is_public) values ('internal_note','\"x\"',false)");
  const k = (await as('anon', null, () => q('select key from site_settings'))).map((r) => r.key);
  truthy(k.includes('vat_rate') && !k.includes('internal_note'));
});
await test('authenticated không phải staff không thấy bản nháp', async () => {
  const rows = await as('authenticated', U.nobody, () => q('select id from products'));
  truthy(!rows.some((r) => r.id === DRAFT));
});

console.log('\n[3] Phân quyền theo vai trò (kiểm tra ở DB, không ở UI)');
await test('Contributor tạo được nháp, KHÔNG xuất bản được', async () => {
  const [p] = await as('authenticated', U.con, () => q("insert into products(sku, price) values ('CON-1', 100) returning id"));
  await throws(() => as('authenticated', U.con, () => q("insert into products(sku, price, status) values ('CON-2', 100, 'published')")), /row-level security|PUBLISH_NEEDS_VI_TRANSLATION/);
  await as('authenticated', U.con, () => q("insert into product_translations(product_id, lang, slug, name) values ($1,'vi','con-1','Nháp')", [p.id]));
  await throws(() => as('authenticated', U.con, () => q("update product_translations set status='published' where product_id=$1", [p.id])), /row-level security/);
  await q("update product_translations set status='published' where product_id=$1", [p.id]);   // biên tập viên đã duyệt bản dịch
  await throws(() => as('authenticated', U.con, () => q("update products set status='published' where id=$1", [p.id])), /row-level security/);
});
await test('Contributor không sửa/xoá được SP đã published', async () => {
  eq((await as('authenticated', U.con, () => q('update products set price=1 where id=$1 returning id', [A]))).length, 0);
  eq((await as('authenticated', U.con, () => q('delete from products where id=$1 returning id', [A]))).length, 0);
});
await test('Editor xuất bản được SP', async () => {
  const [p] = await as('authenticated', U.ed, () => q("insert into products(sku, price) values ('ED-1', 100) returning id"));
  await as('authenticated', U.ed, () => q("insert into product_translations(product_id, lang, slug, name, status) values ($1,'vi','ed-1','Ed','published')", [p.id]));
  eq((await as('authenticated', U.ed, () => q("update products set status='published' where id=$1 returning id", [p.id]))).length, 1);
});
await test('Sales: không ghi SP, không sửa đơn; đọc được báo giá', async () => {
  eq((await as('authenticated', U.sales, () => q('update products set price=1 where id=$1 returning id', [A]))).length, 0);
  await throws(() => as('authenticated', U.sales, () => q("insert into products(sku) values ('S-1')")), /row-level security/);
  await as('authenticated', U.sales, () => q('select * from quote_requests'));
});
await test('Order Manager: không đọc contact_requests, không quản lý staff, không đổi settings', async () => {
  await q("insert into contact_requests(name, phone, message) values ('K','0901234567','hi')");
  eq((await as('authenticated', U.om, () => q('select * from contact_requests'))).length, 0);
  await throws(() => as('authenticated', U.om, () => q("insert into staff(user_id, role) values ($1,'admin')", [U.nobody])), /row-level security/);
  await throws(() => as('authenticated', U.om, () => q("insert into site_settings(key, value) values ('x','1')")), /row-level security/);
});
await test('Admin KHÔNG quản lý được staff; Super Admin được', async () => {
  await q('insert into auth.users(id) values ($1)', ['00000000-0000-0000-0000-0000000000aa']);
  await throws(() => as('authenticated', U.adm, () => q("insert into staff(user_id, role) values ('00000000-0000-0000-0000-0000000000aa','editor')")), /row-level security/);
  eq((await as('authenticated', U.sa, () => q("insert into staff(user_id, role) values ('00000000-0000-0000-0000-0000000000aa','editor') returning user_id"))).length, 1);
});
await test('Không hạ/xoá Super Admin cuối cùng', async () => {
  await throws(() => as('authenticated', U.sa, () => q("update staff set role='admin' where user_id=$1", [U.sa])), /LAST_SUPER_ADMIN/);
  await throws(() => q('delete from staff where user_id=$1', [U.sa]), /LAST_SUPER_ADMIN/);
});
await test('staff vô hiệu hoá (active=false) mất toàn bộ quyền', async () => {
  await q('update staff set active=false where user_id=$1', [U.ed]);
  await throws(() => as('authenticated', U.ed, () => q("insert into products(sku) values ('X-ED')")), /row-level security/);
  await q('update staff set active=true where user_id=$1', [U.ed]);
});

console.log('\n[4] Đặt hàng & giá (server tính)');
await test('tổng tiền = hàng + VAT(10%) + ship theo tỉnh', async () => {
  const r = await place(goodOrder({ items: [{ product_id: A, qty: 2 }, { product_id: B, qty: 1 }] }));
  // hàng 25.000.000; VAT 2.500.000; quy tắc Hà Nội: ship 30.000 nhưng miễn phí từ 20.000.000 -> 0
  eq(r.total, 25000000 + 2500000 + 0);
  const [o] = await q('select * from orders where code=$1', [r.code]);
  eq([Number(o.subtotal), Number(o.vat_amount), Number(o.shipping_fee), o.status, o.payment_status, o.shipping_status],
     [25000000, 2500000, 0, 'new', 'unpaid', 'not_shipped']);
});
await test('quy tắc mặc định + miễn phí ship khi đủ ngưỡng', async () => {
  const r1 = await place(goodOrder({ customer: { name: 'Bình', phone: '0901234567', province: 'Cần Thơ', address: '1 Nguyễn Trãi' } }));
  eq(r1.total, 10000000 + 1000000 + 50000);
  await q('update products set price=120000000 where id=$1', [NORETAIL]);
  await q('update products set retail_enabled=true where id=$1', [NORETAIL]);
  const r2 = await place(goodOrder({ items: [{ product_id: NORETAIL, qty: 1 }], customer: { name: 'Bình', phone: '0901234567', province: 'Cần Thơ', address: '1 Nguyễn Trãi' } }));
  eq(r2.total, 120000000 + 12000000 + 0);
  await q('update products set retail_enabled=false, price=9000000 where id=$1', [NORETAIL]);
});
await test('giá do trình duyệt gửi (unit_price/total) bị BỎ QUA', async () => {
  const r = await place(goodOrder({ total: 1, subtotal: 1, items: [{ product_id: A, qty: 1, unit_price: 1, price: 1, line_total: 1 }] }));
  eq(r.total, 10000000 + 1000000 + 30000);
});
await test('gửi lại cùng idempotency_key không tạo đơn thứ hai', async () => {
  const o = goodOrder(); const r1 = await place(o); const r2 = await place(o);
  eq([r1.duplicate, r2.duplicate, r1.code === r2.code], [false, true, true]);
  eq((await q('select count(*)::int c from orders where idempotency_key=$1', [o.idempotency_key]))[0].c, 1);
});
await test('gửi song song cùng key: chỉ 1 đơn', async () => {
  const o = goodOrder();
  const rs = await Promise.allSettled([place(o), place(o), place(o)]);
  eq((await q('select count(*)::int c from orders where idempotency_key=$1', [o.idempotency_key]))[0].c, 1);
  truthy(rs.every((r) => r.status === 'fulfilled'));
});
await test('SP nháp / không bán lẻ / không tồn tại bị từ chối (CART_INVALID)', async () => {
  for (const pid of [DRAFT, NORETAIL, 99999])
    await throws(() => place(goodOrder({ items: [{ product_id: pid, qty: 1 }] })), /CART_INVALID/);
});
await test('số lượng / dữ liệu sai bị từ chối', async () => {
  for (const it of [{ product_id: A, qty: 0 }, { product_id: A, qty: 1000 }, { product_id: A, qty: 'abc' }, { product_id: 'x', qty: 1 }, { qty: 1 }])
    await throws(() => place(goodOrder({ items: [it] })), /INVALID_ITEM/);
  await throws(() => place(goodOrder({ items: [] })), /EMPTY_CART/);
  await throws(() => place(goodOrder({ items: [{ product_id: A, qty: 600 }, { product_id: A, qty: 600 }] })), /CART_INVALID/);
});
await test('thiếu đồng ý / sai thông tin khách / sai phương thức bị từ chối', async () => {
  await throws(() => place(goodOrder({ consent: 'false' })), /CONSENT_REQUIRED/);
  await throws(() => place(goodOrder({ payment_method: 'bitcoin' })), /INVALID_PAYMENT_METHOD/);
  await throws(() => place(goodOrder({ customer: { name: 'A', phone: 'abc', province: 'HN', address: 'x' } })), /INVALID_CUSTOMER/);
  await throws(() => place(goodOrder({ idempotency_key: 'short' })), /INVALID_IDEMPOTENCY_KEY/);
});
await test('giá KM chỉ áp dụng trong thời hạn', async () => {
  const S = await mkProduct({ sku: 'SALE-1', price: 1000000 });
  await q("update products set sale_price=800000, sale_start=now()-interval '1 day', sale_end=now()+interval '1 day' where id=$1", [S]);
  const a = await as('service_role', null, () => q('select cart_quote($1::jsonb,$2,$3) r', [JSON.stringify([{ product_id: S, qty: 1 }]), 'vi', 'Hà Nội']));
  eq(Number(a[0].r.subtotal), 800000);
  await q("update products set sale_price=800000, sale_start=now()-interval '3 day', sale_end=now()-interval '1 day' where id=$1", [S]);
  const b = await as('service_role', null, () => q('select cart_quote($1::jsonb,$2,$3) r', [JSON.stringify([{ product_id: S, qty: 1 }]), 'vi', 'Hà Nội']));
  eq(Number(b[0].r.subtotal), 1000000);
  await q("update products set sale_price=800000, sale_start=now()+interval '1 day', sale_end=now()+interval '3 day' where id=$1", [S]);
  const c = await as('service_role', null, () => q('select cart_quote($1::jsonb,$2,$3) r', [JSON.stringify([{ product_id: S, qty: 1 }]), 'vi', 'Hà Nội']));
  eq(Number(c[0].r.subtotal), 1000000);
});
await test('đơn lưu snapshot: đổi giá/tên sau đó không đổi đơn cũ', async () => {
  const r = await place(goodOrder({ items: [{ product_id: B, qty: 1 }] }));
  await q('update products set price=7777777 where id=$1', [B]);
  await q("update product_translations set name='Tên mới' where product_id=$1 and lang='vi'", [B]);
  const [it] = await q('select i.* from order_items i join orders o on o.id=i.order_id where o.code=$1', [r.code]);
  eq([Number(it.unit_price), it.name, it.sku], [5000000, 'Xe đạp điện B', 'XD-B']);
  await q('update products set price=5000000 where id=$1', [B]);
});
await test('trang xác nhận cần đúng mã + số điện thoại', async () => {
  const r = await place(goodOrder());
  const good = await as('service_role', null, () => q('select order_lookup($1,$2) r', [r.code, '0901 234 567']));
  eq(good[0].r.code, r.code);
  const wrong = await as('service_role', null, () => q('select order_lookup($1,$2) r', [r.code, '0999999999']));
  eq(wrong[0].r, null);
});
await test('authenticated/anon không gọi được cart_quote/create_order', async () => {
  await throws(() => as('authenticated', U.sa, () => q('select create_order($1::jsonb)', [JSON.stringify(goodOrder())])), /permission denied/);
  await throws(() => as('authenticated', U.sa, () => q("select cart_quote('[]'::jsonb)")), /permission denied/);
});

console.log('\n[5] Xử lý đơn hàng trong CMS');
const [ord] = await q("select id, code from orders where status='new' order by created_at limit 1");
await test('nhân viên không sửa được tổng tiền / thông tin khách (cột bất biến)', async () => {
  await throws(() => as('authenticated', U.om, () => q('update orders set total=1 where id=$1', [ord.id])), /permission denied/);
  await throws(() => as('authenticated', U.om, () => q("update orders set phone='0' where id=$1", [ord.id])), /permission denied/);
  await throws(() => as('authenticated', U.om, () => q('delete from orders where id=$1', [ord.id])), /permission denied/);
  await throws(() => as('authenticated', U.om, () => q("insert into orders(code, idempotency_key, payment_method, recipient_name, phone, province, address_line, subtotal, vat_rate, vat_amount, shipping_fee, total) values ('X','k','cod','a','b','c','d',1,1,1,1,1)")), /permission denied/);
});
await test('Sales chỉ đọc đơn, không sửa; Contributor không đọc đơn', async () => {
  eq((await as('authenticated', U.sales, () => q('update orders set status=\'confirmed\' where id=$1 returning id', [ord.id]))).length, 0);
  eq((await as('authenticated', U.con, () => q('select id from orders'))).length, 0);
});
await test('chuyển trạng thái hợp lệ ghi lịch sử; không nhảy cóc', async () => {
  await throws(() => as('authenticated', U.om, () => q("update orders set status='completed' where id=$1", [ord.id])), /INVALID_ORDER_TRANSITION/);
  await as('authenticated', U.om, () => q("update orders set status='confirmed' where id=$1", [ord.id]));
  const h = await q("select kind, from_status, to_status, actor from order_status_history where order_id=$1 and from_status is not null", [ord.id]);
  eq([h[0].kind, h[0].from_status, h[0].to_status, h[0].actor], ['order', 'new', 'confirmed', U.om]);
});
await test('trạng thái đơn TÁCH trạng thái thanh toán: hoàn thành ≠ đã thanh toán', async () => {
  for (const s of ['preparing', 'shipping', 'completed']) await as('authenticated', U.om, () => q('update orders set status=$2 where id=$1', [ord.id, s]));
  const [o] = await q('select status, payment_status from orders where id=$1', [ord.id]);
  eq([o.status, o.payment_status], ['completed', 'unpaid']);
  const st = await as('authenticated', U.om, () => q('select dashboard_stats() s'));
  eq(Number(st[0].s.revenue_paid), 0, 'doanh thu không cộng đơn chưa thanh toán');
  await as('authenticated', U.om, () => q("update orders set payment_status='paid' where id=$1", [ord.id]));
  const st2 = await as('authenticated', U.om, () => q('select dashboard_stats() s'));
  truthy(Number(st2[0].s.revenue_paid) > 0, 'doanh thu cộng đơn đã thanh toán');
  await throws(() => as('authenticated', U.om, () => q("update orders set payment_status='unpaid' where id=$1", [ord.id])), /INVALID_PAYMENT_TRANSITION/);
});
await test('ghi chú nội bộ + phân công đơn', async () => {
  await as('authenticated', U.om, () => q("insert into order_notes(order_id, author, note) values ($1,$2,'Đã gọi khách')", [ord.id, U.om]));
  await throws(() => as('authenticated', U.om, () => q("insert into order_notes(order_id, author, note) values ($1,$2,'giả mạo')", [ord.id, U.sa])), /row-level security/);
  await throws(() => as('authenticated', U.sales, () => q("insert into order_notes(order_id, author, note) values ($1,$2,'x')", [ord.id, U.sales])), /row-level security/);
});

console.log('\n[6] Báo giá B2B (tách khỏi đơn hàng)');
const goodQuote = (over = {}) => ({ idempotency_key: 'qk-' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx', consent: 'true', lang: 'vi',
  contact_name: 'Trần B', company: 'Công ty ABC', phone: '0912345678', email: 'b@abc.vn', delivery_area: 'Đà Nẵng',
  items: [{ product_id: A, qty: 50, unit: 'chiếc' }, { name: 'Pin lithium 72V tuỳ chỉnh', qty: 200, unit: 'bộ' }], ...over });
const quote = (o) => as('service_role', null, () => q('select submit_quote($1::jsonb) r', [JSON.stringify(o)]).then((r) => r[0].r));
let qr;
await test('gửi báo giá nhiều SP (có SP trong hệ thống + SP tự do) và lưu snapshot', async () => {
  qr = await quote(goodQuote());
  eq([qr.duplicate, qr.items], [false, 2]);
  const items = await q('select i.sku, i.name, i.qty from quote_request_items i join quote_requests r on r.id=i.quote_id where r.code=$1 order by i.id', [qr.code]);
  eq(items.map((x) => [x.sku, x.name, x.qty]), [['XM-A', 'Xe máy điện A', 50], [null, 'Pin lithium 72V tuỳ chỉnh', 200]]);
});
await test('báo giá: idempotent, bắt buộc đồng ý, từ chối SP nháp & dữ liệu sai', async () => {
  const o = goodQuote(); const a = await quote(o); const b = await quote(o);
  eq([a.code === b.code, b.duplicate], [true, true]);
  await throws(() => quote(goodQuote({ consent: 'false' })), /CONSENT_REQUIRED/);
  await throws(() => quote(goodQuote({ items: [{ product_id: DRAFT, qty: 1 }] })), /QUOTE_PRODUCT_UNAVAILABLE/);
  await throws(() => quote(goodQuote({ items: [{ name: 'x', qty: 0 }] })), /INVALID_QUOTE_ITEMS/);
  await throws(() => quote(goodQuote({ email: 'khong-hop-le' })), /INVALID_QUOTE_FIELDS/);
});
await test('Sales xử lý báo giá: chuyển trạng thái hợp lệ, phân công, ghi chú, lịch sử', async () => {
  const [row] = await q('select id from quote_requests where code=$1', [qr.code]);
  await throws(() => as('authenticated', U.sales, () => q("update quote_requests set status='won' where id=$1", [row.id])), /INVALID_QUOTE_TRANSITION/);
  await as('authenticated', U.sales, () => q("update quote_requests set status='reviewing', assigned_to=$2 where id=$1", [row.id, U.sales]));
  await as('authenticated', U.sales, () => q("insert into quote_activities(quote_id, actor, type, note) values ($1,$2,'note','Đã gọi, hẹn gửi giá thứ Hai')", [row.id, U.sales]));
  await throws(() => as('authenticated', U.sales, () => q("insert into quote_activities(quote_id, actor, type, note) values ($1,$2,'status','giả lịch sử')", [row.id, U.sales])), /row-level security/);
  const acts = await q('select type from quote_activities where quote_id=$1 order by id', [row.id]);
  eq(acts.map((a) => a.type), ['status', 'status', 'assign', 'note']);
});
await test('KHÔNG có đường tự chuyển báo giá thành đơn hàng', async () => {
  const [row] = await q('select id from quote_requests where code=$1', [qr.code]);
  const before = (await q('select count(*)::int c from orders'))[0].c;
  for (const s of ['preparing_quote', 'quote_sent', 'won']) await as('authenticated', U.sales, () => q('update quote_requests set status=$2 where id=$1', [row.id, s]));
  eq((await q('select count(*)::int c from orders'))[0].c, before);
});
await test('Contributor không đọc được báo giá; Order Manager đọc nhưng không sửa', async () => {
  eq((await as('authenticated', U.con, () => q('select id from quote_requests'))).length, 0);
  truthy((await as('authenticated', U.om, () => q('select id from quote_requests'))).length > 0);
  const [row] = await q('select id from quote_requests limit 1');
  eq((await as('authenticated', U.om, () => q("update quote_requests set assigned_to=$2 where id=$1 returning id", [row.id, U.om]))).length, 0);
});

console.log('\n[7] Liên hệ, audit, dashboard');
await test('form liên hệ cần đồng ý + ít nhất SĐT hoặc email', async () => {
  await as('service_role', null, () => q("select submit_contact('{\"name\":\"Lan\",\"phone\":\"0901112223\",\"message\":\"Cần tư vấn\",\"consent\":\"true\"}'::jsonb)"));
  await throws(() => as('service_role', null, () => q("select submit_contact('{\"name\":\"Lan\",\"message\":\"Cần tư vấn\",\"consent\":\"true\"}'::jsonb)")), /INVALID_CONTACT_FIELDS/);
  await throws(() => as('service_role', null, () => q("select submit_contact('{\"name\":\"Lan\",\"phone\":\"0901112223\",\"message\":\"x ok\"}'::jsonb)")), /CONSENT_REQUIRED/);
});
await test('audit log ghi thay đổi quan trọng; chỉ Admin trở lên đọc được', async () => {
  await as('authenticated', U.ed, () => q("update products set featured=true where id=$1", [B]));
  const rows = await as('authenticated', U.adm, () => q("select actor, diff from audit_logs where entity='products' and entity_id=$1 and action='update' order by id desc limit 1", [String(B)]));
  eq([rows[0].actor, rows[0].diff.featured.new], [U.ed, true]);
  eq((await as('authenticated', U.sales, () => q('select * from audit_logs'))).length, 0);
});
await test('dashboard_stats theo quyền: Sales thấy báo giá không thấy đơn; Contributor chỉ thấy SP', async () => {
  const s = (await as('authenticated', U.sales, () => q('select dashboard_stats() s')))[0].s;
  truthy('quotes_new' in s && 'orders_new' in s && !('products_total' in {}) , 'sales có orders.read nên thấy đơn');
  const c = (await as('authenticated', U.con, () => q('select dashboard_stats() s')))[0].s;
  truthy('products_total' in c && !('orders_new' in c) && !('quotes_new' in c));
  await throws(() => as('authenticated', U.nobody, () => q('select dashboard_stats()')), /FORBIDDEN/);
});
await test('seed xe điện: 7 danh mục, VI published, EN là dịch máy ở trạng thái nháp', async () => {
  eq((await q("select count(*)::int c from category_translations where lang='vi' and status='published'"))[0].c, 7);
  eq((await q("select count(*)::int c from category_translations where lang='en' and status='draft' and machine_translated")).at(0).c, 7);
  const en = await as('anon', null, () => q("select * from category_translations where lang='en'"));
  eq(en.length, 0);
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', failures.join(' | ')); process.exit(1); }
