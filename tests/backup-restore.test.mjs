// DIỄN TẬP sao lưu & khôi phục trên Postgres thật (PGlite): nguồn có dữ liệu đầy đủ -> sao lưu -> khôi phục sang CSDL MỚI -> đối chiếu.
// Lõi (scripts/backup-lib.mjs) chạy nguyên vẹn; chỉ lớp kết nối (REST thật) được thay bằng Postgres + bộ nhớ giả cho tài khoản/Storage.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABLES, orderOf, backupAll, backupStable, checkSnapshot, restoreAll, readBackup, encrypt, decrypt, pack, unpack, sha256, assertDifferentTarget } from '../scripts/backup-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url)), read = (p) => readFileSync(join(here, p), 'utf8');
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
async function throws(fn, re) { let e; try { await fn(); } catch (x) { e = x; } if (!e) throw new Error('expected error ' + re); if (re && !re.test(e.message)) throw new Error('error mismatch: ' + e.message); }

const MIGS = ['001_core.sql', '002_security.sql', '003_commerce.sql', '005_staff_directory.sql', '006_content_guard.sql', '007_menus_blocks_guard.sql', '008_seo_tracking_guard.sql', '009_company_content.sql', '010_staff_management.sql', '011_backup_restore.sql'];
async function mkdb(seed) {
  const db = new PGlite(); await db.exec(read('auth_stub.sql'));
  for (const f of MIGS) await db.exec(read(`../db/migrations/${f}`));
  if (seed) { await db.exec(read('../db/seed_core.sql')); await db.exec(read('../db/seed_xe_dien.sql')); }
  return db;
}
const q = (db) => async (s, p) => (await db.query(s, p)).rows;
async function as(db, role, uid, fn) { await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); } }

// ---- Transport giả: Postgres thật cho bảng; bộ nhớ cho tài khoản & Storage ----
function pgTransport(db, { users = [], files = new Map(), ignoreIds = false, hook = null, dropFile = null } = {}) {
  const T = {
    users, files,
    select: async (t, off, lim) => (await db.query(`select to_jsonb(x) as r from public.${t} x order by ${orderOf(t)} limit ${lim} offset ${off}`)).rows.map((r) => r.r),
    rpc: async (name, args) => {
      if (hook) args = hook(name, args) || args;
      await db.exec('set role service_role');
      try {
        if (name === 'restore_load') return (await db.query('select public.restore_load($1,$2::jsonb,$3) as n', [args.p_table, JSON.stringify(args.p_rows), args.p_first])).rows[0].n;
        return (await db.query(`select public.${name}() as n`)).rows[0].n;
      } finally { await db.exec('reset role'); }
    },
    listUsers: async () => users.map((u) => ({ ...u })),
    createUser: async (b) => { const id = ignoreIds ? randomUUID() : b.id; await db.query('insert into auth.users(id) values ($1)', [id]); users.push({ id, email: b.email, user_metadata: b.user_metadata, created_at: new Date().toISOString() }); return { id }; },
    storageList: async (prefix) => { const seen = new Map(); for (const p of files.keys()) { if (prefix && !p.startsWith(prefix + '/')) continue; const rest = prefix ? p.slice(prefix.length + 1) : p, i = rest.indexOf('/'); if (i < 0) seen.set(rest, false); else seen.set(rest.slice(0, i), true); } return [...seen].map(([name, isFolder]) => ({ name, isFolder })); },
    storageGet: async (p) => { if (!files.has(p)) throw new Error('not found'); return files.get(p); },
    storagePut: async (p, buf) => { if (dropFile && p === dropFile) return; files.set(p, Buffer.from(buf)); }
  };
  return T;
}

// ============ NGUỒN: một cửa hàng có dữ liệu thật đủ loại ============
const SRC = await mkdb(true), qs = q(SRC), U = {}; const srcUsers = [];
for (const [k, r, name, em] of [['sa', 'super_admin', 'Super Admin', 'sa@x.vn'], ['ed', 'editor', 'Biên tập', 'ed@x.vn'], ['sales', 'sales', 'Kinh doanh', 'sales@x.vn']]) {
  U[k] = randomUUID(); await SRC.query('insert into auth.users(id) values ($1)', [U[k]]); await SRC.query('insert into staff(user_id, role, display_name) values ($1,$2,$3)', [U[k], r, name]);
  srcUsers.push({ id: U[k], email: em, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
}
const srcFiles = new Map([['products/1/a.webp', randomBytes(5000)], ['site/logo.webp', randomBytes(900)], ['content/x/y.png', randomBytes(70000)]]);
const mkProd = async (sku, price, extra = {}) => { const [p] = await qs('insert into products(sku, price, category_id, attrs, retail_enabled) values ($1,$2,4,$3::jsonb,true) returning id', [sku, price, JSON.stringify(extra.attrs || {})]);
  await qs("insert into product_translations(product_id, lang, slug, name, short_desc, status) values ($1,'vi',$2,$3,'Mô tả','published'),($1,'en',$4,$5,'Desc','draft')", [p.id, sku.toLowerCase(), 'Xe ' + sku, sku.toLowerCase() + '-en', 'Bike ' + sku]);
  if (extra.publish !== false) await qs("update products set status='published' where id=$1", [p.id]); return p.id; };
const P1 = await mkProd('XM-1', 12000000, { attrs: { range_km: 80, waterproof: true } }), P2 = await mkProd('XD-2', 5000000), P3 = await mkProd('NHAP-3', 100, { publish: false });
await qs("update products set sale_price=4000000, sale_end=now()+interval '30 days' where id=$1", [P2]);
await qs("insert into product_images(product_id, path, is_primary, alt_vi) values ($1,'products/1/a.webp', true, 'Xe máy')", [P1]);
await qs("insert into brands(sort) values (1)"); await qs("insert into brand_translations(brand_id, lang, slug, name, status) values (1,'vi','yadea','Yadea','published')");
const [par] = await qs("insert into categories(sort, active) values (50, true) returning id"), [chd] = await qs("insert into categories(sort, active, parent_id) values (51, true, $1) returning id", [par.id]);
await qs("insert into category_translations(category_id, lang, slug, name, status) values ($1,'vi','cha','Cha','published'),($2,'vi','con','Con','published')", [par.id, chd.id]);
await qs("insert into shipping_rules(province, fee, free_over) values (null, 50000, 100000000), ('Hà Nội', 30000, null)");
await qs("insert into site_settings(key, value, is_public) values ('company_name','\"Cty Diễn Tập\"',true),('hotline','\"0900000000\"',true),('seo_noindex','true',true)");
const mkOrder = async (qty) => (await as(SRC, 'service_role', null, () => qs('select create_order($1::jsonb) r', [JSON.stringify({ idempotency_key: 'k-' + randomUUID(), consent: 'true', payment_method: 'cod', lang: 'vi', customer: { name: 'Nguyễn Văn A', phone: '0901234567', province: 'Hà Nội', address: '12 Phố Huế' }, items: [{ product_id: P1, qty }, { product_id: P2, qty: 1 }] })])))[0].r;
const O1 = await mkOrder(1), O2 = await mkOrder(2);
const [o1] = await qs('select id from orders where code=$1', [O1.code]);
await as(SRC, 'authenticated', U.sa, () => qs("update orders set status='confirmed', assigned_to=$2 where id=$1", [o1.id, U.ed]));
await as(SRC, 'authenticated', U.sa, () => qs("insert into order_notes(order_id, author, note) values ($1,$2,'Đã gọi khách')", [o1.id, U.sa]));
const QR = (await as(SRC, 'service_role', null, () => qs('select submit_quote($1::jsonb) r', [JSON.stringify({ idempotency_key: 'q-' + randomUUID(), consent: 'true', contact_name: 'Trần B', company: 'Cty ABC', phone: '0912345678', email: 'b@abc.vn', items: [{ product_id: P1, qty: 20, unit: 'chiếc' }, { name: 'Pin tuỳ chỉnh', qty: 100 }] })])))[0].r;
const [qr] = await qs('select id from quote_requests where code=$1', [QR.code]);
await as(SRC, 'authenticated', U.sales, () => qs("update quote_requests set status='reviewing', assigned_to=$2 where id=$1", [qr.id, U.sales]));
await as(SRC, 'authenticated', U.sales, () => qs("insert into quote_activities(quote_id, actor, type, note) values ($1,$2,'note','Hẹn gửi giá')", [qr.id, U.sales]));
await qs("insert into contact_requests(name, phone, message) values ('Lan','0901112223','Cần tư vấn')");
const [pc] = await qs('insert into post_categories(sort) values (1) returning id'); await qs("insert into post_category_translations(post_category_id, lang, slug, name, status) values ($1,'vi','tin-cty','Tin công ty','published')", [pc.id]);
const mkC = async (kind, slug, title, meta = {}, cat = null) => { const [i] = await qs("insert into content_items(kind, status, meta, post_category_id, cover_path) values ($1,'published',$2::jsonb,$3,$4) returning id", [kind, JSON.stringify(meta), cat, kind === 'partner' ? 'site/logo.webp' : null]); await qs("insert into content_translations(item_id, lang, slug, title, body, status) values ($1,'vi',$2,$3,'<p>Nội dung</p>','published')", [i.id, slug, title]); return i.id; };
await mkC('page', 'gioi-thieu', 'Giới thiệu'); await mkC('post', 'bai-1', 'Bài 1', {}, pc.id); await mkC('faq', 'faq-1', 'Câu hỏi 1'); await mkC('partner', 'dt-1', 'Đối tác 1', { url: 'https://doitac.vn' }); await mkC('career', 'nv-1', 'Nhân viên', { location: 'HN', type: 'full_time', deadline: '2099-12-31' });
const [m1] = await qs("insert into menus(location, label_vi, url_vi, sort) values ('main','Sản phẩm','/vi/san-pham/',0) returning id"); await qs("insert into menus(location, parent_id, label_vi, url_vi) values ('main',$1,'Xe máy','/vi/san-pham/danh-muc/xe-may-dien/')", [m1.id]);
await qs("insert into home_blocks(block_type, sort, payload) values ('hero',0,'{\"vi\":{\"title\":\"Xe điện\"}}'), ('products',1,'{\"vi\":{\"title\":\"Nổi bật\"},\"cfg\":{\"source\":\"featured\",\"limit\":8}}')");
await qs("insert into redirects(from_path, to_path) values ('/vi/cu/','/vi/moi/'),('/vi/moi/','/vi/moi-hon/')");
const SRC_T = pgTransport(SRC, { users: srcUsers, files: srcFiles });
const SRC_URL = 'https://nguon.supabase.co';
const count = async (db, t) => (await q(db)(`select count(*)::int c from public.${t}`))[0].c;

console.log('\n[1] Sao lưu');
const logs = []; const { buf: RAW, manifest } = await backupAll(SRC_T, { source: SRC_URL, log: (l) => logs.push(l) });
await test('sao lưu đủ 28 bảng, tài khoản, 3 tệp Storage; manifest ghi số dòng + dấu vân tay + mã băm từng mục', async () => {
  eq(Object.keys(manifest.tables).sort(), [...TABLES].sort());
  for (const t of ['products', 'orders', 'order_items', 'quote_requests', 'content_items', 'menus', 'audit_logs', 'staff', 'categories']) truthy(manifest.tables[t].rows > 0, 'bảng trống: ' + t);
  eq([manifest.auth_users.count, manifest.storage.files.length], [3, 3]); truthy(Object.values(manifest.entries).every((h) => /^[0-9a-f]{64}$/.test(h)));
  for (const t of TABLES) eq(manifest.tables[t].rows, await count(SRC, t), 'số dòng ' + t);
});
await test('sao lưu KHÔNG chứa mật khẩu/băm mật khẩu; tài khoản chỉ có thông tin nhận diện', async () => {
  const bk = readBackup(RAW); truthy(bk.users.every((u) => Object.keys(u).sort().join() === 'created_at,email,id,last_sign_in_at,user_metadata'));
  truthy(!RAW.toString('utf8').match(/encrypted_password|password_hash|\$2[aby]\$/));
});
await test('kiểm tra tệp (dry-run) hợp lệ và không đụng tới đích', async () => { const r = await restoreAll(null, RAW, { dryRun: true }); eq([r.ok, r.dryRun, r.storage.restored], [true, true, 3]); });

console.log('\n[2] Mã hoá & toàn vẹn');
const PASS = 'cum-mat-khau-thu-nghiem-12';
const ENC = encrypt(RAW, PASS);
await test('mã hoá/giải mã khứ hồi đúng; tệp mã hoá không lộ dữ liệu thô', async () => {
  truthy(decrypt(ENC, PASS).equals(RAW)); truthy(!ENC.includes(Buffer.from('Nguyễn Văn A')) && !ENC.includes(Buffer.from('0901234567')));
  eq(readBackup(ENC, PASS).manifest.taken_at, manifest.taken_at);
});
await test('sai cụm mật khẩu / cụm quá ngắn / tệp bị sửa 1 byte / bị cắt cụt đều bị TỪ CHỐI', async () => {
  await throws(async () => decrypt(ENC, 'sai-cum-mat-khau-12345'), /DECRYPT_FAILED/);
  await throws(async () => encrypt(RAW, 'ngan'), /12 ký tự/);
  const bad = Buffer.from(ENC); bad[bad.length - 100] ^= 1; await throws(async () => readBackup(bad, PASS), /DECRYPT_FAILED/);
  await throws(async () => readBackup(ENC.subarray(0, ENC.length - 10), PASS), /DECRYPT_FAILED/);
  await throws(async () => readBackup(Buffer.from('khong phai tep sao luu'), PASS), /BAD_FORMAT/);
});
await test('tệp KHÔNG mã hoá bị sửa nội dung 1 bảng → INTEGRITY_FAILED (mã băm manifest không khớp)', async () => {
  const entries = unpack(RAW), e = entries.find((x) => x.name === 'tables/orders.ndjson'); e.data[10] ^= 1; await throws(async () => readBackup(pack(entries)), /INTEGRITY_FAILED/);
  const e2 = unpack(RAW); const i = e2.findIndex((x) => x.name === 'storage/site/logo.webp'); e2.splice(i, 1); await throws(async () => readBackup(pack(e2)), /INTEGRITY_FAILED: .*thiếu storage/);
});

console.log('\n[3] Khôi phục vào CSDL MỚI (giữ nguyên mã tài khoản)');
const DST = await mkdb(false), DST_T = pgTransport(DST), qd = q(DST); let R;
await test('khôi phục thành công: mọi bảng khớp dấu vân tay, 3 tệp Storage đối chiếu nội dung, 3 tài khoản tạo lại', async () => {
  R = await restoreAll(DST_T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' });
  eq(R.problems, []); eq(R.ok, true); eq([R.users.created, R.users.remapped, R.storage.restored, R.storage.verified], [3, 0, 3, 3]);
  truthy(R.tables.every((t) => t.match === true && t.backup === t.restored)); eq(R.credentials.length, 3); truthy(R.credentials.every((c) => /^[A-Za-z0-9]{16}$/.test(c.temp_password)));
});
await test('dữ liệu nghiệp vụ giống hệt: đơn hàng (mã, tổng, snapshot), báo giá, nội dung, menu, cài đặt', async () => {
  for (const sql of ['select code, total, status, payment_status, assigned_to from orders order by code', 'select sku, name, unit_price, qty from order_items order by id', 'select code, status, company from quote_requests order by code',
    'select kind, status, meta from content_items order by id', 'select key, value from site_settings order by key', 'select label_vi, parent_id from menus order by id', 'select from_path, to_path from redirects order by id'])
    eq(await qd(sql), await qs(sql), sql);
});
await test('quyền & RLS ở đích hoạt động như nguồn: khách ẩn danh chỉ thấy SP đã xuất bản; Super Admin thấy đơn; Editor không thấy đơn', async () => {
  const anon = (db) => as(db, 'anon', null, () => q(db)('select sku from products order by sku'));
  eq(await anon(DST), await anon(SRC)); eq((await anon(DST)).map((r) => r.sku), ['XD-2', 'XM-1']);
  eq((await as(DST, 'authenticated', U.sa, () => qd('select count(*)::int c from orders')))[0].c, 2);
  eq((await as(DST, 'authenticated', U.ed, () => qd('select count(*)::int c from orders')))[0].c, 0);
});
await test('trigger nghiệp vụ được BẬT LẠI sau khôi phục (chặn xuất bản thiếu bản dịch, chặn nhảy trạng thái đơn, ghi nhật ký)', async () => {
  const [np] = await qd("insert into products(sku, price) values ('MOI-1', 100) returning id"); await throws(() => qd("update products set status='published' where id=$1", [np.id]), /PUBLISH_NEEDS_VI_TRANSLATION/);
  const [o] = await qd("select id from orders where status='new' limit 1"); await throws(() => qd("update orders set status='completed' where id=$1", [o.id]), /INVALID_ORDER_TRANSITION/);
  const before = await count(DST, 'audit_logs'); await qd("update products set featured=true where sku='XM-1'"); eq(await count(DST, 'audit_logs'), before + 1, 'audit không ghi');
  const trg = await qd("select count(*)::int c from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgenabled <> 'O'"); eq(trg[0].c, 0, 'còn trigger bị tắt');
  await qd("delete from products where sku='MOI-1'"); await qd("update products set featured=false where sku='XM-1'");
});
await test('khôi phục KHÔNG ghi nhật ký trùng: audit_logs ở đích = nguồn lúc khôi phục; created_at/updated_at được giữ nguyên', async () => {
  eq(R.tables.find((t) => t.table === 'audit_logs').restored, manifest.tables.audit_logs.rows);
  eq((await qd("select updated_at from products where sku='XD-2'"))[0].updated_at, (await qs("select updated_at from products where sku='XD-2'"))[0].updated_at);
});
await test('bộ đếm tự tăng được đặt lại: bản ghi MỚI không trùng id cũ; tạo đơn mới ở đích hoạt động và mã đơn không trùng', async () => {
  const mx = (await qd('select max(id)::int m from categories'))[0].m; const [c] = await qd('insert into categories(sort) values (99) returning id'); eq(c.id, mx + 1); await qd('delete from categories where id=$1', [c.id]);
  const r = await as(DST, 'service_role', null, () => qd('select create_order($1::jsonb) r', [JSON.stringify({ idempotency_key: 'moi-' + randomUUID(), consent: 'true', payment_method: 'cod', lang: 'vi', customer: { name: 'Khách mới', phone: '0911111111', province: 'Cần Thơ', address: '1 Nguyễn Trãi' }, items: [{ product_id: P1, qty: 1 }] })]));
  truthy(![O1.code, O2.code].includes(r[0].r.code)); eq(await count(DST, 'orders'), 3);
});

console.log('\n[4] Khôi phục khi tài khoản được tạo lại với MÃ KHÁC');
const REM = await mkdb(false), REM_T = pgTransport(REM, { ignoreIds: true }); let R2;
await test('mã tài khoản đổi → mọi cột tham chiếu (staff, người phụ trách, người thao tác, nhật ký) được đổi theo; ràng buộc khoá ngoại nguyên vẹn', async () => {
  R2 = await restoreAll(REM_T, ENC, { passphrase: PASS, targetUrl: 'https://khac.supabase.co' }); eq(R2.problems, []); eq([R2.ok, R2.users.remapped], [true, 3]);
  const idOf = Object.fromEntries(REM_T.users.map((u) => [u.email, u.id]));
  eq((await q(REM)('select user_id from staff order by display_name')).map((r) => r.user_id).sort(), Object.values(idOf).sort());
  eq((await q(REM)("select assigned_to from orders where assigned_to is not null"))[0].assigned_to, idOf['ed@x.vn']);
  eq((await q(REM)("select author from order_notes"))[0].author, idOf['sa@x.vn']);
  eq((await q(REM)("select assigned_to from quote_requests where assigned_to is not null"))[0].assigned_to, idOf['sales@x.vn']);
  truthy((await q(REM)("select actor from audit_logs where actor is not null")).every((r) => Object.values(idOf).includes(r.actor)), 'nhật ký còn mã cũ');
  eq((await as(REM, 'authenticated', idOf['sa@x.vn'], () => q(REM)('select count(*)::int c from orders')))[0].c, 2);   // Super Admin mới vẫn có quyền
});

console.log('\n[5] An toàn khi đích KHÔNG trống / chạy lại / gián đoạn');
await test('đích đã khôi phục xong → chạy lại là AN TOÀN (không nạp thêm dòng nào, không tạo tài khoản trùng, số dòng không đổi)', async () => {
  const D = await mkdb(false); let loads = 0;
  const T = pgTransport(D, { hook: (name, a) => { if (name === 'restore_load' && a.p_rows.length) loads++; } });
  eq((await restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' })).ok, true); truthy(loads > 0);
  const snap = async () => JSON.stringify(await Promise.all(TABLES.map((t) => count(D, t)))), before = await snap(); loads = 0;
  const r = await restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' });
  eq([r.ok, r.users.created, r.users.matched, loads], [true, 0, 3, 0]); eq(await snap(), before, 'số dòng đổi sau lần chạy lại');
});
await test('đích có dữ liệu KHÁC bản sao lưu → TỪ CHỐI TRƯỚC khi ghi bất kỳ bảng nào (không để dở dang)', async () => {
  const D = await mkdb(false); await q(D)("insert into products(sku, price) values ('LA-1', 5)"); const T = pgTransport(D);
  await throws(() => restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' }), /TARGET_NOT_EMPTY: bảng products/);
  for (const t of ['orders', 'categories', 'content_items', 'menus', 'order_items']) eq(await count(D, t), 0, t + ' bị ghi dở');
});
await test('đích bị sửa tay sau khôi phục (đổi giá 1 sản phẩm) → lần khôi phục lại phát hiện và từ chối, không ghi đè', async () => {
  await qd("update products set price=1 where sku='XM-1'");
  await throws(() => restoreAll(DST_T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' }), /TARGET_NOT_EMPTY: bảng products/); await qd("update products set price=12000000 where sku='XM-1'");
});
await test('gián đoạn GIỮA CHỪNG (lỗi khoá ngoại ở bảng order_items): giao dịch huỷ sạch, trigger vẫn bật, chạy lại tiếp tục và hoàn tất', async () => {
  const D = await mkdb(false); let broke = false;
  const T = pgTransport(D, { hook: (name, a) => { if (name === 'restore_load' && a.p_table === 'order_items' && !broke) { broke = true; return { ...a, p_rows: [...a.p_rows, { ...a.p_rows[0], id: 999999, order_id: randomUUID() }] }; } } });
  await throws(() => restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' }), /foreign key|violates/i);
  eq(await count(D, 'order_items'), 0, 'order_items nạp dở'); truthy((await count(D, 'orders')) > 0 && (await count(D, 'products')) > 0, 'các bảng cha phải đã nạp xong trước khi gặp lỗi');
  eq((await q(D)("select count(*)::int c from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='order_items' and not t.tgisinternal and t.tgenabled <> 'O'"))[0].c, 0, 'trigger order_items bị tắt');
  const r = await restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' }); eq([r.ok, r.problems], [true, []]);
});
await test('chặn khôi phục nhầm vào CHÍNH dự án nguồn (trừ khi chủ động cho phép)', async () => {
  assertDifferentTarget(manifest, 'https://khac.supabase.co');
  await throws(async () => assertDifferentTarget(manifest, SRC_URL), /SAME_PROJECT/);
  await throws(() => restoreAll(DST_T, ENC, { passphrase: PASS, targetUrl: SRC_URL }), /SAME_PROJECT/);
});
await test('phát hiện tệp Storage không lên được đích: báo cáo KHÔNG ok và nêu đúng tên tệp', async () => {
  const D = await mkdb(false), T = pgTransport(D, { dropFile: 'site/logo.webp' }); const r = await restoreAll(T, ENC, { passphrase: PASS, targetUrl: 'https://dich.supabase.co' });
  eq(r.ok, false); truthy(r.problems.some((p) => p.includes('site/logo.webp')), r.problems.join('|')); eq(r.storage.verified, 2);
});

console.log('\n[6] Hàm khôi phục ở database');
await test('chỉ service_role gọi được; anon/authenticated bị chặn', async () => {
  for (const r of ['anon', 'authenticated']) { await throws(() => as(DST, r, U.sa, () => qd("select restore_load('products','[]'::jsonb,true)")), /permission denied/); await throws(() => as(DST, r, U.sa, () => qd('select restore_fix_sequences()')), /permission denied/); }
});
await test('từ chối bảng lạ / bảng hệ thống, dữ liệu không phải mảng, và nạp vào bảng đã có dữ liệu', async () => {
  const sv = (sql, p) => as(DST, 'service_role', null, () => qd(sql, p));
  await throws(() => sv("select restore_load('auth.users','[]'::jsonb,true)"), /RESTORE_TABLE_NOT_ALLOWED/); await throws(() => sv("select restore_load('pg_class','[]'::jsonb,true)"), /RESTORE_TABLE_NOT_ALLOWED/);
  await throws(() => sv("select restore_load('products','{\"a\":1}'::jsonb,true)"), /RESTORE_BAD_ROWS/);
  await throws(() => sv("select restore_load('products','[{\"sku\":\"X\"}]'::jsonb,true)"), /RESTORE_TABLE_NOT_EMPTY/);
  await throws(() => sv("select restore_load('products; drop table orders','[]'::jsonb,true)"), /RESTORE_TABLE_NOT_ALLOWED/);
});

console.log('\n[7] Bản chụp nhất quán');
const injectOrder = (tag) => as(SRC, 'service_role', null, () => qs('select create_order($1::jsonb)', [JSON.stringify({ idempotency_key: tag + randomUUID(), consent: 'true', payment_method: 'cod', lang: 'vi', customer: { name: 'Khách xen ngang', phone: '0922222222', province: 'Hà Nội', address: '9 Lê Lợi' }, items: [{ product_id: P1, qty: 1 }] })]));
await test('có đơn mới xen vào GIỮA lúc sao lưu → phát hiện bản chụp không nhất quán (dòng hàng mồ côi) thay vì tạo ra tệp hỏng', async () => {
  const T = pgTransport(SRC, { users: srcUsers, files: srcFiles }), base = T.select; let injected = false;
  T.select = async (t, off, lim) => { const rows = await base(t, off, lim); if (t === 'orders' && !injected) { injected = true; await injectOrder('xen-'); } return rows; };
  await throws(() => backupAll(T, { source: SRC_URL }), /INCONSISTENT_SNAPSHOT: .*order_items\.order_id: 1 dòng mồ côi/);
});
await test('tự thử lại: lần sau không còn bị xen ngang thì thành công, ghi nhật ký "thử lại", và bản chụp đó KHÔI PHỤC được', async () => {
  const T = pgTransport(SRC, { users: srcUsers, files: srcFiles }), base = T.select, logs3 = []; let n = 0;
  T.select = async (t, off, lim) => { const rows = await base(t, off, lim); if (t === 'orders' && n++ === 0) await injectOrder('xen2-'); return rows; };
  const r = await backupStable(T, { source: SRC_URL, log: (l) => logs3.push(l) }, { attempts: 3, delayMs: 10 });
  truthy(logs3.some((l) => l.includes('thử lại')), 'không thử lại'); eq(r.manifest.tables.orders.rows, await count(SRC, 'orders'));
  const D = await mkdb(false); eq((await restoreAll(pgTransport(D), r.buf, { targetUrl: 'https://dich.supabase.co' })).ok, true);
});
await test('liên tục bị xen ngang quá số lần thử → báo lỗi rõ ràng (không tạo tệp hỏng)', async () => {
  const T = pgTransport(SRC, { users: srcUsers, files: srcFiles }), base = T.select;
  T.select = async (t, off, lim) => { const rows = await base(t, off, lim); if (t === 'orders') await injectOrder('lien-tuc-'); return rows; };
  await throws(() => backupStable(T, { source: SRC_URL }, { attempts: 2, delayMs: 5 }), /INCONSISTENT_SNAPSHOT/);
});
await test('checkSnapshot nhận ra các quan hệ cha-con chính (đơn, báo giá, sản phẩm, danh mục, nội dung)', async () => {
  const empty = () => Object.fromEntries(TABLES.map((t) => [t, []]));
  for (const [c, col, p] of [['order_items', 'order_id', 'orders'], ['quote_activities', 'quote_id', 'quote_requests'], ['product_images', 'product_id', 'products'], ['content_translations', 'item_id', 'content_items'], ['category_translations', 'category_id', 'categories']]) {
    const d = empty(); d[c] = [{ [col]: 'khong-ton-tai' }]; await throws(async () => checkSnapshot(d), new RegExp(c)); d[p] = [{ id: 'khong-ton-tai' }]; checkSnapshot(d);
  }
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
