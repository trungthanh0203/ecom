// Kiểm thử module nội dung (trang/tin/dịch vụ/chính sách) trên Postgres thật (PGlite): RLS công khai, quyền, slug dành riêng.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), read = (p) => readFileSync(join(here, p), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
async function throws(fn, re) { let e; try { await fn(); } catch (x) { e = x; } if (!e) throw new Error('expected error ' + re); if (re && !re.test(e.message)) throw new Error('error mismatch: ' + e.message); }
const q = async (s, p) => (await db.query(s, p)).rows;
async function as(role, uid, fn) { await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); } }

await db.exec(read('auth_stub.sql'));
for (const f of ['001_core.sql', '002_security.sql', '003_commerce.sql', '005_staff_directory.sql', '006_content_guard.sql', '007_menus_blocks_guard.sql', '008_seo_tracking_guard.sql', '009_company_content.sql']) await db.exec(read(`../db/migrations/${f}`));
await db.exec(read('../db/seed_core.sql'));
const U = { adm: '00000000-0000-0000-0000-000000000002', ed: '00000000-0000-0000-0000-000000000003', con: '00000000-0000-0000-0000-000000000004', sales: '00000000-0000-0000-0000-000000000005' };
for (const [k, r] of [['adm', 'admin'], ['ed', 'editor'], ['con', 'contributor'], ['sales', 'sales']]) { await q('insert into auth.users(id) values ($1)', [U[k]]); await q('insert into staff(user_id, role) values ($1,$2)', [U[k], r]); }

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

console.log('\n[5] Chuyển hướng, cài đặt SEO & theo dõi');
const rd = (from, to, code = 301, active = true) => q('insert into redirects(from_path, to_path, status_code, active) values ($1,$2,$3,$4) returning id', [from, to, code, active]).then((r) => r[0].id);
const st = (key, value) => q("insert into site_settings(key, value, is_public) values ($1, $2::jsonb, true) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
await test('chuyển hướng: đích nguy hiểm / nguồn có query / tự chuyển hướng bị chặn; hợp lệ được nhận', async () => {
  for (const bad of ['javascript:alert(1)', 'http://insecure.com', '//evil.com', 'data:text/html,x', 'vi/khong-gach', 'https://x.com/a b']) await throws(() => rd('/vi/cu-' + Math.random(), bad), /redirects_to_safe/);
  await throws(() => rd('/vi/a?x=1', '/vi/b/'), /redirects_from_clean/);
  await throws(() => rd('/vi/a#neo', '/vi/b/'), /redirects_from_clean/);
  await throws(() => rd('/vi/same/', '/vi/same/'), /redirects_not_self|REDIRECT_LOOP/);
  await throws(() => rd('/vi/x', '/vi/y/', 302 + 100), /status_code/);
  await rd('/vi/san-pham/cu/', '/vi/san-pham/moi/'); await rd('/vi/cu2/', 'https://example.com/moi'); await rd('/vi/cu3/', '/', 302);
});
await test('chuyển hướng: phát hiện vòng lặp (2 và 3 mắt xích); chuỗi hợp lệ được nhận', async () => {
  await rd('/loop/a/', '/loop/b/'); await throws(() => rd('/loop/b/', '/loop/a/'), /REDIRECT_LOOP/);
  await rd('/chain/a/', '/chain/b/'); await rd('/chain/b/', '/chain/c/'); await throws(() => rd('/chain/c/', '/chain/a/'), /REDIRECT_LOOP/);
  await rd('/ok/1/', '/ok/2/'); await rd('/ok/2/', '/ok/3/');
  await rd('/off/a/', '/off/b/', 301, false); await rd('/off/b/', '/off/a/');     // chuyển hướng đã tắt không tính vào vòng lặp
});
await test('chuyển hướng: anon chỉ thấy bản đang bật; Editor ghi được; Contributor/Sales thì không', async () => {
  eq((await pub("select id from redirects where from_path='/off/a/'")).length, 0);
  truthy((await pub("select id from redirects where from_path='/vi/san-pham/cu/'")).length === 1);
  await as('authenticated', U.ed, () => q("insert into redirects(from_path, to_path) values ('/ed/1/','/ed/2/')"));
  await throws(() => as('authenticated', U.con, () => q("insert into redirects(from_path, to_path) values ('/c/1/','/c/2/')")), /row-level security/);
  await throws(() => as('authenticated', U.sales, () => q("insert into redirects(from_path, to_path) values ('/s/1/','/s/2/')")), /row-level security/);
});
await test('cài đặt theo dõi: ga4_id / gtm_id / consent chỉ nhận đúng định dạng', async () => {
  for (const [k, bad] of [['ga4_id', 'UA-12345-1'], ['ga4_id', 'G-abc'], ['ga4_id', 'G-ABC123"><script>'], ['gtm_id', 'GTM-<script>'], ['gtm_id', 'gtm-abcd12'], ['gtm_id', 'GTM-AB'], ['tracking_consent', 'maybe']]) await throws(() => st(k, bad), /INVALID_SETTING/);
  await throws(() => st('ga4_id', 123), /INVALID_SETTING/);
  await st('ga4_id', 'G-ABC123XYZ9'); await st('gtm_id', 'GTM-ABCD12'); await st('tracking_consent', 'required'); await st('tracking_consent', 'none');
});
await test('cài đặt CSP mở rộng: chỉ nhận danh sách https://host[:port]; chặn ; \' " và http', async () => {
  for (const bad of ['http://x.com', "https://x.com; script-src *", 'https://x.com\' unsafe-inline', 'https://', '*', 'https://a.com https://', 'x'.repeat(501)]) await throws(() => st('csp_script_extra', bad), /INVALID_SETTING/);
  await st('csp_script_extra', 'https://a.example.com https://b.example.com:8443'); await st('csp_connect_extra', 'https://*.example.com');
});
await test('cài đặt SEO: xác minh, mạng xã hội, đường dẫn ảnh, noindex, độ dài', async () => {
  await throws(() => st('seo_verification_google', 'ab'), /INVALID_SETTING/); await throws(() => st('seo_verification_google', 'abc"><script>x</script>'), /INVALID_SETTING/);
  await st('seo_verification_google', 'AbCdEfGhIjK_12-34');
  await throws(() => st('social_facebook', 'javascript:alert(1)'), /INVALID_SETTING/); await throws(() => st('social_facebook', 'http://facebook.com/x'), /INVALID_SETTING/);
  await st('social_facebook', 'https://facebook.com/congty');
  await throws(() => st('brand_logo_path', '../etc/passwd'), /INVALID_SETTING/); await throws(() => st('brand_logo_path', 'site/a b.webp'), /INVALID_SETTING/); await st('brand_logo_path', 'site/logo.webp');
  await throws(() => st('seo_noindex', 'true'), /INVALID_SETTING/); await st('seo_noindex', true); await st('seo_noindex', false);
  await throws(() => st('seo_home_title_vi', 'x'.repeat(201)), /INVALID_SETTING/); await st('seo_home_title_vi', 'Xe điện chính hãng');
  await st('khoa_khac_khong_bi_anh_huong', { a: 1 });
});
await test('quyền cài đặt: Editor chỉ ghi được seo_*/social_*; mã theo dõi cần Admin; Contributor/Sales không ghi được', async () => {
  const ins = (uid, k, v) => as('authenticated', uid, () => q("insert into site_settings(key, value, is_public) values ($1,$2::jsonb,true) on conflict (key) do update set value=excluded.value returning key", [k, JSON.stringify(v)]));
  await ins(U.ed, 'seo_title_suffix', 'Cty Thử'); await ins(U.ed, 'social_zalo', 'https://zalo.me/0900000000'); await ins(U.ed, 'seo_noindex', true);
  for (const k of ['ga4_id', 'gtm_id', 'csp_script_extra', 'tracking_consent', 'company_name']) await throws(() => ins(U.ed, k, k === 'ga4_id' ? 'G-ABC123XYZ9' : k === 'gtm_id' ? 'GTM-ABCD12' : k === 'tracking_consent' ? 'none' : k === 'csp_script_extra' ? 'https://a.example.com' : 'X'), /row-level security/);
  await ins(U.adm, 'ga4_id', 'G-ZZZ999AAA1'); await ins(U.adm, 'gtm_id', 'GTM-WXYZ99');
  await throws(() => ins(U.con, 'seo_title_suffix', 'x'), /row-level security/); await throws(() => ins(U.sales, 'seo_title_suffix', 'x'), /row-level security/);
  eq((await as('authenticated', U.ed, () => q("delete from site_settings where key='company_name' returning key"))).length, 0);
  eq((await as('authenticated', U.ed, () => q("delete from site_settings where key='social_zalo' returning key"))).length, 1);
});
await test('anon chỉ đọc được cài đặt công khai (mã GA4/GTM là công khai theo thiết kế, không lộ khoá bí mật nào)', async () => {
  const keys = (await pub('select key from site_settings')).map((r) => r.key); truthy(keys.includes('ga4_id') && keys.includes('seo_title_suffix'));
  eq((await pub("select 1 from information_schema.columns where table_name='site_settings' and column_name='secret'")).length, 0);
});

console.log('\n[6] FAQ / đối tác / chứng nhận / dự án / tuyển dụng');
const mkc = (kind, meta, over = {}) => q("insert into content_items(kind, status, meta) values ($1,$2,$3::jsonb) returning id", [kind, over.status || 'published', JSON.stringify(meta || {})]).then((r) => r[0].id);
await test('meta hợp lệ theo từng loại được nhận', async () => {
  await mkc('faq', {}); await mkc('partner', { url: 'https://doitac.vn' }); await mkc('certification', { issuer: 'ISO', year: 2024, url: 'https://iso.org/x' });
  await mkc('project', { client: 'Cty A', year: 2025 }); await mkc('career', { location: 'Hà Nội', type: 'full_time', deadline: '2026-12-31', salary: 'Thoả thuận', apply_email: 'hr@cty.vn' });
});
await test('meta: khoá lạ / sai loại / sai định dạng bị chặn (url http, javascript:, email, năm, ngày, loại việc)', async () => {
  const bad = [['faq', { url: 'https://x.com' }], ['partner', { color: 'red' }], ['partner', { url: 'http://x.com' }], ['partner', { url: 'javascript:alert(1)' }], ['partner', { url: 'https://x.com/a b' }],
    ['certification', { year: '2024' }], ['certification', { year: 1800 }], ['certification', { year: 2024.5 }], ['project', { client: '' }], ['project', { client: 'x'.repeat(201) }],
    ['career', { deadline: '31/12/2026' }], ['career', { deadline: '2026-13-45' }], ['career', { type: 'forever' }], ['career', { apply_email: 'not-an-email' }], ['career', { apply_email: 'a@b' }], ['career', { location: 5 }]];
  for (const [k, m] of bad) await throws(() => mkc(k, m), /INVALID_META/);
  await throws(() => q("insert into content_items(kind, meta) values ('partner', '[1]'::jsonb)"), /INVALID_META|content_items_meta_object/);
  await throws(() => mkc('partner', { url: 'https://x.com/' + 'a'.repeat(4100) }), /content_items_meta_object|INVALID_META/);
});
await test('đổi meta hoặc đổi loại cũng được kiểm lại', async () => {
  const id = await mkc('partner', { url: 'https://ok.vn' });
  await throws(() => q("update content_items set meta = '{\"url\":\"javascript:x\"}'::jsonb where id=$1", [id]), /INVALID_META/);
  await throws(() => q("update content_items set kind='faq' where id=$1", [id]), /INVALID_META/);
});
await test('đường dẫn dành riêng mới: trang không được trùng hoi-dap, doi-tac, chung-nhan, du-an, tuyen-dung…', async () => {
  for (const s of ['hoi-dap', 'faq', 'doi-tac', 'partners', 'chung-nhan', 'certifications', 'du-an', 'projects', 'tuyen-dung', 'careers']) await throws(() => mk('page', s), /RESERVED_SLUG/);
});
await test('content_presence: anon chỉ thấy (ngôn ngữ, loại) đã xuất bản và đến giờ', async () => {
  const pub1 = await mkc('faq', {}); await q("insert into content_translations(item_id, lang, slug, title, status) values ($1,'vi','faq-1','Câu hỏi 1','published'),($1,'en','faq-1-en','Question 1','draft')", [pub1]);
  const dr = await mkc('partner', {}, { status: 'draft' }); await q("insert into content_translations(item_id, lang, slug, title, status) values ($1,'vi','dt-nhap','Đối tác nháp','published')", [dr]);
  const rows = await pub('select lang, kind from content_presence() where kind in (\'faq\',\'partner\') order by kind, lang');
  eq(rows, [{ lang: 'vi', kind: 'faq' }]);
  eq((await as('authenticated', U.ed, () => q("select lang, kind from content_presence() where kind in ('faq','partner') order by kind, lang"))).length >= 1, true);
});
await test('quyền: Contributor chỉ lưu nháp FAQ/dự án/tuyển dụng; Editor xuất bản; Sales không ghi', async () => {
  await as('authenticated', U.con, () => q("insert into content_items(kind, status, meta) values ('career','draft','{\"location\":\"HN\"}'::jsonb)"));
  await throws(() => as('authenticated', U.con, () => q("insert into content_items(kind, status) values ('faq','published')")), /row-level security/);
  await as('authenticated', U.ed, () => q("insert into content_items(kind, status, meta) values ('project','published','{\"year\":2026}'::jsonb)"));
  await throws(() => as('authenticated', U.sales, () => q("insert into content_items(kind) values ('partner')")), /row-level security/);
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
