/* Quản lý menu (đầu trang / chân trang, 2 cấp) và khối trang chủ. Quyền thật: RLS (content.publish) + ràng buộc/trigger trong DB (007). */
(() => {
"use strict";
const C = window.CMS, { $, $$, esc, toast, busy, errMsg, openModal, closeModal, inp, txa, sel, chk, g, numOrNull, S, can, resizeImage, pubUrl } = C;
const db = () => C.db();
const LANGS = (window.APP_CONFIG && window.APP_CONFIG.LANGS) || ["vi", "en"];
const LANG_NAME = { vi: "Tiếng Việt", en: "English" };
const URL_OK = /^(\/([^/]|$)|#|https?:\/\/|mailto:|tel:)/i;

// Đổi thứ tự trong cùng cấp: hoán đổi rồi đánh lại sort = 0,10,20…
async function reorder(table, siblings, id, dir) {
  const i = siblings.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  for (let k = 0; k < siblings.length; k++) {
    const want = k * 10;
    if (siblings[k].sort !== want) { const r = await db().from(table).update({ sort: want }).eq("id", siblings[k].id); if (r.error) throw r.error; }
  }
}
async function uploadImg(file, prefix, max) {
  const blob = await resizeImage(file, max || 1600), path = `${prefix}/${crypto.randomUUID()}.webp`;
  const up = await db().storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }); if (up.error) throw up.error;
  return path;
}
const rmImg = (path) => (path ? db().storage.from("media").remove([path]).catch(() => {}) : null);

// ================= MENU =================
const NAMES = { vi: { home: "Trang chủ", products: "Sản phẩm", quote: "Báo giá SLL", contact: "Liên hệ", news: "Tin tức", services: "Dịch vụ", policies: "Chính sách", faq: "Hỏi đáp", partners: "Đối tác", certs: "Chứng nhận", projects: "Dự án", careers: "Tuyển dụng" }, en: { home: "Home", products: "Products", quote: "Bulk quote", contact: "Contact", news: "News", services: "Services", policies: "Policies" } };
const SEG = { vi: { products: "san-pham", quote: "bao-gia-so-luong-lon", contact: "lien-he", news: "tin-tuc", services: "dich-vu", policies: "chinh-sach", faq: "hoi-dap", partners: "doi-tac", certs: "chung-nhan", projects: "du-an", careers: "tuyen-dung", cat: "danh-muc" }, en: { faq: "faq", partners: "partners", certs: "certifications", projects: "projects", careers: "careers", products: "products", quote: "request-quote", contact: "contact", news: "news", services: "services", policies: "policies", cat: "category" } };
const KINDSEG = (l, kind, slug) => (kind === "page" ? `/${l}/${slug}/` : `/${l}/${SEG[l][{ post: "news", service: "services", policy: "policies", project: "projects", career: "careers" }[kind]]}/${slug}/`);
let QL = null;
async function quickLinks() {   // gợi ý liên kết: trang hệ thống, danh mục, nội dung đã có
  if (QL) return QL;
  const out = { vi: [], en: [] };
  for (const l of LANGS) {
    out[l].push([NAMES[l].home, `/${l}/`], ...["products", "quote", "contact", "news", "services", "policies", "faq", "partners", "certs", "projects", "careers"].map((k) => [NAMES[l][k], `/${l}/${SEG[l][k]}/`]));
    for (const c of S.cats) { const t = (c.category_translations || []).find((x) => x.lang === l && x.status === "published"); if (t) out[l].push([`Danh mục: ${t.name}`, `/${l}/${SEG[l].products}/${SEG[l].cat}/${t.slug}/`]); }
  }
  const r = await db().from("content_translations").select("lang,slug,title,content_items!inner(kind)").eq("status", "published").limit(500);
  if (!r.error) for (const x of r.data) if (out[x.lang] && ["page", "post", "service", "policy", "project", "career"].includes(x.content_items.kind)) out[x.lang].push([`${{ page: "Trang", post: "Tin", service: "Dịch vụ", policy: "Chính sách", project: "Dự án", career: "Tuyển dụng" }[x.content_items.kind]}: ${x.title}`, KINDSEG(x.lang, x.content_items.kind, x.slug)]);
  return (QL = out);
}

let MLOC = "main";
async function viewMenus() {
  const { data, error } = await db().from("menus").select("*").order("sort").order("id"); if (error) throw error;
  const canW = can("content.publish"), rows = data.filter((m) => m.location === MLOC), tops = rows.filter((m) => !m.parent_id);
  const line = (m, sibs, child) => `<tr data-id="${m.id}"><td class="wrap">${child ? "&nbsp;&nbsp;&nbsp;↳ " : ""}<strong>${esc(m.label_vi)}</strong><br><small class="muted">${child ? "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" : ""}${esc(m.url_vi)}</small></td>
    <td class="wrap">${m.label_en ? `<strong>${esc(m.label_en)}</strong><br><small class="muted">${esc(m.url_en || "")}</small>` : '<span class="badge bad">EN: thiếu</span>'}</td><td>${m.active ? '<span class="badge ok">Hiện</span>' : '<span class="badge">Ẩn</span>'}</td>
    <td>${canW ? `<button class="btn" data-mv="-1" data-sib="${sibs}" ${sibs.split(",")[0] === String(m.id) ? "disabled" : ""} aria-label="Lên">↑</button> <button class="btn" data-mv="1" data-sib="${sibs}" ${sibs.split(",").slice(-1)[0] === String(m.id) ? "disabled" : ""} aria-label="Xuống">↓</button> <button class="btn" data-edit="${m.id}">Sửa</button>` : ""}</td></tr>`;
  const body = tops.map((t) => { const kids = rows.filter((c) => c.parent_id === t.id); return line(t, tops.map((x) => x.id).join(","), false) + kids.map((c) => line(c, kids.map((x) => x.id).join(","), true)).join(""); }).join("");
  $("#view").innerHTML = `<h1>Menu</h1><div class="tabs"><button class="${MLOC === "main" ? "on" : ""}" data-loc="main">Đầu trang</button><button class="${MLOC === "footer" ? "on" : ""}" data-loc="footer">Chân trang</button></div>
  <p class="hint">${rows.length ? "Menu này đang được dùng thay cho menu tự động của website." : "Chưa có mục nào → website dùng menu tự động (Sản phẩm, Dịch vụ, Tin tức, Báo giá, Liên hệ; chân trang liệt kê trang & chính sách). Thêm mục để tự quản lý."} Tối đa 2 cấp. Mục thiếu nhãn/liên kết ở một ngôn ngữ sẽ không hiện ở ngôn ngữ đó.</p>
  <div class="toolbar">${canW ? '<button class="btn primary fix" id="m-new">+ Thêm mục</button>' : '<span class="muted">Chỉ xem</span>'}</div>
  <div class="table-wrap"><table><thead><tr><th>Tiếng Việt</th><th>English</th><th>Hiển thị</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="4" class="muted">Chưa có mục menu.</td></tr>'}</tbody></table></div>`;
  const v = $("#view");
  $$("[data-loc]", v).forEach((b) => b.addEventListener("click", () => { MLOC = b.dataset.loc; C.reload(); }));
  $("#m-new", v)?.addEventListener("click", () => menuModal(null, data));
  $$("[data-edit]", v).forEach((b) => b.addEventListener("click", () => menuModal(data.find((x) => x.id === Number(b.dataset.edit)), data)));
  $$("[data-mv]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const ids = b.dataset.sib.split(",").map(Number), sibs = ids.map((i) => data.find((x) => x.id === i));
    await reorder("menus", sibs, Number(b.closest("tr").dataset.id), Number(b.dataset.mv)); C.reload();
  })));
}
async function menuModal(row, all) {
  const canW = can("content.publish"), r = row || { location: MLOC, active: true, sort: 0 }, QLk = await quickLinks();
  const hasKids = row && all.some((x) => x.parent_id === row.id);
  const parents = [["", "— Không (mục cấp 1) —"], ...all.filter((x) => !x.parent_id && x.id !== r.id && x.location === r.location).map((x) => [x.id, x.label_vi])];
  const quick = (l) => `<label>Chọn nhanh liên kết (${l.toUpperCase()})<select data-quick="${l}"><option value="">— Chọn trang có sẵn —</option>${QLk[l].map(([t, u], i) => `<option value="${esc(u)}">${esc(t)}</option>`).join("")}</select></label>`;
  const m = openModal(`<form id="mform"><h2>${row ? "Sửa" : "Thêm"} mục menu</h2><div class="form-grid">
    ${sel("location", "Vị trí", [["main", "Đầu trang"], ["footer", "Chân trang"]], r.location, row ? "disabled" : "")}${sel("parent_id", "Mục cha (cấp 2)", parents, r.parent_id, hasKids ? "disabled" : "")}
    ${inp("label_vi", "Nhãn tiếng Việt *", r.label_vi || "", "maxlength=100")}${inp("url_vi", "Liên kết tiếng Việt *", r.url_vi || "", "maxlength=500")}${quick("vi")}<span></span>
    ${inp("label_en", "Nhãn tiếng Anh (trống = ẩn ở bản EN)", r.label_en || "", "maxlength=100")}${inp("url_en", "Liên kết tiếng Anh", r.url_en || "", "maxlength=500")}${quick("en")}<span></span>
    ${inp("sort", "Thứ tự", r.sort, 'type="number"')}<div>${chk("active", "Hiển thị", r.active)}</div></div>
    <p class="hint">Liên kết nhận: /đường-dẫn-nội-bộ, #neo, https://…, mailto:…, tel:… ${hasKids ? "Mục này đang có mục con nên không thể chuyển thành mục con." : ""}</p>
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="m-cancel">Đóng</button>${row && canW ? '<button class="btn danger" type="button" id="m-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#mform", m); if (!canW) $$("input,select", f).forEach((x) => (x.disabled = true));
  $$("[data-quick]", f).forEach((s) => s.addEventListener("change", () => { if (s.value) g(f, "url_" + s.dataset.quick).value = s.value; }));
  $("#m-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const body = { label_vi: g(f, "label_vi").value.trim(), url_vi: g(f, "url_vi").value.trim(), label_en: g(f, "label_en").value.trim() || null, url_en: g(f, "url_en").value.trim() || null,
      parent_id: numOrNull(g(f, "parent_id").value), sort: Number(g(f, "sort").value || 0), active: g(f, "active").checked };
    if (!row) body.location = g(f, "location").value;
    if (!body.label_vi || !body.url_vi) throw new Error("Cần nhập nhãn và liên kết tiếng Việt.");
    if (!URL_OK.test(body.url_vi) || (body.url_en && !URL_OK.test(body.url_en))) throw new Error("Liên kết không hợp lệ: chỉ nhận /đường-dẫn, #neo, https://, mailto: hoặc tel:.");
    if ((body.label_en && !body.url_en) || (!body.label_en && body.url_en)) throw new Error("Bản tiếng Anh cần có đủ cả nhãn và liên kết (hoặc bỏ trống cả hai).");
    if (!row) { const sibs = all.filter((x) => x.location === body.location && x.parent_id === body.parent_id); body.sort = body.sort || (sibs.length ? Math.max(...sibs.map((x) => x.sort)) + 10 : 0); }
    const res = row ? await db().from("menus").update(body).eq("id", row.id) : await db().from("menus").insert(body);
    if (res.error) throw res.error; closeModal(); toast("Đã lưu. Website cập nhật trong tối đa 1 phút."); C.reload();
  }); });
  $("#m-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm(hasKids ? "Xoá mục này và TẤT CẢ mục con của nó?" : "Xoá mục này?")) return;
    const d = await db().from("menus").delete().eq("id", row.id).select("id"); if (d.error) throw d.error; if (!d.data.length) throw new Error("Không xoá được (không có quyền)."); closeModal(); toast("Đã xoá."); C.reload();
  }));
}

// ================= KHỐI TRANG CHỦ =================
const TITLE = ["title", "Tiêu đề khối *", "input"];
const BLOCKS = {
  hero: { label: "Banner chính (Hero)", need: "title", txt: [["title", "Tiêu đề lớn *", "input"], ["subtitle", "Mô tả ngắn", "ta3"], ["cta1_label", "Nút 1 — chữ", "input"], ["cta1_url", "Nút 1 — liên kết", "url"], ["cta2_label", "Nút 2 — chữ", "input"], ["cta2_url", "Nút 2 — liên kết", "url"]], cfg: [["image_path", "Ảnh minh hoạ (tuỳ chọn)", "image"]] },
  categories: { label: "Danh mục sản phẩm", need: "title", txt: [TITLE], cfg: [] },
  products: { label: "Danh sách sản phẩm", need: "title", txt: [TITLE], cfg: [["source", "Nguồn sản phẩm", "source"], ["limit", "Số sản phẩm (1–24)", "number"]] },
  brands: { label: "Thương hiệu phân phối", need: "title", txt: [TITLE], cfg: [] },
  news: { label: "Tin tức mới", need: "title", txt: [TITLE], cfg: [["limit", "Số bài (1–12)", "number"]] },
  cta: { label: "Kêu gọi hành động (CTA)", need: "title", txt: [TITLE, ["text", "Nội dung ngắn", "ta3"], ["button_label", "Nút — chữ", "input"], ["button_url", "Nút — liên kết", "url"]], cfg: [] },
  text: { label: "Nội dung tự do", need: "title|body", txt: [["title", "Tiêu đề (tuỳ chọn)", "input"], ["body", "Nội dung", "rte"]], cfg: [] },
  banner: { label: "Ảnh quảng cáo / banner", need: "alt", txt: [["alt", "Mô tả ảnh (alt) *", "input"], ["url", "Liên kết khi bấm (tuỳ chọn)", "url"]], cfg: [["image_path", "Ảnh banner *", "image"]] }
};
const SRC = [["featured", "Sản phẩm nổi bật"], ["new", "Sản phẩm mới"], ["latest", "Mới nhất"]];
const previewOf = (b, l) => { const t = b.payload && b.payload[l]; return t ? (t.title || t.alt || (t.body ? "(nội dung tự do)" : "")) : ""; };

async function viewBlocks() {
  const { data, error } = await db().from("home_blocks").select("*").order("sort").order("id"); if (error) throw error;
  const canW = can("content.publish"), ids = data.map((x) => x.id).join(",");
  const rows = data.map((b, i) => `<tr data-id="${b.id}"><td>${i + 1}</td><td><strong>${esc((BLOCKS[b.block_type] || {}).label || b.block_type)}</strong></td>
    <td class="wrap">${esc(previewOf(b, "vi")) || '<span class="badge bad">VI: trống</span>'}</td><td class="wrap">${esc(previewOf(b, "en")) || '<span class="badge bad">EN: trống</span>'}</td>
    <td>${canW ? `<label class="chk"><input type="checkbox" data-en="${b.id}" ${b.enabled ? "checked" : ""}> Bật</label>` : b.enabled ? "Bật" : "Tắt"}</td>
    <td>${canW ? `<button class="btn" data-mv="-1" ${i === 0 ? "disabled" : ""}>↑</button> <button class="btn" data-mv="1" ${i === data.length - 1 ? "disabled" : ""}>↓</button> <button class="btn" data-edit="${b.id}">Sửa</button>` : ""}</td></tr>`).join("");
  $("#view").innerHTML = `<h1>Khối trang chủ</h1>
  <p class="hint">${data.some((b) => b.enabled) ? "Trang chủ đang hiển thị theo các khối bên dưới (đúng thứ tự). Khối chỉ hiện ở ngôn ngữ có nội dung; ngôn ngữ chưa có khối nào dùng bố cục mặc định." : "Chưa có khối nào được bật → website dùng bố cục mặc định (Banner, Danh mục, Nổi bật, Mới, Tin tức, Thương hiệu, Báo giá)."}
  Xem: <a target="_blank" rel="noopener" href="/vi/">/vi/ ↗</a> · <a target="_blank" rel="noopener" href="/en/">/en/ ↗</a></p>
  <div class="toolbar">${canW ? `${sel("newtype", "Loại khối mới", Object.entries(BLOCKS).map(([k, v]) => [k, v.label]), "hero", 'id="b-type"')}<button class="btn primary fix" id="b-new">+ Thêm khối</button>` : '<span class="muted">Chỉ xem</span>'}</div>
  <div class="table-wrap"><table><thead><tr><th>#</th><th>Loại</th><th>Nội dung VI</th><th>Nội dung EN</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Chưa có khối.</td></tr>'}</tbody></table></div>`;
  const v = $("#view");
  $("#b-new", v)?.addEventListener("click", () => blockModal(null, data, $("#b-type", v).value));
  $$("[data-edit]", v).forEach((b) => b.addEventListener("click", () => { const r = data.find((x) => x.id === Number(b.dataset.edit)); blockModal(r, data, r.block_type); }));
  $$("[data-en]", v).forEach((c) => c.addEventListener("change", async () => { const r = await db().from("home_blocks").update({ enabled: c.checked }).eq("id", Number(c.dataset.en)).select("id"); if (r.error || !r.data.length) { toast(r.error ? errMsg(r.error) : "Không có quyền.", true); C.reload(); } else toast(c.checked ? "Đã bật khối." : "Đã tắt khối."); }));
  $$("[data-mv]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => { await reorder("home_blocks", data.slice(), Number(b.closest("tr").dataset.id), Number(b.dataset.mv)); C.reload(); })));
}

function fieldHtml(prefix, [k, label, type], val) {
  const n = `${prefix}${k}`;
  if (type === "input") return inp(n, label, val || "", "maxlength=300");
  if (type === "url") return inp(n, label, val || "", 'maxlength=500 placeholder="/vi/san-pham/ hoặc https://…"');
  if (type.startsWith("ta")) return txa(n, label, val || "", Number(type.slice(2)));
  return "";
}
async function blockModal(row, all, type) {
  const spec = BLOCKS[type], canW = can("content.publish"), P = (row && row.payload) || {}, cfg = P.cfg || {};
  const langFs = LANGS.map((l) => `<fieldset class="tr" data-lang="${l}"><legend>${esc(LANG_NAME[l] || l)}</legend><div class="form-grid">${spec.txt.map((f) => f[2] === "rte" ? `<div class="full"><span class="lbl">${esc(f[1])}</span>${C.rte.rteMarkup(`${l}__${f[0]}`, (P[l] || {})[f[0]])}</div>` : fieldHtml(`${l}__`, f, (P[l] || {})[f[0]])).join("")}</div></fieldset>`).join("");
  const cfgHtml = spec.cfg.map(([k, label, t]) => t === "image" ? `<div class="full"><label>${esc(label)}<input type="file" name="cfg_${k}" accept="image/jpeg,image/png,image/webp"></label>${cfg[k] ? `<div><img src="${esc(pubUrl(cfg[k]))}" alt="" height="70"> ${chk("rm_" + k, "Gỡ ảnh", false)}</div>` : ""}</div>`
    : t === "source" ? sel(`cfg_${k}`, label, SRC, cfg[k] || "featured") : inp(`cfg_${k}`, label, cfg[k] ?? "", 'type="number" min="1" max="24"')).join("");
  const m = openModal(`<form id="bform" novalidate><h2>${row ? "Sửa" : "Thêm"} khối: ${esc(spec.label)}</h2>${cfgHtml ? `<div class="form-grid">${cfgHtml}</div>` : ""}${langFs}
    <p class="hint">Để trống toàn bộ nội dung của một ngôn ngữ = khối không hiện ở ngôn ngữ đó. ${spec.need === "title" ? "Cần có tiêu đề." : spec.need === "alt" ? "Cần có mô tả ảnh." : ""}</p>
    <div class="form-grid">${inp("sort", "Thứ tự (nhỏ hiện trước)", row ? row.sort : (all.length ? Math.max(...all.map((x) => x.sort)) + 10 : 0), 'type="number"')}<div>${chk("enabled", "Bật khối này", row ? row.enabled : true)}</div></div>
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="b-cancel">Đóng</button>${row && canW ? '<button class="btn danger" type="button" id="b-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#bform", m); C.rte.wireRte(f);
  if (!canW) { $$("input,select,textarea", f).forEach((x) => (x.disabled = true)); $$(".rte-body", f).forEach((x) => (x.contentEditable = "false")); }
  $("#b-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const payload = {}, newCfg = { ...cfg }; let anyLang = false;
    for (const l of LANGS) {
      const o = {}; let any = false;
      for (const [k, , t] of spec.txt) {
        const val = t === "rte" ? C.rte.readRte($(`[data-rte="${l}__${k}"]`, f)) : (g(f, `${l}__${k}`)?.value || "").trim();
        if (val) { o[k] = val; any = true; }
        if (t === "url" && val && !URL_OK.test(val)) throw new Error(`${l.toUpperCase()}: liên kết “${val.slice(0, 40)}” không hợp lệ (chỉ nhận /đường-dẫn, #neo, https://, mailto:, tel:).`);
      }
      if (any) {
        const needs = spec.need.split("|"); if (!needs.some((n) => o[n])) throw new Error(`${l.toUpperCase()}: thiếu ${spec.need === "alt" ? "mô tả ảnh" : "tiêu đề"}.`);
        payload[l] = o; anyLang = true;
      }
    }
    if (!anyLang) throw new Error("Cần nhập nội dung cho ít nhất một ngôn ngữ.");
    let oldImg = null, newImg = null;
    for (const [k, , t] of spec.cfg) {
      if (t === "image") {
        const file = g(f, `cfg_${k}`).files[0];
        if (file) { newImg = await uploadImg(file, "site", 1600); oldImg = cfg[k] || null; newCfg[k] = newImg; }
        else if (g(f, "rm_" + k)?.checked) { oldImg = cfg[k]; delete newCfg[k]; }
      } else if (t === "source") newCfg[k] = g(f, `cfg_${k}`).value;
      else { const n = numOrNull(g(f, `cfg_${k}`).value); if (n != null) newCfg[k] = Math.min(24, Math.max(1, Math.round(n))); else delete newCfg[k]; }
    }
    if (type === "banner" && !newCfg.image_path) throw new Error("Khối banner cần có ảnh.");
    if (Object.keys(newCfg).length) payload.cfg = newCfg;
    const body = { block_type: type, sort: Number(g(f, "sort").value || 0), enabled: g(f, "enabled").checked, payload };
    try { const res = row ? await db().from("home_blocks").update(body).eq("id", row.id) : await db().from("home_blocks").insert(body); if (res.error) throw res.error; }
    catch (e) { await rmImg(newImg); throw e; }
    await rmImg(oldImg); closeModal(); toast("Đã lưu. Trang chủ cập nhật trong tối đa 1 phút."); C.reload();
  }); });
  $("#b-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá khối này?")) return;
    const d = await db().from("home_blocks").delete().eq("id", row.id).select("id"); if (d.error) throw d.error; if (!d.data.length) throw new Error("Không xoá được (không có quyền).");
    await rmImg(cfg.image_path); closeModal(); toast("Đã xoá."); C.reload();
  }));
}

C.register({ key: "menus", title: "Menu", group: "content", view: viewMenus });
C.register({ key: "homeblocks", title: "Khối trang chủ", group: "content", view: viewBlocks });
})();
