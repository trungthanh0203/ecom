/* Nhân sự, nhật ký thao tác, tài khoản cá nhân. Việc tạo/khoá tài khoản chạy qua API riêng của Worker (/api/admin/*, chỉ Super Admin);
   quyền thật vẫn do database quyết định. Mật khẩu tạm chỉ hiện MỘT lần trên màn hình, không lưu ở đâu cả. */
(() => {
"use strict";
const C = window.CMS, { $, $$, esc, toast, busy, errMsg, openModal, closeModal, inp, sel, chk, g, S, can } = C;
const db = () => C.db();
const ROLE = { super_admin: "Super Admin — toàn quyền", admin: "Admin — quản lý hầu hết chức năng (trừ nhân sự)", editor: "Editor — biên tập nội dung & sản phẩm, SEO", contributor: "Contributor — chỉ soạn bản nháp", sales: "Sales — xử lý báo giá, xem đơn", order_manager: "Order Manager — xử lý đơn hàng" };
const ROLE_SHORT = { super_admin: "Super Admin", admin: "Admin", editor: "Editor", contributor: "Contributor", sales: "Sales", order_manager: "Order Manager" };
const PERM = { "products.write": "Soạn sản phẩm", "products.publish": "Xuất bản sản phẩm/danh mục", "content.write": "Soạn nội dung", "content.publish": "Xuất bản nội dung, menu, trang chủ", "media.write": "Tải ảnh", "seo.write": "SEO & chuyển hướng", "orders.read": "Xem đơn hàng", "orders.write": "Xử lý đơn hàng", "quotes.read": "Xem báo giá", "quotes.write": "Xử lý báo giá", "contacts.read": "Xem liên hệ", "contacts.write": "Xử lý liên hệ", "settings.write": "Cài đặt & theo dõi (GA4/GTM)", "staff.manage": "Quản lý nhân sự", "audit.read": "Xem nhật ký thao tác", "export.data": "Xuất dữ liệu CSV" };
const API_ERR = { INVALID_EMAIL: "Email không hợp lệ.", INVALID_NAME: "Tên phải từ 1 đến 80 ký tự.", INVALID_ROLE: "Vai trò không hợp lệ.", INVALID_USER: "Tài khoản không hợp lệ.", ALREADY_STAFF: "Email này đã là nhân viên.", EMAIL_TAKEN: "Email đã tồn tại trong hệ thống đăng nhập nhưng không tìm thấy — thử lại sau.",
  SELF_CHANGE: "Không thể tự đổi vai trò hoặc tự khoá chính mình.", SELF_RESET: "Hãy đổi mật khẩu của chính mình ở mục “Tài khoản”.", LAST_SUPER_ADMIN: "Không thể hạ hoặc khoá Super Admin cuối cùng.", NOT_FOUND: "Không tìm thấy tài khoản.", NOTHING_TO_UPDATE: "Không có gì để cập nhật.",
  UNAUTHORIZED: "Phiên đăng nhập hết hạn — hãy đăng nhập lại.", FORBIDDEN: "Chỉ Super Admin được thực hiện thao tác này.", RATE: "Bạn thao tác quá nhanh, thử lại sau ít phút.", ORIGIN: "Yêu cầu bị từ chối.", AUTH_API: "Hệ thống đăng nhập (Supabase Auth) báo lỗi — kiểm tra khoá service_role của Worker.", DB_ERROR: "Lỗi cơ sở dữ liệu.", TOO_LARGE: "Dữ liệu quá lớn." };
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");

async function api(path, body) {
  const { data } = await db().auth.getSession(), tok = data.session && data.session.access_token;
  if (!tok) throw new Error(API_ERR.UNAUTHORIZED);
  const r = await fetch("/api/admin/" + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer " + tok, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(API_ERR[j.error] || "Lỗi máy chủ (" + r.status + ")."); e.code = j.error; throw e; }
  return j;
}
const copyBtn = (id, label) => `<button type="button" class="btn" data-copy="${id}">${esc(label)}</button>`;
function wireCopy(root) { $$("[data-copy]", root).forEach((b) => b.addEventListener("click", async () => { const el = $("#" + b.dataset.copy, root); try { await navigator.clipboard.writeText(el.textContent); toast("Đã sao chép."); } catch { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); toast("Hãy nhấn Ctrl+C để sao chép."); } })); }
function credsModal(title, email, pwd, note) {
  const m = openModal(`<h2>${esc(title)}</h2><p class="hint">${esc(note)}</p><div class="card"><p><span class="muted">Email đăng nhập</span><br><strong id="cr-email">${esc(email)}</strong> ${copyBtn("cr-email", "Sao chép")}</p>
    <p><span class="muted">Mật khẩu tạm</span><br><code id="cr-pwd" style="font-size:1.2rem;letter-spacing:.05em">${esc(pwd)}</code> ${copyBtn("cr-pwd", "Sao chép")}</p></div>
    <p class="error"><strong>Mật khẩu này chỉ hiện MỘT lần.</strong> Hãy chuyển cho nhân viên qua kênh riêng tư (không gửi công khai). Nhân viên sẽ bị bắt đổi mật khẩu ở lần đăng nhập đầu tiên.</p>
    <div class="actions"><button class="btn primary" id="cr-close">Tôi đã lưu lại</button></div>`);
  wireCopy(m); $("#cr-close", m).addEventListener("click", () => { closeModal(); C.reload(); });
}

// ================= NHÂN SỰ =================
let TAB = "list";
async function viewStaff() {
  const [r, perms] = await Promise.all([api("staff"), db().from("role_permissions").select("role,perm")]);
  if (perms.error) throw perms.error;
  const list = r.staff, me = r.me;
  const rows = list.map((s) => `<tr class="row" data-id="${s.user_id}"><td class="wrap"><strong>${esc(s.display_name || "(chưa đặt tên)")}</strong>${s.user_id === me ? ' <span class="badge ok">Bạn</span>' : ""}<br><small class="muted">${esc(s.email || "—")}</small></td>
    <td>${esc(ROLE_SHORT[s.role] || s.role)}</td><td>${s.active ? '<span class="badge ok">Hoạt động</span>' : '<span class="badge bad">Đã khoá</span>'}${s.must_change_password ? ' <span class="badge warn">Chờ đổi mật khẩu</span>' : ""}</td><td>${esc(fmtDT(s.last_sign_in_at))}</td></tr>`).join("");
  const roles = Object.keys(ROLE_SHORT), by = {}; for (const p of perms.data) (by[p.role] = by[p.role] || new Set()).add(p.perm);
  $("#view").innerHTML = `<h1>Nhân sự <span class="muted">(${list.length})</span></h1>
  <div class="tabs"><button class="${TAB === "list" ? "on" : ""}" data-t="list">Danh sách</button><button class="${TAB === "matrix" ? "on" : ""}" data-t="matrix">Quyền theo vai trò</button></div>
  <div data-p="list" ${TAB === "list" ? "" : "hidden"}><div class="toolbar"><button class="btn primary fix" id="st-new">+ Thêm nhân viên</button></div>
   <div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Chưa có nhân viên.</td></tr>'}</tbody></table></div>
   <p class="hint">Khoá tài khoản sẽ cắt ngay mọi quyền truy cập dữ liệu và chặn đăng nhập. Nên khoá thay vì xoá để giữ lịch sử thao tác.</p></div>
  <div data-p="matrix" ${TAB === "matrix" ? "" : "hidden"}><p class="hint">Chỉ để xem. Quyền được định nghĩa trong cơ sở dữ liệu (file <code>seed_core.sql</code>); thay đổi cần chạy SQL để tránh phân quyền sai trên giao diện.</p>
   <div class="table-wrap"><table><thead><tr><th>Quyền</th>${roles.map((x) => `<th>${esc(ROLE_SHORT[x])}</th>`).join("")}</tr></thead><tbody>${Object.entries(PERM).map(([k, l]) => `<tr><td>${esc(l)}</td>${roles.map((x) => `<td>${by[x] && by[x].has(k) ? "✓" : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  const v = $("#view");
  $$("[data-t]", v).forEach((b) => b.addEventListener("click", () => { TAB = b.dataset.t; $$("[data-t]", v).forEach((x) => x.classList.toggle("on", x === b)); $$("[data-p]", v).forEach((p) => (p.hidden = p.dataset.p !== TAB)); }));
  $("#st-new", v).addEventListener("click", addModal);
  $$("tr.row", v).forEach((tr) => tr.addEventListener("click", () => editModal(list.find((x) => x.user_id === tr.dataset.id), me)));
}
function addModal() {
  const m = openModal(`<form id="addform"><h2>Thêm nhân viên</h2><div class="form-grid">${inp("email", "Email đăng nhập *", "", 'type="email" maxlength="200" autocomplete="off"')}${inp("display_name", "Tên hiển thị *", "", "maxlength=80")}
    ${sel("role", "Vai trò *", Object.entries(ROLE).map(([k, v]) => [k, v]), "editor")}</div>
    <p class="hint">Hệ thống tạo tài khoản với <strong>mật khẩu tạm</strong> hiện một lần. Nếu email đã có tài khoản trong hệ thống, chỉ cấp vai trò (không đổi mật khẩu của họ).</p>
    <div class="actions"><button class="btn primary" type="submit">Tạo tài khoản</button><button class="btn" type="button" id="add-cancel">Đóng</button></div></form>`);
  const f = $("#addform", m); $("#add-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const body = { email: g(f, "email").value.trim(), display_name: g(f, "display_name").value.trim(), role: g(f, "role").value };
    if (!body.email || !body.display_name) throw new Error("Cần nhập email và tên hiển thị.");
    if (body.role === "super_admin" && !confirm("Cấp quyền SUPER ADMIN (toàn quyền, kể cả quản lý nhân sự) cho " + body.email + "?")) return;
    const r = await api("staff/create", body);
    if (r.existing) { closeModal(); toast(`Đã cấp vai trò ${ROLE_SHORT[r.role]} cho tài khoản có sẵn ${r.email}. Họ dùng mật khẩu hiện tại của mình.`); C.reload(); }
    else credsModal("Đã tạo tài khoản", r.email, r.temp_password, `Vai trò: ${ROLE_SHORT[r.role]}.`);
  }); });
}
function editModal(s, me) {
  const self = s.user_id === me;
  const m = openModal(`<form id="edform"><h2>${esc(s.display_name || s.email)}</h2><p class="muted">${esc(s.email || "")} · đăng nhập gần nhất: ${esc(fmtDT(s.last_sign_in_at))}</p>
    ${self ? '<p class="hint">Đây là tài khoản của bạn: không thể tự đổi vai trò, tự khoá, hoặc đặt lại mật khẩu ở đây (dùng nút “Tài khoản” trên cùng).</p>' : ""}
    <div class="form-grid">${inp("display_name", "Tên hiển thị", s.display_name || "", "maxlength=80")}${sel("role", "Vai trò", Object.entries(ROLE).map(([k, v]) => [k, v]), s.role, self ? "disabled" : "")}</div>
    <div class="actions"><button class="btn primary" type="submit">Lưu thay đổi</button>${self ? "" : `<button class="btn ${s.active ? "danger" : ""}" type="button" id="ed-toggle">${s.active ? "Khoá tài khoản" : "Mở khoá tài khoản"}</button><button class="btn" type="button" id="ed-reset">Đặt lại mật khẩu</button>`}<button class="btn" type="button" id="ed-cancel">Đóng</button></div></form>`);
  const f = $("#edform", m); $("#ed-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const body = { user_id: s.user_id }, name = g(f, "display_name").value.trim(), role = g(f, "role").value;
    if (name !== (s.display_name || "")) body.display_name = name;
    if (!self && role !== s.role) { if ((role === "super_admin" || s.role === "super_admin") && !confirm(role === "super_admin" ? "Cấp quyền SUPER ADMIN cho người này?" : "Hạ quyền Super Admin của người này?")) return; body.role = role; }
    if (Object.keys(body).length === 1) return toast("Chưa có thay đổi nào.");
    await api("staff/update", body); closeModal(); toast("Đã cập nhật. Nhân viên cần tải lại trang để thấy quyền mới."); C.reload();
  }); });
  $("#ed-toggle", m)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    if (!confirm(s.active ? "Khoá tài khoản này? Họ sẽ mất ngay mọi quyền và không đăng nhập được." : "Mở khoá tài khoản này?")) return;
    const r = await api("staff/update", { user_id: s.user_id, active: !s.active }); closeModal(); toast(r.ban_failed ? "Đã đổi quyền truy cập dữ liệu nhưng KHÔNG chặn được đăng nhập ở tầng tài khoản — kiểm tra khoá service_role." : s.active ? "Đã khoá." : "Đã mở khoá.", !!r.ban_failed); C.reload();
  }));
  $("#ed-reset", m)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    if (!confirm("Đặt lại mật khẩu? Mật khẩu cũ sẽ không dùng được nữa.")) return;
    const r = await api("staff/reset-password", { user_id: s.user_id }); credsModal("Đã đặt lại mật khẩu", s.email || "", r.temp_password, "Nhân viên sẽ bị bắt đổi mật khẩu ở lần đăng nhập tiếp theo.");
  }));
}

// ================= NHẬT KÝ THAO TÁC =================
const AF = { entity: "", actor: "", from: "", to: "", q: "", page: 0 };
const ENT = ["products", "orders", "quote_requests", "content_items", "categories", "brands", "menus", "home_blocks", "redirects", "site_settings", "shipping_rules", "staff", "staff_admin"];
const ENT_L = { products: "Sản phẩm", orders: "Đơn hàng", quote_requests: "Báo giá", content_items: "Nội dung", categories: "Danh mục", brands: "Thương hiệu", menus: "Menu", home_blocks: "Khối trang chủ", redirects: "Chuyển hướng", site_settings: "Cài đặt", shipping_rules: "Phí vận chuyển", staff: "Nhân sự (dữ liệu)", staff_admin: "Nhân sự (quản trị)" };
const ACT_L = { insert: "Thêm", update: "Sửa", delete: "Xoá", "staff.create": "Tạo tài khoản", "staff.update": "Sửa nhân sự", "staff.reset_password": "Đặt lại mật khẩu" };
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? "∅" : s.length > 50 ? s.slice(0, 50) + "…" : s; };
function diffText(a) {
  const d = a.diff || {};
  if (a.entity === "staff_admin") return Object.entries(d).map(([k, v]) => `${k}: ${short(v)}`).join(" · ");
  if (d.op) return "";
  return Object.entries(d).slice(0, 5).map(([k, v]) => `${k}: ${short(v && v.old)} → ${short(v && v.new)}`).join(" · ") + (Object.keys(d).length > 5 ? " …" : "");
}
function auditQuery(cols, count) {
  let q = db().from("audit_logs").select(cols, count ? { count: "exact" } : undefined).order("id", { ascending: false });
  if (AF.entity) q = q.eq("entity", AF.entity); if (AF.actor) q = q.eq("actor", AF.actor);
  if (AF.from) q = q.gte("at", new Date(AF.from + "T00:00:00").toISOString()); if (AF.to) q = q.lte("at", new Date(AF.to + "T23:59:59.999").toISOString());
  const s = AF.q.replace(/[,()%*\\"]/g, " ").trim(); if (s) q = q.ilike("entity_id", `%${s}%`);
  return q;
}
async function viewAudit() {
  const [dirR, res] = await Promise.all([db().rpc("staff_directory_all"), auditQuery("id,at,actor,action,entity,entity_id,diff", true).range(AF.page * 50, AF.page * 50 + 49)]);
  if (dirR.error) throw dirR.error; if (res.error) throw res.error;
  const dir = Object.fromEntries(dirR.data.map((x) => [x.user_id, x])), who = (id) => (id ? (dir[id] ? dir[id].display_name + (dir[id].active ? "" : " (đã khoá)") : "(không rõ)") : "Hệ thống/khách");
  const pages = Math.max(1, Math.ceil((res.count || 0) / 50));
  $("#view").innerHTML = `<h1>Nhật ký thao tác <span class="muted">(${res.count ?? 0})</span></h1>
  <div class="toolbar">${sel("e", "Đối tượng", [["", "Tất cả"], ...ENT.map((k) => [k, ENT_L[k]])], AF.entity, 'id="af-e"')}${sel("a", "Người thực hiện", [["", "Tất cả"], ...dirR.data.map((x) => [x.user_id, x.display_name])], AF.actor, 'id="af-a"')}
   <label>Từ ngày<input type="date" id="af-from" value="${esc(AF.from)}"></label><label>Đến ngày<input type="date" id="af-to" value="${esc(AF.to)}"></label><label>Mã đối tượng<input id="af-q" value="${esc(AF.q)}" placeholder="Enter để lọc"></label>
   ${can("export.data") ? '<button class="btn fix" id="af-csv">Xuất CSV</button>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>
  ${res.data.map((a) => `<tr><td>${esc(fmtDT(a.at))}</td><td>${esc(who(a.actor))}</td><td>${esc(ACT_L[a.action] || a.action)}</td><td>${esc(ENT_L[a.entity] || a.entity)}<br><small class="muted">${esc(a.entity_id || "")}</small></td><td class="wrap"><small>${esc(diffText(a))}</small></td></tr>`).join("") || '<tr><td colspan="5" class="muted">Không có bản ghi.</td></tr>'}</tbody></table></div>
  <div class="pager"><button class="btn" id="af-prev" ${AF.page <= 0 ? "disabled" : ""}>‹ Trước</button><span>Trang ${AF.page + 1}/${pages}</span><button class="btn" id="af-next" ${AF.page + 1 >= pages ? "disabled" : ""}>Sau ›</button></div>
  <p class="hint">Nhật ký chỉ đọc, không sửa/xoá được từ giao diện. Giá trị dài được rút gọn.</p>`;
  const v = $("#view"), bind = (id, k) => $(id, v).addEventListener("change", (e) => { AF[k] = e.target.value; AF.page = 0; C.reload(); });
  bind("#af-e", "entity"); bind("#af-a", "actor"); bind("#af-from", "from"); bind("#af-to", "to");
  $("#af-q", v).addEventListener("keydown", (e) => { if (e.key === "Enter") { AF.q = e.target.value.trim(); AF.page = 0; C.reload(); } });
  $("#af-prev", v).addEventListener("click", () => { AF.page--; C.reload(); }); $("#af-next", v).addEventListener("click", () => { AF.page++; C.reload(); });
  $("#af-csv", v)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const all = []; for (let off = 0; off < 5000; off += 1000) { const r = await auditQuery("at,actor,action,entity,entity_id,diff").range(off, off + 999); if (r.error) throw r.error; all.push(...r.data); if (r.data.length < 1000) break; }
    const cell = (x) => { let t = String(x ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const text = String.fromCharCode(65279) + [["Thời gian", "Người thực hiện", "Hành động", "Đối tượng", "Mã", "Chi tiết"], ...all.map((a) => [fmtDT(a.at), who(a.actor), ACT_L[a.action] || a.action, ENT_L[a.entity] || a.entity, a.entity_id, diffText(a)])].map((r) => r.map(cell).join(",")).join("\r\n");
    const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); el.download = "nhat-ky-thao-tac.csv"; document.body.appendChild(el); el.click(); el.remove(); toast(`Đã xuất ${all.length} dòng.`);
  }));
}

// ================= TÀI KHOẢN CỦA TÔI =================
const pwProblem = (p) => (p.length < 10 ? "Mật khẩu tối thiểu 10 ký tự." : !/[A-Za-z]/.test(p) || !/[0-9]/.test(p) ? "Mật khẩu cần có cả chữ và số." : "");
async function changePassword(pw1, pw2) {
  if (pw1 !== pw2) throw new Error("Hai mật khẩu không khớp.");
  const bad = pwProblem(pw1); if (bad) throw new Error(bad);
  const r = await db().auth.updateUser({ password: pw1, data: { must_change_password: false } }); if (r.error) throw r.error;
  if (S.user) S.user.user_metadata = { ...(S.user.user_metadata || {}), must_change_password: false };
}
function accountModal() {
  const m = openModal(`<h2>Tài khoản của tôi</h2><p class="muted">${esc(S.user.email || "")} · ${esc(S.staff ? S.staff.role : "")}</p>
    <form id="nameform" class="card"><h3>Tên hiển thị</h3><div class="form-grid">${inp("name", "Tên", (S.staff && S.staff.display_name) || "", "maxlength=80")}</div><div class="actions"><button class="btn primary" type="submit">Lưu tên</button></div></form>
    <form id="pwform" class="card" style="margin-top:12px"><h3>Đổi mật khẩu</h3><div class="form-grid">${inp("p1", "Mật khẩu mới (≥ 10 ký tự, có chữ và số)", "", 'type="password" autocomplete="new-password"')}${inp("p2", "Nhập lại mật khẩu", "", 'type="password" autocomplete="new-password"')}</div><div class="actions"><button class="btn primary" type="submit">Đổi mật khẩu</button></div></form>
    <div class="actions"><button class="btn" id="acc-close">Đóng</button></div>`);
  $("#acc-close", m).addEventListener("click", closeModal);
  $("#nameform", m).addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button", ev.target), async () => { const n = g(ev.target, "name").value.trim(); const r = await db().rpc("update_my_profile", { p_name: n }); if (r.error) throw r.error; if (S.staff) S.staff.display_name = n; const w = $("#who"); if (w) w.textContent = `${n} · ${S.staff.role}`; toast("Đã lưu tên."); }); });
  $("#pwform", m).addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button", ev.target), async () => { await changePassword(g(ev.target, "p1").value, g(ev.target, "p2").value); ev.target.reset(); toast("Đã đổi mật khẩu."); }); });
}
// Bắt buộc đổi mật khẩu tạm ở lần đăng nhập đầu: hộp thoại riêng, không đóng được bằng ESC/bấm nền.
function forcedChange() {
  if ($("#forced-pw")) return;
  const d = document.createElement("dialog"); d.id = "forced-pw";
  d.innerHTML = `<form id="fpw"><h2>Đặt mật khẩu mới</h2><p>Bạn đang dùng mật khẩu tạm do quản trị viên cấp. Vì an toàn, hãy đặt mật khẩu riêng của bạn trước khi tiếp tục.</p><div class="form-grid">${inp("p1", "Mật khẩu mới (≥ 10 ký tự, có chữ và số)", "", 'type="password" autocomplete="new-password"')}${inp("p2", "Nhập lại mật khẩu", "", 'type="password" autocomplete="new-password"')}</div><div class="actions"><button class="btn primary" type="submit">Lưu mật khẩu</button></div></form>`;
  document.body.appendChild(d); d.addEventListener("cancel", (e) => e.preventDefault()); d.showModal();
  $("#fpw", d).addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button", ev.target), async () => { await changePassword(g(ev.target, "p1").value, g(ev.target, "p2").value); d.close(); d.remove(); toast("Đã đặt mật khẩu mới."); }); });
}
C.onLogin = (user) => { if (user && user.user_metadata && user.user_metadata.must_change_password) forcedChange(); };
const accBtn = document.createElement("button"); accBtn.className = "btn ghost"; accBtn.id = "account-btn"; accBtn.textContent = "Tài khoản"; accBtn.addEventListener("click", accountModal);
const lo = $("#logout"); if (lo) lo.before(accBtn);

C.register({ key: "staff", title: "Nhân sự", group: "system", perm: "staff.manage", view: viewStaff });
C.register({ key: "auditlog", title: "Nhật ký thao tác", group: "system", perm: "audit.read", view: viewAudit });
})();
