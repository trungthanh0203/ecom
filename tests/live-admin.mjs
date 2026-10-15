// Kiểm thử quản lý nhân sự TRÊN HỆ THỐNG THẬT (Supabase Auth + Worker đã deploy). Bạn tự chạy; tôi không có mật khẩu của bạn.
// Cần trong tests/.env.test: SA_EMAIL, SA_PASS (Super Admin) và WORKER_URL=https://<worker-của-bạn>.workers.dev
// Tuỳ chọn: SERVICE_ROLE_KEY=<khoá service_role> để TỰ DỌN tài khoản thử (nếu không có, script in câu SQL để bạn xoá tay).
// Chạy: npm run test:live-admin   — script tạo 1 tài khoản thử "live-admin-test-...@example.com", thử khoá/mở/đặt lại mật khẩu rồi dọn.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = readFileSync(join(here, '../public/quan-tri/config.js'), 'utf8');
const URL_ = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1], KEY = cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1];
const env = {}; const ef = join(here, '.env.test');
if (existsSync(ef)) for (const l of readFileSync(ef, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2]; }
const W = (env.WORKER_URL || '').replace(/\/$/, '');
if (!env.SA_EMAIL || !env.SA_PASS || !W) { console.log('Thiếu SA_EMAIL / SA_PASS / WORKER_URL trong tests/.env.test'); process.exit(2); }

let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function api(token, path, body) {
  const h = { 'content-type': 'application/json', origin: W }; if (token) h.authorization = 'Bearer ' + token;
  const r = await fetch(W + '/api/admin/' + path, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

const sa = mk(); const li = await sa.auth.signInWithPassword({ email: env.SA_EMAIL, password: env.SA_PASS });
if (li.error) { console.log('Đăng nhập Super Admin thất bại:', li.error.message); process.exit(2); }
const SA = li.data.session.access_token, saId = li.data.user.id;
const email = `live-admin-test-${Date.now().toString(36)}@example.com`; let uid, tmp, tmp2;

console.log('\n[1] Xác thực');
await test('không token → 401; Super Admin → 200 và thấy chính mình trong danh sách', async () => {
  eq((await api(null, 'staff')).status, 401);
  const r = await api(SA, 'staff'); eq(r.status, 200); eq(r.j.me, saId); truthy(r.j.staff.some((s) => s.user_id === saId && s.role === 'super_admin'));
});

console.log('\n[2] Tạo tài khoản thật');
await test('tạo nhân viên Contributor → nhận mật khẩu tạm 16 ký tự', async () => {
  const r = await api(SA, 'staff/create', { email, display_name: 'Tài khoản thử', role: 'contributor' });
  eq(r.status, 200, JSON.stringify(r.j)); uid = r.j.user_id; tmp = r.j.temp_password; truthy(/^[A-Za-z0-9]{16}$/.test(tmp), 'định dạng mật khẩu tạm');
});
const nv = mk();
await test('nhân viên mới đăng nhập được bằng mật khẩu tạm và bị đánh dấu phải đổi mật khẩu', async () => {
  const r = await nv.auth.signInWithPassword({ email, password: tmp }); if (r.error) throw new Error(r.error.message);
  eq(r.data.user.user_metadata.must_change_password, true);
  const st = await nv.from('staff').select('role,active').eq('user_id', uid).maybeSingle(); eq([st.data.role, st.data.active], ['contributor', true]);
});
await test('nhân viên thường gọi API quản trị → 403; không tự thăng quyền được qua API dữ liệu', async () => {
  const tok = (await nv.auth.getSession()).data.session.access_token; eq((await api(tok, 'staff')).status, 403);
  const r = await nv.from('staff').update({ role: 'super_admin' }).eq('user_id', uid).select(); truthy(r.error || r.data.length === 0, 'tự nâng quyền được!');
});
await test('Super Admin không tự đổi vai trò / tự khoá chính mình', async () => {
  eq((await api(SA, 'staff/update', { user_id: saId, role: 'editor' })).j.error, 'SELF_CHANGE'); eq((await api(SA, 'staff/update', { user_id: saId, active: false })).j.error, 'SELF_CHANGE');
});

console.log('\n[3] Đổi vai trò, khoá, mở khoá');
await test('đổi vai trò → Editor và dữ liệu phản ánh ngay', async () => {
  eq((await api(SA, 'staff/update', { user_id: uid, role: 'editor' })).status, 200);
  const st = await nv.from('staff').select('role').eq('user_id', uid).maybeSingle(); eq(st.data.role, 'editor');
});
await test('khoá: mất quyền dữ liệu NGAY (dù token cũ còn hạn) và không đăng nhập mới được', async () => {
  const r = await api(SA, 'staff/update', { user_id: uid, active: false }); eq(r.status, 200); eq(r.j.ban_failed, false, 'không chặn được ở tầng tài khoản');
  const st = await nv.from('staff').select('role').eq('user_id', uid).maybeSingle(); truthy(!st.data, 'token cũ vẫn đọc được staff sau khi khoá');
  const pr = await nv.from('products').insert({ sku: 'LIVE-KHOA-' + Date.now() }); truthy(pr.error, 'người bị khoá vẫn ghi được dữ liệu');
  truthy((await mk().auth.signInWithPassword({ email, password: tmp })).error, 'người bị khoá vẫn đăng nhập mới được');
});
await test('mở khoá: đăng nhập lại được', async () => {
  eq((await api(SA, 'staff/update', { user_id: uid, active: true })).status, 200);
  const r = await mk().auth.signInWithPassword({ email, password: tmp }); if (r.error) throw new Error(r.error.message);
});

console.log('\n[4] Đặt lại mật khẩu');
await test('đặt lại: mật khẩu cũ không dùng được, mật khẩu mới dùng được và bị bắt đổi', async () => {
  const r = await api(SA, 'staff/reset-password', { user_id: uid }); eq(r.status, 200); tmp2 = r.j.temp_password; truthy(tmp2 !== tmp);
  truthy((await mk().auth.signInWithPassword({ email, password: tmp })).error, 'mật khẩu cũ vẫn dùng được');
  const ok = await mk().auth.signInWithPassword({ email, password: tmp2 }); if (ok.error) throw new Error(ok.error.message); eq(ok.data.user.user_metadata.must_change_password, true);
});
await test('nhân viên tự đổi mật khẩu và gỡ cờ "phải đổi"; tự đổi tên hiển thị', async () => {
  const c = mk(); await c.auth.signInWithPassword({ email, password: tmp2 });
  const u = await c.auth.updateUser({ password: 'MatKhauRieng-' + Date.now(), data: { must_change_password: false } }); if (u.error) throw new Error(u.error.message); eq(u.data.user.user_metadata.must_change_password, false);
  const n = await c.rpc('update_my_profile', { p_name: 'Tên tự đổi' }); if (n.error) throw new Error(n.error.message);
  eq((await c.from('staff').select('display_name').eq('user_id', uid).maybeSingle()).data.display_name, 'Tên tự đổi');
});

console.log('\n[5] Nhật ký');
await test('nhật ký ghi tạo/đổi vai trò/đặt lại mật khẩu kèm người thực hiện và KHÔNG chứa mật khẩu', async () => {
  const r = await sa.from('audit_logs').select('actor,action,entity_id,diff').eq('entity', 'staff_admin').eq('entity_id', uid); if (r.error) throw new Error(r.error.message);
  const acts = r.data.map((x) => x.action); for (const a of ['staff.create', 'staff.update', 'staff.reset_password']) truthy(acts.includes(a), 'thiếu ' + a);
  truthy(r.data.every((x) => x.actor === saId)); truthy(!JSON.stringify(r.data).includes(tmp) && !JSON.stringify(r.data).includes(tmp2), 'mật khẩu lọt vào nhật ký');
});

console.log('\n[Dọn dẹp]');
if (uid) {
  await api(SA, 'staff/update', { user_id: uid, active: false });
  if (env.SERVICE_ROLE_KEY) { const r = await fetch(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } }); console.log(r.ok ? '  đã xoá tài khoản thử' : '  ! không xoá được tài khoản thử: ' + r.status); }
  else console.log(`  Đã KHOÁ tài khoản thử. Xoá hẳn bằng SQL Editor:\n    delete from auth.users where email = '${email}';`);
}
console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
