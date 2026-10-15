// Kiểm thử quản lý nhân sự ở tầng database (PGlite): chống tự đổi quyền, hồ sơ cá nhân, danh bạ đầy đủ, nhật ký từ API quản trị.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), read = (p) => readFileSync(join(here, p), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
async function throws(fn, re) { let e; try { await fn(); } catch (x) { e = x; } if (!e) throw new Error('expected error ' + re); if (re && !re.test(e.message)) throw new Error('error mismatch: ' + e.message); }
const q = async (s, p) => (await db.query(s, p)).rows;
async function as(role, uid, fn) { await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); } }

await db.exec(read('auth_stub.sql'));
for (const f of ['001_core.sql', '002_security.sql', '003_commerce.sql', '005_staff_directory.sql', '010_staff_management.sql']) await db.exec(read(`../db/migrations/${f}`));
await db.exec(read('../db/seed_core.sql'));
const U = { sa: '00000000-0000-0000-0000-000000000001', sa2: '00000000-0000-0000-0000-000000000011', adm: '00000000-0000-0000-0000-000000000002', ed: '00000000-0000-0000-0000-000000000003', sales: '00000000-0000-0000-0000-000000000005' };
for (const [k, r] of [['sa', 'super_admin'], ['sa2', 'super_admin'], ['adm', 'admin'], ['ed', 'editor'], ['sales', 'sales']]) { await q('insert into auth.users(id) values ($1)', [U[k]]); await q('insert into staff(user_id, role, display_name) values ($1,$2,$3)', [U[k], r, k]); }

console.log('\n[1] Quy tắc nhân sự ở database');
await test('Super Admin KHÔNG tự hạ vai trò / tự khoá chính mình qua API dữ liệu', async () => {
  await throws(() => as('authenticated', U.sa, () => q("update staff set role='admin' where user_id=$1", [U.sa])), /SELF_CHANGE/);
  await throws(() => as('authenticated', U.sa, () => q('update staff set active=false where user_id=$1', [U.sa])), /SELF_CHANGE/);
});
await test('Super Admin vẫn đổi được vai trò/khoá người KHÁC và đổi tên hiển thị của chính mình', async () => {
  eq((await as('authenticated', U.sa, () => q("update staff set role='order_manager' where user_id=$1 returning role", [U.sales])))[0].role, 'order_manager');
  eq((await as('authenticated', U.sa, () => q("update staff set role='sales' where user_id=$1 returning role", [U.sales])))[0].role, 'sales');
  eq((await as('authenticated', U.sa, () => q("update staff set display_name='Quản trị viên' where user_id=$1 returning display_name", [U.sa])))[0].display_name, 'Quản trị viên');
});
await test('lệnh từ service_role (API quản trị) không bị chặn bởi trigger tự-đổi; vẫn bị chặn nếu hạ Super Admin cuối cùng', async () => {
  eq((await as('service_role', null, () => q("update staff set role='editor' where user_id=$1 returning role", [U.sa2])))[0].role, 'editor');
  await as('service_role', null, () => q("update staff set role='super_admin' where user_id=$1", [U.sa2]));
  await q("update staff set active=false where user_id=$1", [U.sa2]);                        // còn lại 1 Super Admin hoạt động (sa)
  await throws(() => as('service_role', null, () => q("update staff set role='admin' where user_id=$1", [U.sa])), /LAST_SUPER_ADMIN/);
  await q('update staff set active=true where user_id=$1', [U.sa2]);
});
await test('Admin / Editor / Sales không quản lý được nhân sự (không sửa, không thêm); Admin chỉ thấy dòng của mình', async () => {
  for (const u of [U.adm, U.ed, U.sales]) {
    eq((await as('authenticated', u, () => q("update staff set role='super_admin' where user_id=$1 returning 1", [u]))).length, 0);
    eq((await as('authenticated', u, () => q("update staff set active=false where user_id=$1 returning 1", [U.sa]))).length, 0);
    await throws(() => as('authenticated', u, () => q("insert into staff(user_id, role) values ($1,'admin')", ['00000000-0000-0000-0000-0000000000ff'])), /row-level security|foreign key/);
  }
  eq((await as('authenticated', U.adm, () => q('select * from staff'))).length, 1);
});
await test('tên hiển thị tối đa 80 ký tự', async () => {
  await throws(() => q("update staff set display_name=$1 where user_id=$2", ['x'.repeat(81), U.ed]), /staff_display_name_len/);
});

console.log('\n[2] Hồ sơ cá nhân');
await test('update_my_profile: nhân viên tự đổi tên mình (không cần staff.manage); tên rỗng/quá dài bị chặn', async () => {
  await as('authenticated', U.ed, () => q("select update_my_profile('  Biên tập viên  ')"));
  eq((await q('select display_name from staff where user_id=$1', [U.ed]))[0].display_name, 'Biên tập viên');
  await throws(() => as('authenticated', U.ed, () => q("select update_my_profile('   ')")), /INVALID_NAME/);
  await throws(() => as('authenticated', U.ed, () => q('select update_my_profile($1)', ['x'.repeat(81)])), /INVALID_NAME/);
});
await test('update_my_profile: không đổi được tên người khác; anon và người ngoài bị chặn', async () => {
  await as('authenticated', U.ed, () => q("select update_my_profile('Chỉ tôi')"));
  eq((await q('select display_name from staff where user_id=$1', [U.sales]))[0].display_name, 'sales');
  await throws(() => as('anon', null, () => q("select update_my_profile('x')")), /permission denied/);
  await q('insert into auth.users(id) values ($1)', ['00000000-0000-0000-0000-0000000000ee']);
  await throws(() => as('authenticated', '00000000-0000-0000-0000-0000000000ee', () => q("select update_my_profile('x')")), /FORBIDDEN/);
});

console.log('\n[3] Danh bạ đầy đủ & nhật ký');
await test('staff_directory_all: Admin/Super Admin thấy cả người đã khoá; Editor/Sales không thấy gì', async () => {
  await q('update staff set active=false where user_id=$1', [U.sales]);
  const n = (await q('select count(*)::int c from staff'))[0].c;
  eq((await as('authenticated', U.adm, () => q('select * from staff_directory_all()'))).length, n);
  eq((await as('authenticated', U.sa, () => q('select * from staff_directory_all()'))).filter((r) => r.active === false).length, 1);
  eq((await as('authenticated', U.ed, () => q('select * from staff_directory_all()'))).length, 0);
  await throws(() => as('anon', null, () => q('select * from staff_directory_all()')), /permission denied/);
  await q('update staff set active=true where user_id=$1', [U.sales]);
});
await test('log_admin_action: chỉ service_role ghi được, kèm người thực hiện; Admin đọc được, Editor thì không', async () => {
  await as('service_role', null, () => q("select log_admin_action($1,'staff.create',$2,'{\"role\":\"editor\"}'::jsonb)", [U.sa, U.ed]));
  for (const r of ['anon', 'authenticated']) await throws(() => as(r, U.sa, () => q("select log_admin_action($1,'x',$1,'{}'::jsonb)", [U.sa])), /permission denied/);
  const rows = await as('authenticated', U.adm, () => q("select actor, action, entity_id, diff from audit_logs where entity='staff_admin'"));
  eq([rows[0].actor, rows[0].action, rows[0].entity_id, rows[0].diff.role], [U.sa, 'staff.create', U.ed, 'editor']);
  eq((await as('authenticated', U.ed, () => q("select * from audit_logs where entity='staff_admin'"))).length, 0);
});
await test('thay đổi bảng staff tự động vào nhật ký (trigger cũ) với người thực hiện đúng', async () => {
  await as('authenticated', U.sa, () => q("update staff set role='contributor' where user_id=$1", [U.sales]));
  const r = await q("select actor, diff from audit_logs where entity='staff' and entity_id=$1 and action='update' order by id desc limit 1", [U.sales]);
  eq([r[0].actor, r[0].diff.role.new], [U.sa, 'contributor']);
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
