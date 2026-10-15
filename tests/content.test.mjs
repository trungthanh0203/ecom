// Kiểm thử module nội dung (trang/tin/dịch vụ/chính sách) trên Postgres thật (PGlite): RLS công khai, quyền, slug dành riêng.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), read = (p) => readFileSync(join(here, p), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
async function throws(fn, re) { let e; try { await fn(); } catch (x) { e = x; } if (!e) throw new Error('expected error ' + re); if (re && !re.test(e.message)) throw new Error('error mismatch: ' + e.message); }
const q = async (s, p) => (await db.query(s, p)).rows;
async function as(role, uid, fn) { await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); } }

await db.exec(read('auth_stub.sql'));
for (const f of ['001_core.sql', '002_security.sql', '003_commerce.sql', '005_staff_directory.sql', '006_content_guard.sql', '007_menus_blocks_guard.sql']) await db.exec(read(`../db/migrations/${f}`));
await db.exec(read('../db/seed_core.sql'));
const U = { ed: '00000000-0000-0000-0000-000000000003', con: '00000000-0000-0000-0000-000000000004', sales: '00000000-0000-0000-0000-000000000005' };
for (const [k, r] of [['ed', 'editor'], ['con', 'contributor'], ['sales', 'sales']]) { await q('insert into auth.users(id) values ($1)', [U[k]]); await q('insert into staff(user_id, role) values ($1,$2)', [U[k], r]); }

async function mk(kind, slug, { status = 'published', publish_at = null, trStatus = 'published' } = {}) {
  const [i] = await q('insert into content_items(kind, status, publish_at) values ($1,$2,$3) returning id', [kind, status, publish_at]);
  await q("insert into content_translations(item_id, lang, slug, title, body, status) values ($1,'vi',$2,$3,'<p>x</p>',$4)", [i.id, slug, 'Tiêu đề ' + slug, trStatus]);
  return i.id;
}
const pub = (sql, p) => as('anon', null, () => q(sql, p));

console.log('\n[1] Slug dành riêng cho trang');
await test('trang không được dùng slug trùng đường dẫn hệ thống', async () => {
  for (const s of ['san-pham', 'products', 'gio-hang', 'thanh-toan', 'lien-he', 'tin-tuc', 'dich-vu', 'chinh-sach', 'api', 'quan-tri', 'vi', 'en'])
    await throws(() => mk('page', s), /RESERVED_SLUG/);
});
await test('trang slug hợp lệ OK; kind khác (tin/chính sách) không bị chặn vì nằm dưới tiền tố riêng', async () => {
  await mk('page', 'gioi-thieu'); await mk('post', 'san-pham'); await mk('policy', 'lien-he');
});
await test('đổi kind sang page khi slug đang trùng bị chặn', async () => {
  const id = await mk('post', 'cart'); await throws(() => q("update content_items set kind='page' where id=$1", [id]), /RESERVED_SLUG/);
});
await test('không đổi slug sang slug dành riêng được', async () => {
  const id = await mk('page', 've-chung-toi'); await throws(() => q("update content_translations set slug='checkout' where item_id=$1", [id]), /RESERVED_SLUG/);
});

console.log('\n[2] Hiển thị công khai (RLS)');
const P1 = await mk('post', 'bai-da-xuat-ban'), P2 = await mk('post', 'bai-nhap', { status: 'draft' }), P3 = await mk('post', 'bai-hen-gio', { publish_at: new Date(Date.now() + 86400000).toISOString() });
const P4 = await mk('post', 'bai-dich-chua-duyet', { trStatus: 'draft' }), P5 = await mk('post', 'bai-da-gui-di', { publish_at: new Date(Date.now() - 86400000).toISOString() }), P6 = await mk('post', 'bai-luu-tru', { status: 'archived' });
await test('anon chỉ thấy bài đã xuất bản + đã đến giờ + bản dịch đã xuất bản', async () => {
  const slugs = (await pub("select slug from content_translations where lang='vi' and slug like 'bai-%' order by slug")).map((r) => r.slug);
  eq(slugs, ['bai-da-gui-di', 'bai-da-xuat-ban']);
});
await test('bài nháp / hẹn giờ tương lai / lưu trữ / bản dịch nháp đều ẩn với anon', async () => {
  eq((await pub('select id from content_items where id = any($1)', [[P2, P3, P6]])).length, 0);
  eq((await pub('select item_id from content_translations where item_id = $1', [P4])).length, 0);
});
await test('gỡ bài (archived) làm bản dịch đã xuất bản cũng biến mất khỏi anon', async () => {
  await q("update content_items set status='archived' where id=$1", [P1]);
  eq((await pub('select item_id from content_translations where item_id = $1', [P1])).length, 0);
  await q("update content_items set status='published' where id=$1", [P1]);
});
await test('truy vấn nhúng như Worker dùng: dịch + item, lọc theo loại, hoạt động dưới anon', async () => {
  const r = await pub("select t.slug, i.kind from content_translations t join content_items i on i.id = t.item_id where t.lang='vi' and i.kind='post' and t.slug like 'bai-%' order by i.created_at desc");
  eq(r.length, 2);
});

console.log('\n[3] Quyền biên soạn');
await test('Contributor tạo nháp được, KHÔNG xuất bản được, KHÔNG sửa bài đã xuất bản', async () => {
  const [i] = await as('authenticated', U.con, () => q("insert into content_items(kind) values ('post') returning id"));
  await as('authenticated', U.con, () => q("insert into content_translations(item_id, lang, slug, title) values ($1,'vi','bai-cua-con','x')", [i.id]));
  await throws(() => as('authenticated', U.con, () => q("update content_items set status='published' where id=$1", [i.id])), /row-level security/);
  await throws(() => as('authenticated', U.con, () => q("update content_translations set status='published' where item_id=$1", [i.id])), /row-level security/);
  eq((await as('authenticated', U.con, () => q('update content_items set sort=9 where id=$1 returning id', [P1]))).length, 0);
});
await test('Editor xuất bản được; Sales không ghi được nội dung', async () => {
  const [i] = await as('authenticated', U.ed, () => q("insert into content_items(kind, status) values ('service','published') returning id"));
  await as('authenticated', U.ed, () => q("insert into content_translations(item_id, lang, slug, title, status) values ($1,'vi','dich-vu-a','A','published')", [i.id]));
  await throws(() => as('authenticated', U.sales, () => q("insert into content_items(kind) values ('post')")), /row-level security/);
});
await test('danh mục tin: anon chỉ thấy danh mục đang hoạt động có bản dịch đã xuất bản', async () => {
  const [c1] = await q('insert into post_categories(active) values (true) returning id'), [c2] = await q('insert into post_categories(active) values (false) returning id');
  await q("insert into post_category_translations(post_category_id, lang, slug, name, status) values ($1,'vi','tin-cong-ty','Tin công ty','published'),($2,'vi','tin-an','Ẩn','published')", [c1.id, c2.id]);
  eq((await pub('select id from post_categories')).map((r) => r.id), [c1.id]);
});

console.log('\n[4] Menu & khối trang chủ');
const mn = (o) => q("insert into menus(location, parent_id, label_vi, label_en, url_vi, url_en, sort, active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
  [o.location || 'main', o.parent_id || null, o.label || 'Mục', o.label_en ?? null, o.url ?? '/vi/san-pham/', o.url_en ?? null, o.sort || 0, o.active ?? true]).then((r) => r[0].id);
await test('liên kết nguy hiểm bị chặn (javascript:, data:, //host, khoảng trắng đầu, rỗng); liên kết hợp lệ được nhận', async () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.com', ' /vi/', '\tjavascript:x', 'vi/san-pham', 'ftp://x.com', ''])
    await throws(() => mn({ url: bad }), /menus_url_safe/);
  await throws(() => mn({ url: '/vi/', url_en: 'javascript:x' }), /menus_url_safe/);
  for (const ok of ['/', '/vi/san-pham/', '#lien-he', 'https://example.com/a?b=1', 'http://example.com', 'mailto:a@b.vn', 'tel:+84900000000']) await mn({ url: ok });
});
await test('chỉ cho phép vị trí main/footer; nhãn 1–100 ký tự', async () => {
  await throws(() => mn({ location: 'sidebar' }), /menus_location_ck/);
  await throws(() => mn({ label: '   ' }), /menus_label_len/);
  await throws(() => mn({ label: 'x'.repeat(101) }), /menus_label_len/);
});
await test('menu tối đa 2 cấp; cha phải cùng vị trí; không tự làm cha của mình', async () => {
  const top = await mn({ label: 'Cha' }), child = await mn({ label: 'Con', parent_id: top });
  await throws(() => mn({ label: 'Cháu', parent_id: child }), /MENU_MAX_DEPTH/);
  await throws(() => mn({ label: 'Con footer', location: 'footer', parent_id: top }), /MENU_LOCATION_MISMATCH/);
  await throws(() => q('update menus set parent_id=$1 where id=$1', [top]), /menus_not_self_parent|MENU_MAX_DEPTH/);
  const lone = await mn({ label: 'Lẻ' }); await throws(() => q('update menus set parent_id=$1 where id=$1', [lone]), /menus_not_self_parent/);
  const top2 = await mn({ label: 'Cha 2' });
  await throws(() => q('update menus set parent_id=$1 where id=$2', [top2, top]), /MENU_MAX_DEPTH/);   // mục đang có con không được thành mục con
  await throws(() => q('update menus set parent_id=$1 where id=$2', [child, top2]), /MENU_MAX_DEPTH/);  // cha là mục cấp 2
});
await test('anon chỉ thấy menu đang bật; xoá cha xoá luôn con', async () => {
  const hid = await mn({ label: 'Ẩn', active: false });
  eq((await pub('select id from menus where id=$1', [hid])).length, 0);
  const p = await mn({ label: 'P-xoa' }); await mn({ label: 'C-xoa', parent_id: p });
  await q('delete from menus where id=$1', [p]); eq((await q("select id from menus where label_vi in ('P-xoa','C-xoa')")).length, 0);
});
await test('quyền menu: Editor sửa được; Contributor/Sales thì không', async () => {
  await as('authenticated', U.ed, () => q("insert into menus(label_vi, url_vi) values ('Của editor','/vi/')"));
  await throws(() => as('authenticated', U.con, () => q("insert into menus(label_vi, url_vi) values ('x','/vi/')")), /row-level security/);
  await throws(() => as('authenticated', U.sales, () => q("insert into menus(label_vi, url_vi) values ('x','/vi/')")), /row-level security/);
});
await test('khối trang chủ: chỉ nhận loại hợp lệ + payload là object; anon chỉ thấy khối đang bật', async () => {
  await throws(() => q("insert into home_blocks(block_type) values ('script')"), /home_blocks_type_ck/);
  await throws(() => q("insert into home_blocks(block_type, payload) values ('text','[1]'::jsonb)"), /home_blocks_payload_ck/);
  await throws(() => q("insert into home_blocks(block_type, payload) values ('text', $1::jsonb)", [JSON.stringify({ vi: { body: 'x'.repeat(31000) } })]), /home_blocks_payload_ck/);
  await q("insert into home_blocks(block_type, enabled, payload) values ('hero', true, '{\"vi\":{\"title\":\"A\"}}'), ('text', false, '{}')");
  const rows = await pub('select block_type from home_blocks'); eq(rows.map((r) => r.block_type), ['hero']);
  await throws(() => as('authenticated', U.con, () => q("insert into home_blocks(block_type) values ('text')")), /row-level security/);
  await as('authenticated', U.ed, () => q("insert into home_blocks(block_type) values ('categories')"));
});
await test('nhật ký thao tác ghi lại thay đổi menu', async () => {
  const before = (await q("select count(*)::int c from audit_logs where entity='menus'"))[0].c; await mn({ label: 'Audit' });
  eq((await q("select count(*)::int c from audit_logs where entity='menus'"))[0].c, before + 1);
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
