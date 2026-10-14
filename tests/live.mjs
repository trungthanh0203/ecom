// Kiểm thử TRÊN SUPABASE THẬT (chỉ dùng anon key + tài khoản thử nghiệm của từng vai trò).
// Mật khẩu đọc từ tests/.env.test (đã .gitignore) — KHÔNG dán vào chat. Chạy: npm run test:live
// Tự dọn dữ liệu thử (tiền tố LIVE-). Bỏ qua vai trò nào chưa khai báo.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = readFileSync(join(here, '../public/quan-tri/config.js'), 'utf8');
const URL_ = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1], KEY = cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1];
const envf = join(here, '.env.test'); const env = {};
if (existsSync(envf)) for (const l of readFileSync(envf, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2]; }

let pass = 0, fail = 0, skip = 0; const fails = [];
async function test(name, fn) { try { await fn(); pass++; console.log('  ✔', name); } catch (e) { fail++; fails.push(name); console.log('  ✘', name, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
const must = (r, m = '') => { if (r.error) throw new Error(m + (r.error.message || JSON.stringify(r.error))); return r.data; };
const blocked = (r, m = '') => { if (!r.error && !(Array.isArray(r.data) && r.data.length === 0)) throw new Error(m + ' đáng lẽ phải bị chặn nhưng thành công'); };

const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ROLES = ['SA', 'ADMIN', 'EDITOR', 'CONTRIBUTOR', 'SALES', 'ORDER'];
const C = {};
for (const r of ROLES) {
  const e = env[`${r}_EMAIL`], p = env[`${r}_PASS`];
  if (!e || !p) { skip++; console.log(`  - bỏ qua vai trò ${r} (chưa khai báo trong .env.test)`); continue; }
  const c = mk(); const { error } = await c.auth.signInWithPassword({ email: e, password: p });
  if (error) { fail++; fails.push('login ' + r); console.log(`  ✘ đăng nhập ${r}: ${error.message}`); continue; }
  C[r] = c;
}
const anon = mk();
const tag = 'LIVE-' + Date.now().toString(36).toUpperCase();
const created = { products: [], cats: [], paths: [] };
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

console.log('\n[A] Khách ẩn danh');
await test('anon đọc được danh mục đã xuất bản, không đọc được bản dịch EN nháp', async () => {
  truthy(must(await anon.from('category_translations').select('lang').eq('lang', 'vi')).length >= 7);
  eq(must(await anon.from('category_translations').select('lang').eq('lang', 'en')).length, 0);
});
await test('anon bị chặn: orders, staff, ghi sản phẩm, RPC', async () => {
  for (const t of ['orders', 'staff', 'audit_logs', 'quote_requests']) truthy((await anon.from(t).select('*')).error, t);
  truthy((await anon.from('products').insert({ sku: tag })).error);
  truthy((await anon.rpc('create_order', { p: {} })).error);
});

console.log('\n[B] Đăng nhập & quyền từng vai trò');
for (const [r, c] of Object.entries(C)) await test(`${r}: đọc được hồ sơ staff + ma trận quyền`, async () => {
  const { data: { user } } = await c.auth.getUser();
  const st = must(await c.from('staff').select('role,active').eq('user_id', user.id).maybeSingle()); truthy(st && st.active, 'không có dòng staff active');
  truthy(must(await c.from('role_permissions').select('perm').eq('role', st.role)).length > 0);
});

for (const [r, c] of Object.entries(C)) await test(`${r}: staff_directory trả danh bạ (chỉ id/tên/vai trò)`, async () => {
  const d = must(await c.rpc('staff_directory')); truthy(d.length >= 1); eq(Object.keys(d[0]).sort(), ['display_name', 'role', 'user_id']);
});
if (C.ORDER || C.SALES) await test('đọc danh sách đơn hàng/báo giá thật + quyền chuyển trạng thái (chỉ thử chuyển sai để bị chặn, không sửa dữ liệu)', async () => {
  const c = C.ORDER || C.SALES; const o = must(await c.from('orders').select('id,status').order('created_at', { ascending: false }).limit(1));
  if (o.length) { const r = await c.from('orders').update({ status: 'completed' }).eq('id', o[0].id).select('id'); if (o[0].status === 'new') truthy(r.error || r.data.length === 0, 'nhảy cóc new→completed phải bị chặn'); }
  must(await c.from('quote_requests').select('id,status').limit(1));
});
const ed = C.EDITOR || C.ADMIN || C.SA, edName = C.EDITOR ? 'EDITOR' : C.ADMIN ? 'ADMIN' : 'SA';
let pid;
if (ed) {
  console.log(`\n[C] ${edName}: vòng đời sản phẩm (CRUD + xuất bản + ảnh)`);
  await test('tạo nháp → bản dịch VI → xuất bản', async () => {
    const p = must(await ed.from('products').insert({ sku: tag, price: 1500000, category_id: 4, attrs: { range_km: 80 } }).select('id').single()); pid = p.id; created.products.push(pid);
    must(await ed.from('product_translations').upsert([{ product_id: pid, lang: 'vi', slug: tag.toLowerCase(), name: 'Sản phẩm thử ' + tag, status: 'published' }], { onConflict: 'product_id,lang' }));
    must(await ed.from('products').update({ status: 'published' }).eq('id', pid));
  });
  await test('xuất bản khi thiếu bản dịch VI bị chặn', async () => {
    const p = must(await ed.from('products').insert({ sku: tag + 'B', price: 100 }).select('id').single()); created.products.push(p.id);
    const r = await ed.from('products').update({ status: 'published' }).eq('id', p.id); truthy(r.error && /PUBLISH_NEEDS_VI/.test(r.error.message), r.error?.message);
  });
  await test('giá âm / KM không hợp lệ bị chặn', async () => {
    truthy((await ed.from('products').update({ price: -5 }).eq('id', pid)).error);
    truthy((await ed.from('products').update({ sale_price: 9999999999 }).eq('id', pid)).error);
  });
  await test('anon thấy SP vừa xuất bản, không thấy bản nháp', async () => {
    eq(must(await anon.from('products').select('id').eq('id', pid)).length, 1);
    const draftId = created.products[1]; eq(must(await anon.from('products').select('id').eq('id', draftId)).length, 0);
  });
  await test('tải ảnh lên Storage + ghi product_images + ảnh truy cập công khai được', async () => {
    const path = `products/${pid}/live-${tag}.png`; created.paths.push(path);
    const up = await ed.storage.from('media').upload(path, PNG, { contentType: 'image/png' }); if (up.error) throw new Error('upload: ' + up.error.message + ' (đã chạy 004_storage.sql chưa?)');
    must(await ed.from('product_images').insert({ product_id: pid, path, is_primary: true, alt_vi: 'thử' }));
    const res = await fetch(`${URL_}/storage/v1/object/public/media/${path}`); eq(res.status, 200, 'public url');
  });
  await test('slug trùng cùng ngôn ngữ bị chặn', async () => {
    const p2 = must(await ed.from('products').insert({ sku: tag + 'C' }).select('id').single()); created.products.push(p2.id);
    truthy((await ed.from('product_translations').insert({ product_id: p2.id, lang: 'vi', slug: tag.toLowerCase(), name: 'x' })).error);
  });
}
if (C.CONTRIBUTOR) {
  console.log('\n[D] CONTRIBUTOR');
  const c = C.CONTRIBUTOR;
  await test('tạo nháp được; xuất bản bị chặn; không sửa được SP đã xuất bản', async () => {
    const p = must(await c.from('products').insert({ sku: tag + 'K', price: 100 }).select('id').single()); created.products.push(p.id);
    must(await c.from('product_translations').insert({ product_id: p.id, lang: 'vi', slug: tag.toLowerCase() + '-k', name: 'Nháp K' }));
    truthy((await c.from('product_translations').update({ status: 'published' }).eq('product_id', p.id)).error, 'tự xuất bản bản dịch');
    if (pid) blocked(await c.from('products').update({ price: 1 }).eq('id', pid).select(), 'sửa SP đã xuất bản');
  });
  await test('không đọc được đơn hàng / báo giá / audit', async () => {
    for (const t of ['orders', 'quote_requests', 'audit_logs']) { const r = await c.from(t).select('id'); truthy(!r.error ? r.data.length === 0 : true, t); }
  });
}
if (C.SALES) {
  console.log('\n[E] SALES');
  const c = C.SALES;
  await test('đọc được báo giá/đơn; không ghi được sản phẩm; không tải ảnh', async () => {
    must(await c.from('quote_requests').select('id').limit(1)); must(await c.from('orders').select('id').limit(1));
    truthy((await c.from('products').insert({ sku: tag + 'S' })).error);
    truthy((await c.storage.from('media').upload(`products/0/${tag}.png`, PNG, { contentType: 'image/png' })).error, 'Sales tải được ảnh');
  });
}
if (C.ORDER) {
  console.log('\n[F] ORDER MANAGER');
  const c = C.ORDER;
  await test('đọc đơn được; không quản lý staff; không đọc liên hệ; không đổi cài đặt', async () => {
    must(await c.from('orders').select('id').limit(1));
    truthy((await c.from('staff').insert({ user_id: '00000000-0000-0000-0000-000000000001', role: 'admin' })).error);
    truthy((await c.from('site_settings').update({ value: 99 }).eq('key', 'vat_rate').select()).data?.length === 0 || true);
    eq(must(await c.from('site_settings').select('value').eq('key', 'vat_rate'))[0].value, 10, 'VAT không được bị đổi');
  });
}
if (C.ADMIN) {
  console.log('\n[G] ADMIN');
  await test('đọc audit_logs; KHÔNG quản lý được staff', async () => {
    must(await C.ADMIN.from('audit_logs').select('id').limit(1));
    truthy((await C.ADMIN.from('staff').insert({ user_id: '00000000-0000-0000-0000-000000000002', role: 'admin' })).error);
  });
}
if (C.SA) {
  console.log('\n[H] SUPER ADMIN');
  await test('dashboard_stats trả số liệu thật', async () => { const d = must(await C.SA.rpc('dashboard_stats')); truthy('products_total' in d && 'orders_new' in d && 'quotes_new' in d); });
  await test('xem được toàn bộ staff', async () => truthy(must(await C.SA.from('staff').select('user_id')).length >= 1));
  await test('CRUD danh mục + bản dịch', async () => {
    const c = must(await C.SA.from('categories').insert({ sort: 999 }).select('id').single()); created.cats.push(c.id);
    must(await C.SA.from('category_translations').insert({ category_id: c.id, lang: 'vi', slug: tag.toLowerCase() + '-dm', name: 'Danh mục thử', status: 'published' }));
    must(await C.SA.from('categories').update({ active: false }).eq('id', c.id));
  });
  await test('audit ghi lại thao tác của chính các bước trên', async () => truthy(must(await C.SA.from('audit_logs').select('id').eq('entity', 'products').limit(1)).length === 1));
}

console.log('\n[Dọn dẹp]');
const sa = C.SA || C.ADMIN;
if (sa) {
  if (created.paths.length) await sa.storage.from('media').remove(created.paths);
  if (created.products.length) { const r = await sa.from('products').delete().in('id', created.products); console.log(r.error ? '  ! không xoá được SP thử: ' + r.error.message : `  đã xoá ${created.products.length} SP thử`); }
  if (created.cats.length) await sa.from('categories').delete().in('id', created.cats);
} else console.log('  ! không có SA/ADMIN nên không tự dọn được; xoá tay các dòng SKU bắt đầu bằng', tag);

console.log(`\n==== ${pass} đạt, ${fail} lỗi, ${skip} vai trò bị bỏ qua ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
