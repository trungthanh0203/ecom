/* CMS quản trị — JS thuần, không build. Quyền thật nằm ở RLS/trigger trong DB; UI chỉ ẩn/hiện cho tiện. */
(() => {
"use strict";
const C = window.APP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const vnd = (n) => (n == null || n === "" ? "—" : new Intl.NumberFormat("vi-VN").format(n) + " đ");
const slugify = (s) => String(s || "").replace(/[đĐ]/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ST = { draft: "Nháp", reviewed: "Đã duyệt", published: "Đã xuất bản", hidden: "Ẩn", archived: "Lưu trữ" };
const LANG_NAME = { vi: "Tiếng Việt", en: "English" };
const MSG = [
  [/PUBLISH_NEEDS_VI_TRANSLATION/, "Cần có bản dịch tiếng Việt ở trạng thái “Đã xuất bản” trước khi xuất bản sản phẩm."],
  [/products_publish_needs_price/, "Sản phẩm bán lẻ phải có giá lớn hơn 0 mới được xuất bản."],
  [/products_sale_valid/, "Giá khuyến mại phải thấp hơn giá gốc, có ngày kết thúc, và ngày bắt đầu phải trước ngày kết thúc."],
  [/VI_TRANSLATION_REQUIRED/, "Không thể gỡ/xoá bản dịch tiếng Việt khi sản phẩm đang xuất bản. Hãy ẩn sản phẩm trước."],
  [/products_sku_unique/, "SKU đã tồn tại."],
  [/_lang_slug_key/, "Slug (đường dẫn) đã được dùng trong cùng ngôn ngữ."],
  [/row-level security|permission denied/, "Bạn không có quyền thực hiện thao tác này."],
  [/foreign key/, "Dữ liệu đang được sử dụng ở nơi khác nên không thể xoá."],
  [/attribute_defs_category_id_code_key/, "Mã thuộc tính đã tồn tại trong danh mục này."],
  [/shipping_rules_province_uq/, "Đã có quy tắc vận chuyển cho tỉnh/thành này."],
  [/INVALID_(ORDER|PAYMENT|SHIPPING|QUOTE)_TRANSITION/, "Không thể chuyển sang trạng thái này từ trạng thái hiện tại."],
  [/Failed to fetch|NetworkError/, "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại."]
];
const errMsg = (e) => {
  const t = [e?.message, e?.details, e?.hint].filter(Boolean).join(" ");
  for (const [re, m] of MSG) if (re.test(t)) return m;
  return "Lỗi: " + (t || "không xác định");
};

let sb, S = { user: null, staff: null, perms: new Set(), cats: [], brands: [], defs: [], pf: { q: "", status: "", cat: "", page: 0 } };
const can = (p) => S.perms.has(p);

// ---------- UI helpers ----------
let toastT;
function toast(msg, isErr) {
  const t = $("#toast"); t.textContent = msg; t.className = isErr ? "err" : ""; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), isErr ? 7000 : 3000);
}
function openModal(html) { const m = $("#modal"); m.innerHTML = html; if (!m.open) m.showModal(); return m; }
function closeModal() { const m = $("#modal"); if (m.open) m.close(); m.innerHTML = ""; }
async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), true); console.error(e); } finally { btn.disabled = false; }
}
const inp = (name, label, val = "", extra = "") => `<label>${esc(label)}<input name="${name}" value="${esc(val)}" ${extra}></label>`;
const txa = (name, label, val = "", rows = 3) => `<label class="full">${esc(label)}<textarea name="${name}" rows="${rows}">${esc(val)}</textarea></label>`;
const sel = (name, label, opts, cur, extra = "") =>
  `<label>${esc(label)}<select name="${name}" ${extra}>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
const chk = (name, label, on) => `<label class="chk"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${esc(label)}</label>`;
const g = (root, n) => root.querySelector(`[name="${n}"]`);
const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const pubUrl = (path) => `${C.SUPABASE_URL}/storage/v1/object/public/media/${path.split("/").map(encodeURIComponent).join("/")}`;
function tabs(root) {
  const btns = $$(".tabs button", root), panes = $$(".pane", root);
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.classList.toggle("on", x === b)); panes.forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
}

// ---------- Auth & boot ----------
async function boot() {
  $("#site-name").textContent = C.SITE_NAME || "Quản trị"; document.title = C.SITE_NAME || "Quản trị";
  if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) {
    $("#boot").innerHTML = "Chưa cấu hình. Điền <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code> trong <code>config.js</code>.";
    return;
  }
  sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  $("#login-form").addEventListener("submit", onLogin);
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); showLogin(); });
  $("#nav-toggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
  $("#modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  window.addEventListener("hashchange", route);
  const { data } = await sb.auth.getSession();
  if (data.session) await afterLogin(); else showLogin();
}
function showLogin(msg) {
  $("#boot").hidden = true; $("#app").hidden = true; $("#login").hidden = false;
  const e = $("#login-error"); e.hidden = !msg; e.textContent = msg || "";
}
async function onLogin(ev) {
  ev.preventDefault();
  const f = ev.target, btn = $("button", f); btn.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) return showLogin("Email hoặc mật khẩu không đúng.");
    f.password.value = ""; await afterLogin();
  } catch (e) { showLogin(errMsg(e)); } finally { btn.disabled = false; }
}
async function afterLogin() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    const { data: st, error } = await sb.from("staff").select("role,display_name,active").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!st || !st.active) { await sb.auth.signOut(); return showLogin("Tài khoản chưa được cấp quyền quản trị hoặc đã bị vô hiệu hoá."); }
    const { data: perms, error: e2 } = await sb.from("role_permissions").select("perm").eq("role", st.role);
    if (e2) throw e2;
    S.user = user; S.staff = st; S.perms = new Set(perms.map((p) => p.perm));
    $("#who").textContent = `${st.display_name || user.email} · ${st.role}`;
    await loadRefs();
    $("#boot").hidden = true; $("#login").hidden = true; $("#app").hidden = false;
    buildNav(); route();
  } catch (e) { showLogin(errMsg(e)); console.error(e); }
}
async function loadRefs() {
  const [c, b, d] = await Promise.all([
    sb.from("categories").select("id,parent_id,sort,active,category_translations(lang,name,slug,status)").order("sort").order("id"),
    sb.from("brands").select("id,sort,active,logo_path,website,brand_translations(lang,name,slug,status)").order("sort").order("id"),
    sb.from("attribute_defs").select("*").order("sort").order("id")
  ]);
  for (const r of [c, b, d]) if (r.error) throw r.error;
  S.cats = c.data; S.brands = b.data; S.defs = d.data;
}
const trName = (row, key, lang = "vi") => (row[key] || []).find((t) => t.lang === lang)?.name;
const catName = (id) => { const c = S.cats.find((x) => x.id === id); return c ? trName(c, "category_translations") || `#${c.id}` : "—"; };
const brandName = (id) => { const c = S.brands.find((x) => x.id === id); return c ? trName(c, "brand_translations") || `#${c.id}` : "—"; };

// ---------- Nav & router ----------
const ROUTES = [
  ["dashboard", "Tổng quan", null], ["products", "Sản phẩm", null], ["categories", "Danh mục", null],
  ["brands", "Thương hiệu", null], ["attributes", "Thuộc tính kỹ thuật", null]
];
const EXT = {};   // module đăng ký thêm (ops.js): {key,title,perm,view,after}
window.CMS = { $, $$, esc, vnd, toast, busy, errMsg, openModal, closeModal, inp, txa, sel, chk, g, numOrNull, S, can, db: () => sb, reload: () => route(), register: (d) => { EXT[d.key] = d; } };
function buildNav() {
  const ext = Object.values(EXT).filter((d) => !d.perm || can(d.perm));
  const a = (k, t) => `<a href="#/${k}" data-k="${k}">${esc(t)}</a>`;
  const ops = ext.filter((d) => !d.after).map((d) => a(d.key, d.title)).join(""), tail = ext.filter((d) => d.after).map((d) => a(d.key, d.title)).join("");
  $("#nav").innerHTML = a("dashboard", "Tổng quan") + (ops ? `<div class="sep">Vận hành</div>${ops}` : "") + '<div class="sep">Catalogue</div>'
    + ROUTES.filter(([k]) => k !== "dashboard").map(([k, t]) => a(k, t)).join("") + (tail ? `<div class="sep">Hệ thống</div>${tail}` : "");
}
let routeTok = 0;
async function route() {
  const [, k = "dashboard", arg] = location.hash.replace(/^#/, "").split("/");
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.k === k));
  $("#nav").classList.remove("open");
  const tok = ++routeTok, v = $("#view");
  v.innerHTML = '<p class="muted">Đang tải…</p>';
  try {
    const fn = EXT[k] && (!EXT[k].perm || can(EXT[k].perm)) ? EXT[k].view : { dashboard: viewDashboard, products: arg ? viewProductEdit : viewProducts, categories: viewCategories, brands: viewBrands, attributes: viewAttributes }[k];
    if (!fn) { v.innerHTML = "<h1>Không tìm thấy trang</h1>"; return; }
    const html = await fn(arg, tok);
    if (tok === routeTok && typeof html === "string") v.innerHTML = html;
  } catch (e) { if (tok === routeTok) v.innerHTML = `<h1>Lỗi</h1><p class="error">${esc(errMsg(e))}</p>`; console.error(e); }
  v.focus({ preventScroll: true });
}

// ---------- Dashboard ----------
async function viewDashboard() {
  const { data, error } = await sb.rpc("dashboard_stats");
  if (error) throw error;
  const L = { products_total: "Tổng sản phẩm", products_selling: "Sản phẩm đang bán", content_pending: "Nội dung chờ xuất bản",
    orders_new: "Đơn hàng mới", quotes_new: "Yêu cầu báo giá mới" };
  const ST_O = { new: "Mới tiếp nhận", confirmed: "Đã xác nhận", preparing: "Đang chuẩn bị", shipping: "Đang giao", completed: "Hoàn thành", cancelled: "Đã huỷ", returned: "Hoàn trả" };
  const cards = Object.keys(L).filter((k) => k in data).map((k) => `<div class="card stat"><span class="muted">${L[k]}</span><b>${data[k]}</b></div>`).join("");
  const rev = "revenue_paid" in data ? `<div class="card stat"><span class="muted">Doanh thu (chỉ đơn đã xác nhận thanh toán)</span><b>${vnd(data.revenue_paid)}</b></div>` : "";
  const bs = data.orders_by_status ? `<h2>Đơn hàng theo trạng thái</h2><div class="grid">${Object.entries(data.orders_by_status).map(([k, n]) => `<div class="card stat"><span class="muted">${esc(ST_O[k] || k)}</span><b>${n}</b></div>`).join("") || '<p class="muted">Chưa có đơn.</p>'}</div>` : "";
  return `<h1>Tổng quan</h1><div class="grid">${cards}${rev}</div>${bs}`;
}

// ---------- Sản phẩm: danh sách ----------
const PAGE = 25;
async function viewProducts() {
  const f = S.pf, a = f.page * PAGE;
  let qy = sb.from("products").select("id,sku,price,sale_price,status,retail_enabled,featured,category_id,updated_at,product_translations(lang,name,status)", { count: "exact" })
    .order("updated_at", { ascending: false }).range(a, a + PAGE - 1);
  if (f.status) qy = qy.eq("status", f.status);
  if (f.cat) qy = qy.eq("category_id", Number(f.cat));
  if (f.q) {
    const safe = f.q.replace(/[,()%*\\]/g, " ").trim();
    const { data: ids } = await sb.from("product_translations").select("product_id").ilike("name", `%${safe}%`).limit(200);
    const idl = [...new Set((ids || []).map((x) => x.product_id))];
    qy = qy.or(`sku.ilike.%${safe}%` + (idl.length ? `,id.in.(${idl.join(",")})` : ""));
  }
  const { data, count, error } = await qy;
  if (error) throw error;
  const trBadge = (p, lang) => {
    const t = (p.product_translations || []).find((x) => x.lang === lang);
    if (!t) return `<span class="badge bad">${lang.toUpperCase()}: thiếu</span>`;
    return `<span class="badge ${t.status === "published" ? "ok" : "warn"}">${lang.toUpperCase()}: ${esc(ST[t.status])}</span>`;
  };
  const rows = data.map((p) => `<tr class="row" data-id="${p.id}"><td>${esc(p.sku)}</td><td class="wrap">${esc(trName(p, "product_translations") || "(chưa có tên)")}</td>
    <td>${esc(catName(p.category_id))}</td><td>${vnd(p.price)}${p.sale_price != null ? `<br><small class="badge warn">KM ${vnd(p.sale_price)}</small>` : ""}</td>
    <td><span class="badge ${p.status === "published" ? "ok" : ""}">${esc(ST[p.status])}</span>${p.retail_enabled ? "" : '<span class="badge">Không bán lẻ</span>'}</td>
    <td>${C.LANGS.map((l) => trBadge(p, l)).join("")}</td></tr>`).join("");
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
  const html = `<h1>Sản phẩm <span class="muted">(${count ?? 0})</span></h1>
  <div class="toolbar">
    <label>Tìm (SKU / tên)<input id="pf-q" value="${esc(f.q)}" placeholder="Nhập rồi Enter"></label>
    ${sel("pf-status", "Trạng thái", [["", "Tất cả"], ...Object.entries(ST).filter(([k]) => ["draft", "published", "hidden", "archived"].includes(k))], f.status, 'id="pf-status"')}
    ${sel("pf-cat", "Danh mục", [["", "Tất cả"], ...S.cats.map((c) => [c.id, catName(c.id)])], f.cat, 'id="pf-cat"')}
    ${can("products.write") ? '<button class="btn primary fix" id="p-new">+ Thêm sản phẩm</button>' : ""}
  </div>
  <div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên</th><th>Danh mục</th><th>Giá (chưa VAT)</th><th>Trạng thái</th><th>Bản dịch</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">Chưa có sản phẩm.</td></tr>'}</tbody></table></div>
  <div class="pager"><button class="btn" id="pg-prev" ${f.page <= 0 ? "disabled" : ""}>‹ Trước</button><span>Trang ${f.page + 1}/${pages}</span><button class="btn" id="pg-next" ${f.page + 1 >= pages ? "disabled" : ""}>Sau ›</button></div>`;
  $("#view").innerHTML = html;
  const v = $("#view");
  v.querySelector("#pf-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { f.q = e.target.value.trim(); f.page = 0; route(); } });
  v.querySelector("#pf-status").addEventListener("change", (e) => { f.status = e.target.value; f.page = 0; route(); });
  v.querySelector("#pf-cat").addEventListener("change", (e) => { f.cat = e.target.value; f.page = 0; route(); });
  v.querySelector("#pg-prev").addEventListener("click", () => { f.page--; route(); });
  v.querySelector("#pg-next").addEventListener("click", () => { f.page++; route(); });
  v.querySelector("#p-new")?.addEventListener("click", () => (location.hash = "#/products/new"));
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => (location.hash = "#/products/" + r.dataset.id)));
}

// ---------- Sản phẩm: sửa ----------
const PT_FIELDS = [["name", "Tên *", "input"], ["slug", "Slug (đường dẫn)", "input"], ["short_desc", "Mô tả ngắn", "ta2"], ["description", "Mô tả chi tiết", "ta8"],
  ["features", "Đặc tính & lợi ích", "ta4"], ["shipping_info", "Vận chuyển / chính sách", "ta3"], ["seo_title", "SEO title", "input"], ["seo_description", "SEO description", "ta2"]];

function trFieldset(lang, t, fields, canPublish, tag) {
  t = t || {};
  const opts = canPublish ? [["draft", "Nháp"], ["reviewed", "Đã duyệt"], ["published", "Đã xuất bản"]] : [["draft", "Nháp"]];
  const body = fields.map(([k, lab, type]) => {
    if (type === "input") return inp(`${lang}__${k}`, lab, t[k] || "");
    return txa(`${lang}__${k}`, lab, t[k] || "", Number(type.slice(2)));
  }).join("");
  return `<fieldset class="tr" data-lang="${lang}"><legend>${esc(LANG_NAME[lang] || lang)}</legend><div class="form-grid">${body}
    ${sel(`${lang}__status`, "Trạng thái bản dịch", opts, t.status || "draft")}
    <div>${chk(`${lang}__machine_translated`, "Đây là bản dịch máy (cần người duyệt)", t.machine_translated)}</div></div>
    ${lang !== "vi" ? '<p class="hint">Bản dịch máy không tự xuất bản — chỉ chuyển “Đã xuất bản” sau khi người có quyền đã đọc duyệt.</p>' : ""}</fieldset>`;
}
function readTr(root, lang, fields, requireName = true) {
  const o = {}; let any = false;
  for (const [k] of fields) { const v = (g(root, `${lang}__${k}`)?.value || "").trim(); o[k] = v || null; if (v) any = true; }
  if (!any) return null;
  if (!o.name) throw new Error(`Bản dịch ${lang.toUpperCase()}: thiếu tên.`);
  o.slug = o.slug || slugify(o.name);
  if (!SLUG_RE.test(o.slug)) throw new Error(`Bản dịch ${lang.toUpperCase()}: slug chỉ gồm a-z, 0-9 và dấu gạch ngang.`);
  o.status = g(root, `${lang}__status`).value; o.machine_translated = g(root, `${lang}__machine_translated`).checked; o.lang = lang;
  return o;
}

async function viewProductEdit(arg) {
  const isNew = arg === "new";
  if (isNew && !can("products.write")) return '<h1>Không có quyền</h1><p class="error">Bạn không có quyền tạo sản phẩm.</p>';
  let P = { id: null, status: "draft", retail_enabled: true, attrs: {}, currency: "VND" }, TR = {}, IMGS = [];
  if (!isNew) {
    const id = Number(arg);
    const [p, t, im] = await Promise.all([
      sb.from("products").select("*").eq("id", id).maybeSingle(),
      sb.from("product_translations").select("*").eq("product_id", id),
      sb.from("product_images").select("*").eq("product_id", id).order("sort").order("id")
    ]);
    for (const r of [p, t, im]) if (r.error) throw r.error;
    if (!p.data) return '<h1>Không tìm thấy sản phẩm</h1><p><a href="#/products">← Danh sách</a></p>';
    P = p.data; t.data.forEach((x) => (TR[x.lang] = x)); IMGS = im.data;
  }
  const canW = can("products.write"), canPub = can("products.publish");
  const statusOpts = canPub ? [["draft", "Nháp"], ["published", "Đã xuất bản"], ["hidden", "Ẩn"], ["archived", "Lưu trữ"]] : [["draft", "Nháp"]];
  const html = `<p><a href="#/products">← Danh sách sản phẩm</a></p><h1>${isNew ? "Thêm sản phẩm" : "Sản phẩm: " + esc(P.sku)}</h1>
  <form id="pform" class="card" novalidate>
   <div class="tabs"><button type="button" class="on" data-tab="gen">Thông tin chung</button>
     ${C.LANGS.map((l) => `<button type="button" data-tab="tr-${l}">Bản dịch ${l.toUpperCase()}</button>`).join("")}
     <button type="button" data-tab="attrs">Thông số kỹ thuật</button><button type="button" data-tab="imgs">Hình ảnh</button></div>
   <div class="pane" data-pane="gen"><div class="form-grid">
     ${inp("sku", "SKU *", P.sku || "", "required maxlength=60")}
     ${sel("category_id", "Danh mục", [["", "— Chọn —"], ...S.cats.map((c) => [c.id, catName(c.id)])], P.category_id)}
     ${sel("brand_id", "Thương hiệu", [["", "— Không —"], ...S.brands.map((b) => [b.id, brandName(b.id)])], P.brand_id)}
     ${sel("status", "Trạng thái", statusOpts, P.status)}
     ${inp("price", "Giá bán lẻ niêm yết (VND, CHƯA gồm VAT)", P.price ?? "", 'type="number" min="0" step="1"')}
     ${inp("sale_price", "Giá khuyến mại (VND)", P.sale_price ?? "", 'type="number" min="0" step="1"')}
     ${inp("sale_start", "KM bắt đầu (trống = ngay)", toLocalInput(P.sale_start), 'type="datetime-local"')}
     ${inp("sale_end", "KM kết thúc (bắt buộc nếu có giá KM)", toLocalInput(P.sale_end), 'type="datetime-local"')}
     ${inp("unit", "Đơn vị tính", P.unit || "")}${inp("package_info", "Quy cách đóng gói", P.package_info || "")}
     <div>${chk("retail_enabled", "Cho phép bán lẻ (có giỏ hàng) — bỏ chọn = chỉ báo giá", P.retail_enabled)}${chk("featured", "Sản phẩm nổi bật", P.featured)}${chk("is_new", "Sản phẩm mới", P.is_new)}</div>
   </div><p class="hint">Giá chỉ nhập một lần, dùng chung cho mọi ngôn ngữ. Sản phẩm bán lẻ cần giá > 0 và bản dịch tiếng Việt đã xuất bản mới xuất bản được.</p></div>
   ${C.LANGS.map((l) => `<div class="pane" data-pane="tr-${l}" hidden>${trFieldset(l, TR[l], PT_FIELDS, canPub)}</div>`).join("")}
   <div class="pane" data-pane="attrs" hidden><div id="attrs-box"></div></div>
   <div class="pane" data-pane="imgs" hidden><div id="imgs-box"></div></div>
   <div class="actions">${canW ? '<button class="btn primary" type="submit" id="p-save">Lưu</button>' : '<span class="muted">Chỉ xem (không có quyền sửa)</span>'}
     ${!isNew && canW ? '<button class="btn danger" type="button" id="p-del">Xoá sản phẩm</button>' : ""}</div>
  </form>`;
  $("#view").innerHTML = html;
  const root = $("#pform");
  tabs(root);
  if (!canW) $$("input,select,textarea", root).forEach((x) => (x.disabled = true));

  const renderAttrs = () => {
    const cat = g(root, "category_id").value ? Number(g(root, "category_id").value) : null;
    const defs = S.defs.filter((d) => d.category_id == null || d.category_id === cat);
    $("#attrs-box", root).innerHTML = defs.length ? `<div class="form-grid">${defs.map((d) => {
      const v = P.attrs?.[d.code]; const lab = d.label_vi + (d.unit ? ` (${d.unit})` : "");
      if (d.value_type === "boolean") return `<div>${chk("attr__" + d.code, lab, v === true)}</div>`;
      return inp("attr__" + d.code, lab, v ?? "", d.value_type === "number" ? 'type="number" step="any"' : "");
    }).join("")}</div>` : '<p class="muted">Danh mục này chưa có thuộc tính. Thêm ở mục “Thuộc tính kỹ thuật”.</p>';
    if (!canW) $$("input", $("#attrs-box", root)).forEach((x) => (x.disabled = true));
  };
  g(root, "category_id").addEventListener("change", () => { collectAttrs(); renderAttrs(); });
  const collectAttrs = () => {
    const cat = g(root, "category_id").value ? Number(g(root, "category_id").value) : null;
    const defs = S.defs.filter((d) => d.category_id == null || d.category_id === cat);
    const out = { ...(P.attrs || {}) };
    for (const d of defs) {
      const el = g(root, "attr__" + d.code); if (!el) continue;
      if (d.value_type === "boolean") out[d.code] = el.checked;
      else if (el.value === "") delete out[d.code];
      else out[d.code] = d.value_type === "number" ? Number(el.value) : el.value.trim();
    }
    P.attrs = out; return out;
  };
  renderAttrs();

  // Hình ảnh
  const renderImgs = () => {
    const box = $("#imgs-box", root);
    if (!P.id) { box.innerHTML = '<p class="muted">Lưu sản phẩm trước, sau đó mới thêm hình ảnh.</p>'; return; }
    box.innerHTML = `${can("media.write") ? '<label>Thêm ảnh (JPG/PNG/WebP, tự thu nhỏ ≤1600px)<input type="file" id="img-file" accept="image/jpeg,image/png,image/webp" multiple></label>' : ""}
      <div class="imgs" style="margin-top:12px">${IMGS.map((im) => `<div class="card img-card" data-id="${im.id}">
        <img src="${esc(pubUrl(im.path))}" alt="${esc(im.alt_vi || "")}" loading="lazy">
        <label>Alt (VI)<input data-f="alt_vi" value="${esc(im.alt_vi || "")}"></label><label>Alt (EN)<input data-f="alt_en" value="${esc(im.alt_en || "")}"></label>
        <label>Thứ tự<input data-f="sort" type="number" value="${im.sort}"></label>
        <div><span class="badge ${im.is_primary ? "ok" : ""}">${im.is_primary ? "Ảnh đại diện" : ""}</span></div>
        ${can("media.write") ? `<div><button type="button" class="btn" data-a="primary">Đặt làm đại diện</button> <button type="button" class="btn danger" data-a="del">Xoá</button></div>` : ""}</div>`).join("")}</div>`;
  };
  renderImgs();
  $("#imgs-box", root).addEventListener("change", async (e) => {
    if (e.target.id === "img-file") {
      const files = [...e.target.files]; e.target.disabled = true;
      try { for (const f of files) await uploadProductImage(P.id, f, IMGS); await reloadImgs(); toast("Đã tải ảnh lên."); }
      catch (er) { toast(errMsg(er), true); } finally { e.target.disabled = false; e.target.value = ""; }
    } else if (e.target.dataset.f) {
      const id = Number(e.target.closest(".img-card").dataset.id), k = e.target.dataset.f;
      const val = k === "sort" ? Number(e.target.value || 0) : e.target.value.trim() || null;
      const { error } = await sb.from("product_images").update({ [k]: val }).eq("id", id);
      if (error) toast(errMsg(error), true); else { IMGS.find((x) => x.id === id)[k] = val; toast("Đã lưu."); }
    }
  });
  $("#imgs-box", root).addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const card = b.closest(".img-card"), id = Number(card.dataset.id), im = IMGS.find((x) => x.id === id);
    await busy(b, async () => {
      if (b.dataset.a === "primary") {
        let r = await sb.from("product_images").update({ is_primary: false }).eq("product_id", P.id); if (r.error) throw r.error;
        r = await sb.from("product_images").update({ is_primary: true }).eq("id", id); if (r.error) throw r.error;
      } else if (confirm("Xoá ảnh này?")) {
        const r = await sb.from("product_images").delete().eq("id", id); if (r.error) throw r.error;
        await sb.storage.from("media").remove([im.path]);
      } else return;
      await reloadImgs();
    });
  });
  async function reloadImgs() {
    const { data, error } = await sb.from("product_images").select("*").eq("product_id", P.id).order("sort").order("id");
    if (error) throw error; IMGS = data; renderImgs();
  }

  // Lưu
  root.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy($("#p-save"), async () => {
      const desired = g(root, "status").value;
      const row = {
        sku: g(root, "sku").value.trim(), category_id: numOrNull(g(root, "category_id").value), brand_id: numOrNull(g(root, "brand_id").value),
        price: numOrNull(g(root, "price").value), sale_price: numOrNull(g(root, "sale_price").value),
        sale_start: g(root, "sale_start").value ? new Date(g(root, "sale_start").value).toISOString() : null,
        sale_end: g(root, "sale_end").value ? new Date(g(root, "sale_end").value).toISOString() : null,
        unit: g(root, "unit").value.trim() || null, package_info: g(root, "package_info").value.trim() || null,
        retail_enabled: g(root, "retail_enabled").checked, featured: g(root, "featured").checked, is_new: g(root, "is_new").checked,
        attrs: collectAttrs()
      };
      if (!row.sku) throw new Error("SKU không được để trống.");
      if (row.price != null && (!Number.isInteger(row.price) || row.price < 0)) throw new Error("Giá phải là số nguyên VND không âm.");
      const trs = C.LANGS.map((l) => readTr(root, l, PT_FIELDS)).filter(Boolean);
      // 1) lưu sản phẩm (giữ trạng thái hiện tại; trạng thái mới áp dụng ở bước 3 sau khi bản dịch đã lưu)
      if (!P.id) {
        const { data, error } = await sb.from("products").insert({ ...row, status: "draft" }).select("id,status").single();
        if (error) throw error; P.id = data.id; P.status = "draft";
      } else {
        const { error } = await sb.from("products").update(row).eq("id", P.id); if (error) throw error;
      }
      // 2) bản dịch
      if (trs.length) {
        const { error } = await sb.from("product_translations").upsert(trs.map((t) => ({ ...t, product_id: P.id })), { onConflict: "product_id,lang" });
        if (error) { history.replaceState(null, "", "#/products/" + P.id); throw error; }
      }
      // 3) trạng thái
      if (desired !== P.status) {
        const { error } = await sb.from("products").update({ status: desired }).eq("id", P.id);
        if (error) { history.replaceState(null, "", "#/products/" + P.id); throw error; }
      }
      toast("Đã lưu sản phẩm.");
      if (isNew) location.hash = "#/products/" + P.id; else route();
    });
  });
  $("#p-del")?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá vĩnh viễn sản phẩm này? Nên chọn “Lưu trữ” nếu sản phẩm đã từng có đơn hàng.")) return;
    if (IMGS.length) await sb.storage.from("media").remove(IMGS.map((x) => x.path));
    const { error } = await sb.from("products").delete().eq("id", P.id); if (error) throw error;
    toast("Đã xoá."); location.hash = "#/products";
  }));
}

async function uploadProductImage(productId, file, existing) {
  const blob = await resizeImage(file);
  const path = `products/${productId}/${crypto.randomUUID()}.webp`;
  const up = await sb.storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
  if (up.error) throw up.error;
  const { error } = await sb.from("product_images").insert({ product_id: productId, path, sort: existing.length, is_primary: existing.length === 0, alt_vi: null });
  if (error) { await sb.storage.from("media").remove([path]); throw error; }
}
async function resizeImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Chỉ chấp nhận JPG, PNG hoặc WebP.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Ảnh quá lớn (tối đa 20MB trước khi thu nhỏ).");
  const bmp = await createImageBitmap(file), r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * r); cv.height = Math.round(bmp.height * r);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((res) => cv.toBlob(res, "image/webp", 0.85));
  if (!blob) throw new Error("Không xử lý được ảnh."); if (blob.size > 5 * 1024 * 1024) throw new Error("Ảnh vẫn >5MB sau khi nén."); return blob;
}

// ---------- Danh mục & thương hiệu (cấu hình chung) ----------
const CT_FIELDS = [["name", "Tên *", "input"], ["slug", "Slug", "input"], ["description", "Mô tả", "ta3"], ["seo_title", "SEO title", "input"], ["seo_description", "SEO description", "ta2"]];
const ENT = {
  categories: { table: "categories", tr: "category_translations", fk: "category_id", title: "Danh mục", list: () => S.cats, key: "category_translations", perm: "products.publish" },
  brands: { table: "brands", tr: "brand_translations", fk: "brand_id", title: "Thương hiệu", list: () => S.brands, key: "brand_translations", perm: "products.publish" }
};
async function viewEntityList(name) {
  const cfg = ENT[name]; await loadRefs();
  const rows = cfg.list().map((r) => {
    const en = (r[cfg.key] || []).find((t) => t.lang === "en");
    return `<tr class="row" data-id="${r.id}"><td>${r.id}</td><td>${esc(trName(r, cfg.key) || "(chưa có tên)")}</td>
      ${name === "categories" ? `<td>${r.parent_id ? esc(catName(r.parent_id)) : "—"}</td>` : `<td>${esc(r.website || "—")}</td>`}
      <td>${r.sort}</td><td><span class="badge ${r.active ? "ok" : ""}">${r.active ? "Hiện" : "Ẩn"}</span></td>
      <td><span class="badge ${en ? (en.status === "published" ? "ok" : "warn") : "bad"}">EN: ${en ? esc(ST[en.status]) : "thiếu"}</span></td></tr>`;
  }).join("");
  $("#view").innerHTML = `<h1>${cfg.title}</h1><div class="toolbar">${can(cfg.perm) ? `<button class="btn primary fix" id="e-new">+ Thêm</button>` : '<span class="muted">Chỉ xem</span>'}</div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Tên</th><th>${name === "categories" ? "Danh mục cha" : "Website"}</th><th>Thứ tự</th><th>Hiển thị</th><th>Bản dịch EN</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">Chưa có dữ liệu.</td></tr>'}</tbody></table></div>`;
  $("#e-new")?.addEventListener("click", () => entityModal(name, null));
  $$("tr.row").forEach((r) => r.addEventListener("click", () => entityModal(name, Number(r.dataset.id))));
}
const viewCategories = () => viewEntityList("categories");
const viewBrands = () => viewEntityList("brands");

async function entityModal(name, id) {
  const cfg = ENT[name], canW = can(cfg.perm), canPub = can("products.publish");
  let row = { sort: 0, active: true }, TR = {};
  if (id) {
    const [r, t] = await Promise.all([sb.from(cfg.table).select("*").eq("id", id).single(), sb.from(cfg.tr).select("*").eq(cfg.fk, id)]);
    if (r.error) return toast(errMsg(r.error), true); if (t.error) return toast(errMsg(t.error), true);
    row = r.data; t.data.forEach((x) => (TR[x.lang] = x));
  }
  const parents = name === "categories" ? [["", "— Không (cấp cao nhất) —"], ...S.cats.filter((c) => c.id !== id).map((c) => [c.id, catName(c.id)])] : null;
  const m = openModal(`<form id="eform"><h2>${id ? "Sửa" : "Thêm"} ${cfg.title.toLowerCase()}</h2>
    <div class="form-grid">${parents ? sel("parent_id", "Danh mục cha", parents, row.parent_id) : inp("website", "Website thương hiệu", row.website || "", 'type="url"')}
      ${inp("sort", "Thứ tự", row.sort, 'type="number"')}<div>${chk("active", "Hiển thị trên website", row.active)}</div></div>
    ${name === "brands" ? `<label>Logo (JPG/PNG/WebP)<input type="file" name="logo" accept="image/jpeg,image/png,image/webp"></label>${row.logo_path ? `<img src="${esc(pubUrl(row.logo_path))}" alt="" height="48">` : ""}` : ""}
    <h2>Bản dịch</h2>${C.LANGS.map((l) => trFieldset(l, TR[l], CT_FIELDS, canPub)).join("")}
    ${!canW ? '<p class="hint">Bạn chỉ có quyền xem; chỉ Biên tập viên/Admin mới sửa được.</p>' : ""}
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="e-cancel">Đóng</button>
      ${id && canW ? '<button class="btn danger" type="button" id="e-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#eform", m);
  if (!canW) $$("input,select,textarea", f).forEach((x) => (x.disabled = true));
  $("#e-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy($("button[type=submit]", f), async () => {
      const trs = C.LANGS.map((l) => readTr(f, l, CT_FIELDS)).filter(Boolean);
      if (!trs.some((t) => t.lang === "vi")) throw new Error("Cần nhập ít nhất bản dịch tiếng Việt.");
      const base = { sort: Number(g(f, "sort").value || 0), active: g(f, "active").checked };
      if (name === "categories") base.parent_id = numOrNull(g(f, "parent_id").value); else base.website = g(f, "website").value.trim() || null;
      let rid = id;
      if (name === "brands" && g(f, "logo").files[0]) {
        const blob = await resizeImage(g(f, "logo").files[0], 600), path = `brands/${crypto.randomUUID()}.webp`;
        const up = await sb.storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }); if (up.error) throw up.error;
        base.logo_path = path;
      }
      if (rid) { const { error } = await sb.from(cfg.table).update(base).eq("id", rid); if (error) throw error; }
      else { const { data, error } = await sb.from(cfg.table).insert(base).select("id").single(); if (error) throw error; rid = data.id; }
      const { error } = await sb.from(cfg.tr).upsert(trs.map((t) => ({ ...t, [cfg.fk]: rid })), { onConflict: `${cfg.fk},lang` });
      if (error) throw error;
      closeModal(); toast("Đã lưu."); route();
    });
  });
  $("#e-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá mục này?")) return;
    const { error } = await sb.from(cfg.table).delete().eq("id", id); if (error) throw error;
    closeModal(); toast("Đã xoá."); route();
  }));
}

// ---------- Thuộc tính kỹ thuật ----------
let attrFilter = "";
async function viewAttributes() {
  await loadRefs();
  const list = S.defs.filter((d) => attrFilter === "" ? true : attrFilter === "global" ? d.category_id == null : String(d.category_id) === attrFilter);
  const canW = can("products.publish");
  $("#view").innerHTML = `<h1>Thuộc tính kỹ thuật</h1><div class="toolbar">
    ${sel("af", "Lọc theo danh mục", [["", "Tất cả"], ["global", "Dùng chung (mọi danh mục)"], ...S.cats.map((c) => [c.id, catName(c.id)])], attrFilter, 'id="af"')}
    ${canW ? '<button class="btn primary fix" id="a-new">+ Thêm thuộc tính</button>' : ""}</div>
    <div class="table-wrap"><table><thead><tr><th>Danh mục</th><th>Mã</th><th>Nhãn VI</th><th>Nhãn EN</th><th>Kiểu</th><th>Đơn vị</th><th>Bộ lọc</th><th>Thứ tự</th></tr></thead><tbody>
    ${list.map((d) => `<tr class="row" data-id="${d.id}"><td>${d.category_id ? esc(catName(d.category_id)) : "Dùng chung"}</td><td><code>${esc(d.code)}</code></td><td>${esc(d.label_vi)}</td>
      <td>${esc(d.label_en || "—")}</td><td>${esc(d.value_type)}</td><td>${esc(d.unit || "")}</td><td>${d.filterable ? "✓" : ""}</td><td>${d.sort}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">Chưa có.</td></tr>'}
    </tbody></table></div>`;
  $("#af").addEventListener("change", (e) => { attrFilter = e.target.value; route(); });
  $("#a-new")?.addEventListener("click", () => attrModal(null));
  $$("tr.row").forEach((r) => r.addEventListener("click", () => attrModal(Number(r.dataset.id))));
}
function attrModal(id) {
  const d = id ? S.defs.find((x) => x.id === id) : { value_type: "text", sort: 0, filterable: false }, canW = can("products.publish");
  const m = openModal(`<form id="aform"><h2>${id ? "Sửa" : "Thêm"} thuộc tính</h2><div class="form-grid">
    ${sel("category_id", "Danh mục", [["", "Dùng chung (mọi danh mục)"], ...S.cats.map((c) => [c.id, catName(c.id)])], d.category_id)}
    ${inp("code", "Mã (a-z, 0-9, _) *", d.code || "", 'required pattern="[a-z][a-z0-9_]*"' + (id ? " readonly" : ""))}
    ${inp("label_vi", "Nhãn tiếng Việt *", d.label_vi || "", "required")}${inp("label_en", "Nhãn tiếng Anh", d.label_en || "")}
    ${sel("value_type", "Kiểu dữ liệu", [["text", "Văn bản"], ["number", "Số"], ["boolean", "Có/Không"]], d.value_type)}
    ${inp("unit", "Đơn vị", d.unit || "")}${inp("sort", "Thứ tự", d.sort, 'type="number"')}<div>${chk("filterable", "Dùng làm bộ lọc trên website", d.filterable)}</div></div>
    <p class="hint">Đổi mã sau khi đã nhập dữ liệu sẽ làm mất liên kết với giá trị đã lưu nên mã bị khoá khi sửa.</p>
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="a-cancel">Đóng</button>
    ${id && canW ? '<button class="btn danger" type="button" id="a-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#aform", m); if (!canW) $$("input,select", f).forEach((x) => (x.disabled = true));
  $("#a-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const row = { category_id: numOrNull(g(f, "category_id").value), code: g(f, "code").value.trim(), label_vi: g(f, "label_vi").value.trim(), label_en: g(f, "label_en").value.trim() || null,
      value_type: g(f, "value_type").value, unit: g(f, "unit").value.trim() || null, sort: Number(g(f, "sort").value || 0), filterable: g(f, "filterable").checked };
    const r = id ? await sb.from("attribute_defs").update(row).eq("id", id) : await sb.from("attribute_defs").insert(row);
    if (r.error) throw r.error; closeModal(); toast("Đã lưu."); route();
  }); });
  $("#a-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá thuộc tính? Giá trị đã nhập trong sản phẩm vẫn còn nhưng sẽ không hiển thị.")) return;
    const { error } = await sb.from("attribute_defs").delete().eq("id", id); if (error) throw error; closeModal(); toast("Đã xoá."); route();
  }));
}

boot().catch((e) => { $("#boot").textContent = "Lỗi khởi động: " + e.message; console.error(e); });
})();
