// Kiểm thử API quản lý nhân sự của Worker (src/admin.js) với máy chủ GIẢ Supabase Auth Admin.
// Chạy: WORKER=http://127.0.0.1:8822 MOCK=http://127.0.0.1:8821 node tests/admin-api.test.mjs
const W = process.env.WORKER, M = process.env.MOCK;
const SA = "token-sa-aaaaaaaaaaaaaaaaaaaaaaaa", ED = "token-ed-aaaaaaaaaaaaaaaaaaaaaaaa";
const ids = { sa: "00000000-0000-0000-0000-000000000001", ed: "00000000-0000-0000-0000-000000000003", sales: "00000000-0000-0000-0000-000000000005", orphan: "00000000-0000-0000-0000-0000000000aa" };
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };
const state = async () => (await fetch(M + '/__state')).json();
async function call(path, { token = SA, body, method, origin = W } = {}) {
  const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token; if (origin) h.origin = origin;
  const r = await fetch(W + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, j, text };
}
const post = (p, body, o) => call('/api/admin/' + p, { ...o, body });

console.log('\n[1] Xác thực & chống lạm dụng');
await test('không có token / token sai → 401; Editor → 403; Super Admin → 200', async () => {
  eq((await call('/api/admin/staff', { token: null })).status, 401);
  eq((await call('/api/admin/staff', { token: 'token-khong-hop-le-aaaaaaaaaaaaaaaa' })).status, 401);
  eq((await call('/api/admin/staff', { token: ED })).status, 403);
  eq((await call('/api/admin/staff', { token: 'token-sales-aaaaaaaaaaaaaaaaaaaa' })).status, 403);   // Sales đã bị khoá (active=false) và không phải super_admin
  eq((await call('/api/admin/staff')).status, 200);
});
await test('POST thiếu Origin hoặc Origin lạ → 403 (kể cả Super Admin)', async () => {
  eq((await post('staff/update', { user_id: ids.ed, role: 'sales' }, { origin: null })).status, 403);
  eq((await post('staff/update', { user_id: ids.ed, role: 'sales' }, { origin: 'https://evil.example' })).status, 403);
});
await test('dùng khoá service_role gọi Supabase; khoá không bao giờ lộ ra phản hồi', async () => {
  const r = await call('/api/admin/staff'); truthy(!r.text.includes('service-test')); const s = await state();
  truthy(s.calls.filter((c) => c.p.startsWith('/auth/v1/admin/') || c.p.startsWith('/rest/v1/')).every((c) => c.svc), 'có lệnh gọi không dùng service key');
});

console.log('\n[2] Danh sách');
await test('danh sách ghép staff + email + lần đăng nhập + trạng thái khoá + phải đổi mật khẩu', async () => {
  const r = await call('/api/admin/staff'); eq(r.j.me, ids.sa);
  const ed = r.j.staff.find((s) => s.user_id === ids.ed); eq([ed.email, ed.role, ed.active, ed.must_change_password], ['ed@x.vn', 'editor', true, true]);
  eq(r.j.staff.find((s) => s.user_id === ids.sales).active, false); truthy(r.j.staff.every((s) => !('password' in s)));
});

console.log('\n[3] Thêm nhân viên');
await test('kiểm tra đầu vào: email, tên, vai trò', async () => {
  for (const b of [{ email: 'khong-hop-le', display_name: 'A', role: 'editor' }, { email: 'a@b.vn', display_name: '', role: 'editor' }, { email: 'a@b.vn', display_name: 'x'.repeat(81), role: 'editor' }, { email: 'a@b.vn', display_name: 'A', role: 'god' }, { email: 'a@b.vn', display_name: 'A' }])
    eq((await post('staff/create', b)).status, 422);
});
let created;
await test('tạo mới: trả mật khẩu tạm 16 ký tự (chỉ một lần), user đánh dấu phải đổi mật khẩu, staff được gán vai trò', async () => {
  const r = await post('staff/create', { email: ' Moi.NV@X.vn ', display_name: 'Nhân viên mới', role: 'sales' }); created = r.j;
  eq(r.status, 200); eq([r.j.email, r.j.role, r.j.existing], ['moi.nv@x.vn', 'sales', false]);
  truthy(/^[A-Za-z0-9]{16}$/.test(r.j.temp_password) && /[A-Z]/.test(r.j.temp_password) && /[a-z]/.test(r.j.temp_password) && /[0-9]/.test(r.j.temp_password), 'mật khẩu tạm không đạt');
  const s = await state(), u = s.users.find((x) => x.id === r.j.user_id);
  eq([u.email, u.confirmed, u.password_len, u.user_metadata.must_change_password], ['moi.nv@x.vn', true, 16, true]);
  eq(s.staff.find((x) => x.user_id === r.j.user_id).role, 'sales');
});
await test('nhật ký ghi đúng người thực hiện + hành động và KHÔNG chứa mật khẩu', async () => {
  const s = await state(), a = s.audit.find((x) => x.p_action === 'staff.create');
  eq([a.p_actor, a.p_target, a.p_detail.role], [ids.sa, created.user_id, 'sales']); truthy(!JSON.stringify(s.audit).includes(created.temp_password), 'mật khẩu lọt vào nhật ký');
});
await test('email đã là nhân viên → 409; mật khẩu tạm mỗi lần một khác (không đoán được)', async () => {
  eq((await post('staff/create', { email: 'moi.nv@x.vn', display_name: 'Trùng', role: 'editor' })).j.error, 'ALREADY_STAFF');
  const a = await post('staff/create', { email: 'n1@x.vn', display_name: 'N1', role: 'editor' }), b = await post('staff/create', { email: 'n2@x.vn', display_name: 'N2', role: 'editor' });
  truthy(a.j.temp_password !== b.j.temp_password);
});
await test('email đã có trong hệ thống đăng nhập nhưng chưa là nhân viên → chỉ cấp vai trò, KHÔNG đổi mật khẩu của họ', async () => {
  const before = (await state()).users.find((u) => u.id === ids.orphan), r = await post('staff/create', { email: 'orphan@x.vn', display_name: 'Có sẵn', role: 'editor' });
  eq([r.status, r.j.existing, r.j.temp_password], [200, true, null]);
  const s = await state(), after = s.users.find((u) => u.id === ids.orphan); eq(after.password_len, before.password_len); eq(after.password_set_at, undefined);
  eq(s.staff.find((x) => x.user_id === ids.orphan).role, 'editor');
});
await test('lỗi giữa chừng được hoàn tác: không để lại tài khoản mồ côi; lỗi hệ thống đăng nhập → 502', async () => {
  const r = await post('staff/create', { email: 'rollback@x.vn', display_name: 'R', role: 'editor' }); eq(r.status, 502);
  truthy(!(await state()).users.some((u) => u.email === 'rollback@x.vn'), 'tài khoản mồ côi còn lại');
  eq((await post('staff/create', { email: 'boom@x.vn', display_name: 'B', role: 'editor' })).status, 502);
});

console.log('\n[4] Đổi vai trò / khoá tài khoản');
await test('đổi vai trò người khác thành công và ghi nhật ký', async () => {
  const r = await post('staff/update', { user_id: ids.ed, role: 'order_manager' }); eq([r.status, r.j.staff.role], [200, 'order_manager']);
  truthy((await state()).audit.some((a) => a.p_action === 'staff.update' && a.p_target === ids.ed && a.p_detail.role === 'order_manager'));
});
await test('KHÔNG tự đổi vai trò / tự khoá chính mình (đổi tên mình thì được)', async () => {
  eq((await post('staff/update', { user_id: ids.sa, role: 'editor' })).j.error, 'SELF_CHANGE');
  eq((await post('staff/update', { user_id: ids.sa, active: false })).j.error, 'SELF_CHANGE');
  eq((await post('staff/update', { user_id: ids.sa, display_name: 'Quản trị' })).status, 200);
});
await test('khoá tài khoản: staff.active=false VÀ chặn đăng nhập ở tầng tài khoản; mở khoá thì gỡ chặn', async () => {
  let r = await post('staff/update', { user_id: ids.ed, active: false }); eq([r.status, r.j.ban_failed], [200, false]);
  let s = await state(); eq([s.staff.find((x) => x.user_id === ids.ed).active, s.users.find((u) => u.id === ids.ed).ban_duration], [false, '876000h']);
  eq((await call('/api/admin/staff')).j.staff.find((x) => x.user_id === ids.ed).banned, true);
  r = await post('staff/update', { user_id: ids.ed, active: true }); s = await state(); eq([s.staff.find((x) => x.user_id === ids.ed).active, s.users.find((u) => u.id === ids.ed).ban_duration], [true, 'none']);
});
await test('đầu vào sai bị từ chối: vai trò lạ, active không phải boolean, id lạ, không có gì để đổi; người không tồn tại → 404', async () => {
  for (const b of [{ user_id: ids.ed, role: 'god' }, { user_id: ids.ed, active: 'yes' }, { user_id: 'abc', role: 'editor' }, { user_id: ids.ed }, { user_id: ids.ed, display_name: '' }]) eq((await post('staff/update', b)).status, 422);
  eq((await post('staff/update', { user_id: '00000000-0000-0000-0000-00000000dead', role: 'editor' })).status, 404);
});
await test('cấp quyền Super Admin cho người khác rồi hạ lại được (khi vẫn còn Super Admin gốc)', async () => {
  eq((await post('staff/update', { user_id: ids.ed, role: 'super_admin' })).status, 200);
  eq((await post('staff/update', { user_id: ids.ed, role: 'editor' })).status, 200);
  // Quy tắc "không hạ Super Admin cuối cùng" nằm ở trigger database và đã kiểm ở staff.test.mjs (API không thể tự dẫn tới tình huống này vì người gọi luôn là một Super Admin đang hoạt động).
});

console.log('\n[5] Đặt lại mật khẩu');
await test('đặt lại mật khẩu người khác: mật khẩu tạm mới + bắt đổi; không tự đặt lại của mình; người lạ → 404', async () => {
  const r = await post('staff/reset-password', { user_id: ids.ed }); eq(r.status, 200); truthy(/^[A-Za-z0-9]{16}$/.test(r.j.temp_password));
  const s = await state(), u = s.users.find((x) => x.id === ids.ed); eq([u.password_len, u.user_metadata.must_change_password], [16, true]);
  truthy(!JSON.stringify(s.audit).includes(r.j.temp_password)); truthy(s.audit.some((a) => a.p_action === 'staff.reset_password' && a.p_target === ids.ed));
  eq((await post('staff/reset-password', { user_id: ids.sa })).j.error, 'SELF_RESET');
  eq((await post('staff/reset-password', { user_id: '00000000-0000-0000-0000-00000000dead' })).status, 404);
});

console.log('\n[6] Giới hạn tần suất');
await test('thao tác nhạy cảm (tạo/đặt lại mật khẩu) bị giới hạn: sau tối đa 20 lần/10 phút trả 429', async () => {
  let got429 = false; for (let i = 0; i < 40 && !got429; i++) got429 = (await post('staff/create', { email: 'x', display_name: 'x', role: 'editor' })).status === 429;
  truthy(got429, 'không bị giới hạn');
});

console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
