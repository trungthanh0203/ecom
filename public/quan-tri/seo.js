/* SEO & theo dõi: chuyển hướng 301, thiết lập SEO, kiểm tra SEO, GA4/GTM. Quyền thật: RLS (seo.write / settings.write) + trigger kiểm định dạng ở DB (008). */
(() => {
"use strict";
const C = window.CMS, { $, $$, esc, toast, busy, errMsg, openModal, closeModal, inp, txa, sel, chk, g, S, can, resizeImage, pubUrl } = C;
const db = () => C.db();
const PG = 50;
const SEGS = { vi: { products: "san-pham", news: "tin-tuc", services: "dich-vu", policies: "chinh-sach", projects: "du-an", careers: "tuyen-dung" }, en: { products: "products", news: "news", services: "services", policies: "policies", projects: "projects", careers: "careers" } };
const urlFor = (kind, lang, slug) => (kind === "product" ? `/${lang}/${SEGS[lang].products}/${slug}/` : kind === "page" ? `/${lang}/${slug}/` : `/${lang}/${SEGS[lang][{ post: "news", service: "services", policy: "policies", project: "projects", career: "careers" }[kind]]}/${slug}/`);

// ---------- tự tạo chuyển hướng 301 khi đổi slug (được gọi từ cms.js / content.js sau khi lưu bản dịch) ----------
async function mkRedirect(from, to) {
  let r = await db().from("redirects").delete().eq("from_path", to); if (r.error) throw r.error;                // đổi lại slug cũ: bỏ chuyển hướng ngược để không thành vòng lặp
  r = await db().from("redirects").update({ to_path: to }).eq("to_path", from); if (r.error) throw r.error;     // rút gọn chuỗi: các chuyển hướng cũ trỏ thẳng tới đích mới
  r = await db().from("redirects").upsert({ from_path: from, to_path: to, status_code: 301, active: true }, { onConflict: "from_path" }); if (r.error) throw r.error;
}
C.afterSlugChange = async (kind, oldTR, newTrs, wasLive) => {
  const ch = newTrs.filter((t) => wasLive && oldTR[t.lang] && oldTR[t.lang].slug !== t.slug && oldTR[t.lang].status === "published" && t.status === "published");
  if (!ch.length) return;
  if (!can("seo.write")) { toast("Đã đổi slug, nhưng bạn không có quyền tạo chuyển hướng 301. Hãy nhờ Editor/Admin thêm: " + ch.map((t) => urlFor(kind, t.lang, oldTR[t.lang].slug) + " → " + urlFor(kind, t.lang, t.slug)).join("; "), true); return; }
  let n = 0;
  for (const t of ch) { try { await mkRedirect(urlFor(kind, t.lang, oldTR[t.lang].slug), urlFor(kind, t.lang, t.slug)); n++; } catch (e) { toast("Không tạo được chuyển hướng: " + errMsg(e), true); } }
  if (n) toast(`Đã tự tạo ${n} chuyển hướng 301 từ slug cũ sang slug mới.`);
};

// ================= CHUYỂN HƯỚNG =================
const RF = { q: "", active: "", page: 0 };
const TO_OK = /^(\/([^/]|$)|https:\/\/)/i;
function checkRedirect(from, to) {
  if (!from.startsWith("/")) return "Đường dẫn cũ phải bắt đầu bằng “/”.";
  if (/[?#\s]/.test(from)) return "Đường dẫn cũ không được chứa dấu ?, #, hoặc khoảng trắng (chỉ ghi phần đường dẫn).";
  if (from.length > 300) return "Đường dẫn cũ quá dài.";
  if (!TO_OK.test(to) || /\s/.test(to) || to.length > 500) return "Đích phải là /đường-dẫn-nội-bộ hoặc https://… (không khoảng trắng).";
  if (from === to) return "Đường dẫn cũ và đích không được giống nhau.";
  return "";
}
async function viewRedirects() {
  let q = db().from("redirects").select("*", { count: "exact" }).order("id", { ascending: false }).range(RF.page * PG, RF.page * PG + PG - 1);
  if (RF.active) q = q.eq("active", RF.active === "1");
  const s = RF.q.replace(/[,()%*\\"]/g, " ").trim(); if (s) q = q.or(`from_path.ilike.%${s}%,to_path.ilike.%${s}%`);
  const { data, count, error } = await q; if (error) throw error;
  const canW = can("seo.write"), pages = Math.max(1, Math.ceil((count || 0) / PG));
  $("#view").innerHTML = `<h1>Chuyển hướng 301 <span class="muted">(${count ?? 0})</span></h1>
  <p class="hint">Dùng khi một trang đã đổi địa chỉ hoặc bị xoá. Chuyển hướng chỉ có tác dụng với địa chỉ <strong>không còn trang nào</strong> (không thể chuyển hướng một trang đang tồn tại) và chỉ đi theo 1 bước. Đổi slug sản phẩm/nội dung đã xuất bản sẽ tự tạo chuyển hướng.</p>
  <div class="toolbar"><label>Tìm<input id="rd-q" value="${esc(RF.q)}" placeholder="Nhập rồi Enter"></label>${sel("a", "Trạng thái", [["", "Tất cả"], ["1", "Đang bật"], ["0", "Đã tắt"]], RF.active, 'id="rd-a"')}
   ${canW ? '<button class="btn primary fix" id="rd-new">+ Thêm</button><button class="btn fix" id="rd-bulk">Nhập hàng loạt</button>' : ""}${can("export.data") ? '<button class="btn fix" id="rd-csv">Xuất CSV</button>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Đường dẫn cũ</th><th>Chuyển tới</th><th>Mã</th><th>Bật</th></tr></thead><tbody>
  ${data.map((r) => `<tr class="row" data-id="${r.id}"><td class="wrap"><code>${esc(r.from_path)}</code></td><td class="wrap"><code>${esc(r.to_path)}</code></td><td>${r.status_code}</td><td>${r.active ? "✓" : "—"}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Chưa có chuyển hướng.</td></tr>'}</tbody></table></div>
  <div class="pager"><button class="btn" id="rd-prev" ${RF.page <= 0 ? "disabled" : ""}>‹ Trước</button><span>Trang ${RF.page + 1}/${pages}</span><button class="btn" id="rd-next" ${RF.page + 1 >= pages ? "disabled" : ""}>Sau ›</button></div>`;
  const v = $("#view");
  $("#rd-q", v).addEventListener("keydown", (e) => { if (e.key === "Enter") { RF.q = e.target.value.trim(); RF.page = 0; C.reload(); } });
  $("#rd-a", v).addEventListener("change", (e) => { RF.active = e.target.value; RF.page = 0; C.reload(); });
  $("#rd-prev", v).addEventListener("click", () => { RF.page--; C.reload(); }); $("#rd-next", v).addEventListener("click", () => { RF.page++; C.reload(); });
  $("#rd-new", v)?.addEventListener("click", () => rdModal(null)); $("#rd-bulk", v)?.addEventListener("click", bulkModal);
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => rdModal(data.find((x) => x.id === Number(r.dataset.id)))));
  $("#rd-csv", v)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const all = []; for (let off = 0; off < 20000; off += 1000) { const r = await db().from("redirects").select("from_path,to_path,status_code,active").order("id").range(off, off + 999); if (r.error) throw r.error; all.push(...r.data); if (r.data.length < 1000) break; }
    const cell = (x) => { let t = String(x ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const text = String.fromCharCode(65279) + [["from_path", "to_path", "status_code", "active"], ...all.map((r) => [r.from_path, r.to_path, r.status_code, r.active])].map((r) => r.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = "chuyen-huong.csv"; document.body.appendChild(a); a.click(); a.remove(); toast(`Đã xuất ${all.length} dòng.`);
  }));
}
function rdModal(row) {
  const canW = can("seo.write"), r = row || { status_code: 301, active: true };
  const m = openModal(`<form id="rdform"><h2>${row ? "Sửa" : "Thêm"} chuyển hướng</h2><div class="form-grid">
    ${inp("from_path", "Đường dẫn cũ * (vd: /vi/san-pham/xe-cu/)", r.from_path || "", "maxlength=300")}${inp("to_path", "Chuyển tới * (/đường-dẫn hoặc https://…)", r.to_path || "", "maxlength=500")}
    ${sel("status_code", "Loại", [["301", "301 — vĩnh viễn (khuyến nghị)"], ["302", "302 — tạm thời"]], String(r.status_code))}<div>${chk("active", "Đang bật", r.active)}</div></div>
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="rd-cancel">Đóng</button>${row && canW ? '<button class="btn danger" type="button" id="rd-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#rdform", m); if (!canW) $$("input,select", f).forEach((x) => (x.disabled = true));
  $("#rd-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const body = { from_path: g(f, "from_path").value.trim(), to_path: g(f, "to_path").value.trim(), status_code: Number(g(f, "status_code").value), active: g(f, "active").checked };
    const bad = checkRedirect(body.from_path, body.to_path); if (bad) throw new Error(bad);
    const res = row ? await db().from("redirects").update(body).eq("id", row.id) : await db().from("redirects").insert(body); if (res.error) throw res.error;
    closeModal(); toast("Đã lưu."); C.reload();
  }); });
  $("#rd-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => { if (!confirm("Xoá chuyển hướng này?")) return; const d = await db().from("redirects").delete().eq("id", row.id).select("id"); if (d.error) throw d.error; if (!d.data.length) throw new Error("Không xoá được (không có quyền)."); closeModal(); toast("Đã xoá."); C.reload(); }));
}
function bulkModal() {
  const m = openModal(`<form id="bform"><h2>Nhập chuyển hướng hàng loạt</h2><p class="hint">Mỗi dòng một chuyển hướng: <code>đường-dẫn-cũ , đích [, 301|302]</code> (hoặc dùng “→” hay Tab thay cho dấu phẩy). Tối đa 500 dòng. Dòng trùng đường dẫn cũ sẽ được cập nhật.</p>
    ${txa("lines", "Danh sách", "", 10)}<div id="bulk-report" class="hint"></div><div class="actions"><button class="btn primary" type="submit">Nhập</button><button class="btn" type="button" id="b-cancel">Đóng</button></div></form>`);
  const f = $("#bform", m); $("#b-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const lines = g(f, "lines").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (!lines.length) throw new Error("Chưa nhập dòng nào."); if (lines.length > 500) throw new Error("Tối đa 500 dòng mỗi lần.");
    const ok = [], errs = [];
    lines.forEach((ln, i) => { const p = ln.split(/\s*(?:,|→|->|\t)\s*/); const from = (p[0] || "").trim(), to = (p[1] || "").trim(), code = p[2] ? Number(p[2]) : 301; const bad = checkRedirect(from, to) || (![301, 302].includes(code) ? "Loại phải là 301 hoặc 302." : ""); if (bad) errs.push(`Dòng ${i + 1}: ${bad}`); else ok.push({ from_path: from, to_path: to, status_code: code, active: true }); });
    const rep = $("#bulk-report", f); let done = 0;
    for (const r of ok) { const res = await db().from("redirects").upsert(r, { onConflict: "from_path" }); if (res.error) errs.push(`${r.from_path}: ${errMsg(res.error)}`); else done++; }
    rep.innerHTML = `<strong>Đã nhập ${done}/${lines.length} dòng.</strong>${errs.length ? `<ul>${errs.slice(0, 30).map((e) => `<li class="error">${esc(e)}</li>`).join("")}</ul>` : ""}`;
    if (done) toast(`Đã nhập ${done} chuyển hướng.`);
  }); });
}

// ================= THIẾT LẬP SEO =================
const SEO_GROUPS = [
  ["Tiêu đề & mô tả", [["seo_title_suffix", "Hậu tố tiêu đề (vd: | Tên công ty). Trống = tên công ty", "text", 100], ["seo_home_title_vi", "Tiêu đề trang chủ (VI)", "text", 200], ["seo_home_desc_vi", "Mô tả trang chủ (VI)", "ta", 300], ["seo_home_title_en", "Tiêu đề trang chủ (EN)", "text", 200], ["seo_home_desc_en", "Mô tả trang chủ (EN)", "ta", 300]]],
  ["Xác minh công cụ tìm kiếm", [["seo_verification_google", "Mã xác minh Google Search Console (chỉ phần content=\"…\")", "token", 100], ["seo_verification_bing", "Mã xác minh Bing Webmaster", "token", 100]]],
  ["Mạng xã hội (hiện ở chân trang và dữ liệu có cấu trúc)", [["social_facebook", "Facebook", "url", 300], ["social_zalo", "Zalo (vd https://zalo.me/…)", "url", 300], ["social_youtube", "YouTube", "url", 300], ["social_tiktok", "TikTok", "url", 300], ["social_linkedin", "LinkedIn", "url", 300]]]
];
const IMG_FIELDS = [["seo_og_image", "Ảnh chia sẻ mặc định (Facebook/Zalo/Google) — nên 1200×630", "seo.write", "site/og", 1200], ["brand_logo_path", "Logo (hiện ở đầu trang & dữ liệu có cấu trúc)", "settings.write", "site/logo", 600], ["brand_favicon_path", "Favicon (biểu tượng tab trình duyệt)", "settings.write", "site/favicon", 128]];
const FMT = { token: /^[A-Za-z0-9_-]{10,100}$/, url: /^https:\/\/[^\s<>"']{4,300}$/ };
async function saveSettings(rows, empty) {
  if (rows.length) { const r = await db().from("site_settings").upsert(rows, { onConflict: "key" }); if (r.error) throw r.error; }
  if (empty.length) { const d = await db().from("site_settings").delete().in("key", empty); if (d.error) throw d.error; }
}
const rmImg = (p) => (p ? db().storage.from("media").remove([p]).catch(() => {}) : null);
async function viewSeoSettings() {
  const r = await db().from("site_settings").select("key,value"); if (r.error) throw r.error;
  const cur = Object.fromEntries(r.data.map((x) => [x.key, x.value])), canSeo = can("seo.write"), canSet = can("settings.write");
  const noindex = cur.seo_noindex === true;
  const field = ([k, label, type, max]) => type === "ta" ? `<div class="full">${txa(k, label, cur[k] || "", 3)}<small class="hint" data-cnt="${k}"></small></div>` : `<div>${inp(k, label, cur[k] || "", `maxlength=${max}`)}${["seo_title_suffix", "seo_home_title_vi", "seo_home_title_en"].includes(k) ? `<small class="hint" data-cnt="${k}"></small>` : ""}</div>`;
  $("#view").innerHTML = `<h1>Thiết lập SEO</h1>
  <div class="card" style="margin-bottom:14px;${noindex ? "border-color:var(--danger)" : ""}"><h2 style="margin-top:0">Cho phép công cụ tìm kiếm lập chỉ mục</h2>
    <p class="${noindex ? "error" : "ok"}"><strong>${noindex ? "⛔ Website ĐANG CHẶN Google và các công cụ tìm kiếm (noindex)." : "✅ Website đang cho phép lập chỉ mục."}</strong></p>
    <p class="hint">Nên bật chặn trong lúc đang thử nghiệm (tên miền tạm *.workers.dev) và TẮT chặn khi chính thức ra mắt. Khi bật: thêm thẻ noindex, header X-Robots-Tag và robots.txt “Disallow: /”.</p>
    ${chk("seo_noindex", "Chặn công cụ tìm kiếm (noindex toàn website)", noindex)}</div>
  <form id="seoform" class="card">${SEO_GROUPS.map(([h, fs]) => `<h2>${esc(h)}</h2><div class="form-grid">${fs.map(field).join("")}</div>`).join("")}
  <h2>Hình ảnh & thương hiệu</h2><div class="form-grid">${IMG_FIELDS.filter(([, , perm]) => can(perm) || perm === "seo.write").map(([k, label, perm]) => `<div class="full"><label>${esc(label)}${can(perm) ? `<input type="file" name="file_${k}" accept="image/jpeg,image/png,image/webp">` : ""}</label>${cur[k] ? `<div><img src="${esc(pubUrl(cur[k]))}" alt="" height="60"> ${can(perm) ? chk("rm_" + k, "Gỡ ảnh", false) : ""}</div>` : '<small class="hint">Chưa có.</small>'}${can(perm) ? "" : '<small class="hint">Chỉ Admin được đổi.</small>'}</div>`).join("")}</div>
  <p class="hint">Xem: <a target="_blank" rel="noopener" href="/sitemap.xml">sitemap.xml ↗</a> · <a target="_blank" rel="noopener" href="/robots.txt">robots.txt ↗</a>. Sau khi ra mắt, gửi sitemap trong Google Search Console.</p>
  <div class="actions">${canSeo ? '<button class="btn primary" type="submit">Lưu thiết lập SEO</button>' : '<span class="muted">Chỉ xem (cần quyền SEO)</span>'}</div></form>`;
  const v = $("#view"), form = $("#seoform", v); if (!canSeo) { $$("input,select,textarea", v).forEach((x) => (x.disabled = true)); }
  const upd = (k) => { const el = g(form, k), c = $(`[data-cnt="${k}"]`, form); if (el && c) c.textContent = `${el.value.length} ký tự${k.includes("title") ? " (nên ≤ 60)" : k.includes("desc") ? " (nên 70–160)" : ""}`; };
  $$("[data-cnt]", form).forEach((c) => { const k = c.dataset.cnt; g(form, k).addEventListener("input", () => upd(k)); upd(k); });
  g(v, "seo_noindex").addEventListener("change", async (e) => {
    if (e.target.checked && !confirm("Chặn toàn bộ công cụ tìm kiếm? Website sẽ không xuất hiện trên Google.")) { e.target.checked = false; return; }
    if (!e.target.checked && !confirm("Cho phép Google lập chỉ mục website? Chỉ bật khi đã sẵn sàng ra mắt chính thức.")) { e.target.checked = true; return; }
    try { await saveSettings([{ key: "seo_noindex", value: e.target.checked, is_public: true }], []); toast("Đã cập nhật. Có hiệu lực trong tối đa 1 phút."); C.reload(); } catch (er) { toast(errMsg(er), true); e.target.checked = !e.target.checked; }
  });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", form), async () => {
    const rows = [], empty = [];
    for (const [, fs] of SEO_GROUPS) for (const [k, label, type] of fs) {
      const val = g(form, k).value.trim();
      if (!val) { empty.push(k); continue; }
      if (FMT[type] && !FMT[type].test(val)) throw new Error(`“${label.split(" (")[0]}” không hợp lệ${type === "url" ? " (phải bắt đầu bằng https://)" : " (10–100 ký tự a-z, 0-9, _ , -)"}.`);
      rows.push({ key: k, value: val, is_public: true });
    }
    const olds = [];
    for (const [k, , perm, prefix, max] of IMG_FIELDS) {
      if (!can(perm)) continue; const f = g(form, "file_" + k)?.files[0];
      if (f) { const blob = await resizeImage(f, max), path = `${prefix}-${crypto.randomUUID()}.webp`; const up = await db().storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }); if (up.error) throw up.error; rows.push({ key: k, value: path, is_public: true }); if (cur[k]) olds.push(cur[k]); }
      else if (g(form, "rm_" + k)?.checked) { empty.push(k); if (cur[k]) olds.push(cur[k]); }
    }
    await saveSettings(rows, empty); for (const o of olds) await rmImg(o);
    toast("Đã lưu. Website cập nhật trong tối đa 1 phút."); C.reload();
  }); });
}

// ================= KIỂM TRA SEO =================
async function fetchAll(make, max = 3000) { const out = []; for (let off = 0; off < max; off += 1000) { const { data, error } = await make().range(off, off + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; }
const KEYS = { page: "pages", post: "posts", service: "services", policy: "policies" }, KLAB = { product: "Sản phẩm", page: "Trang", post: "Tin", service: "Dịch vụ", policy: "Chính sách" };
async function viewAudit() {
  const [pt, ct, im, pubProd] = await Promise.all([
    fetchAll(() => db().from("product_translations").select("product_id,lang,slug,name,short_desc,seo_title,seo_description,products!inner(status)").eq("status", "published").eq("products.status", "published")),
    fetchAll(() => db().from("content_translations").select("item_id,lang,slug,title,excerpt,seo_title,seo_description,content_items!inner(kind,status)").eq("status", "published").eq("content_items.status", "published")),
    fetchAll(() => db().from("product_images").select("id,product_id,alt_vi,products!inner(status,sku)").eq("products.status", "published")),
    fetchAll(() => db().from("products").select("id,sku").eq("status", "published"))
  ]);
  const rows = [
    ...pt.map((x) => ({ kind: "product", id: x.product_id, lang: x.lang, title: x.seo_title || x.name, name: x.name, desc: x.seo_description || x.short_desc || "", hasSeoDesc: !!x.seo_description })),
    ...ct.map((x) => ({ kind: x.content_items.kind, id: x.item_id, lang: x.lang, title: x.seo_title || x.title, name: x.title, desc: x.seo_description || x.excerpt || "", hasSeoDesc: !!x.seo_description }))
  ];
  const cnt = (key) => { const m = new Map(); for (const r of rows) { const k = r.lang + "|" + (r[key] || "").trim().toLowerCase(); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const dupT = cnt("title"), dupD = cnt("desc");
  for (const r of rows) {
    r.issues = [];
    const tl = (r.title || "").length, dl = r.desc.length;
    if (tl < 15) r.issues.push(["bad", `Tiêu đề quá ngắn (${tl})`]); else if (tl > 60) r.issues.push(["warn", `Tiêu đề dài (${tl}/60)`]);
    if (!dl) r.issues.push(["bad", "Thiếu mô tả"]); else if (dl < 70) r.issues.push(["warn", `Mô tả ngắn (${dl}/70)`]); else if (dl > 160) r.issues.push(["warn", `Mô tả dài (${dl}/160)`]);
    if (dl && !r.hasSeoDesc) r.issues.push(["info", "Đang dùng mô tả ngắn/tóm tắt làm mô tả SEO"]);
    if (dupT.get(r.lang + "|" + (r.title || "").trim().toLowerCase()) > 1) r.issues.push(["warn", "Trùng tiêu đề với trang khác"]);
    if (dl && dupD.get(r.lang + "|" + r.desc.trim().toLowerCase()) > 1) r.issues.push(["warn", "Trùng mô tả với trang khác"]);
  }
  const noAlt = im.filter((x) => !x.alt_vi || !x.alt_vi.trim()), enProd = new Set(pt.filter((x) => x.lang === "en").map((x) => x.product_id));
  const noEn = pubProd.filter((p) => !enProd.has(p.id));
  const bad = rows.filter((r) => r.issues.some(([s]) => s === "bad" || s === "warn")).sort((a, b) => b.issues.filter(([s]) => s === "bad").length - a.issues.filter(([s]) => s === "bad").length);
  const link = (r) => (r.kind === "product" ? `#/products/${r.id}` : `#/${KEYS[r.kind]}/${r.id}`);
  $("#view").innerHTML = `<h1>Kiểm tra SEO</h1><p class="hint">Phân tích các sản phẩm và nội dung ĐÃ XUẤT BẢN theo mô tả/tiêu đề mà Google sẽ thấy. Đây là gợi ý tham khảo, không phải cam kết thứ hạng.</p>
  <div class="grid"><div class="card stat"><span class="muted">Trang đã xuất bản đã kiểm</span><b>${rows.length}</b></div><div class="card stat"><span class="muted">Trang có vấn đề cần xem</span><b>${bad.length}</b></div>
   <div class="card stat"><span class="muted">Ảnh sản phẩm thiếu alt (VI)</span><b>${noAlt.length}</b></div><div class="card stat"><span class="muted">Sản phẩm chưa có bản EN đã xuất bản</span><b>${noEn.length}</b></div></div>
  <h2>Trang cần xem lại</h2><div class="table-wrap"><table><thead><tr><th>Loại</th><th>Ngôn ngữ</th><th>Tiêu đề</th><th>Vấn đề</th><th></th></tr></thead><tbody>
  ${bad.slice(0, 300).map((r) => `<tr><td>${esc(KLAB[r.kind] || r.kind)}</td><td>${esc(r.lang.toUpperCase())}</td><td class="wrap">${esc(r.name)}</td><td class="wrap">${r.issues.map(([s, t]) => `<span class="badge ${s === "bad" ? "bad" : s === "warn" ? "warn" : ""}">${esc(t)}</span>`).join(" ")}</td><td><a href="${link(r)}">Sửa</a></td></tr>`).join("") || '<tr><td colspan="5" class="muted">Không có vấn đề nào. 👍</td></tr>'}</tbody></table></div>
  ${bad.length > 300 ? `<p class="hint">Chỉ hiện 300 trang đầu.</p>` : ""}
  ${noAlt.length ? `<h2>Ảnh sản phẩm thiếu mô tả (alt)</h2><p class="hint">Mô tả ảnh giúp SEO ảnh và người khiếm thị. Mở sản phẩm → tab Hình ảnh để điền. SKU: ${esc([...new Set(noAlt.map((x) => x.products.sku))].slice(0, 40).join(", "))}${new Set(noAlt.map((x) => x.products.sku)).size > 40 ? "…" : ""}</p>` : ""}`;
}

// ================= GA4 / GTM =================
const TF = { ga4_id: /^G-[A-Z0-9]{6,12}$/, gtm_id: /^GTM-[A-Z0-9]{4,10}$/ }, HOSTS = /^https:\/\/[a-z0-9*.-]+(:[0-9]{1,5})?$/;
const CSP_F = [["csp_script_extra", "Script (script-src)"], ["csp_connect_extra", "Kết nối (connect-src)"], ["csp_img_extra", "Ảnh (img-src)"], ["csp_frame_extra", "Khung nhúng (frame-src)"]];
async function viewTracking() {
  const r = await db().from("site_settings").select("key,value"); if (r.error) throw r.error;
  const cur = Object.fromEntries(r.data.map((x) => [x.key, x.value])), canW = can("settings.write");
  $("#view").innerHTML = `<h1>GA4 / Google Tag Manager</h1>
  <p class="hint">Mã theo dõi được nạp trên MỌI trang công khai nên chỉ Admin được đổi. Dùng <strong>GTM hoặc GA4 trực tiếp</strong>, không dùng cả hai (nếu nhập cả hai, hệ thống chỉ dùng GTM để tránh đếm trùng).</p>
  <form id="trform" class="card"><div class="form-grid">${inp("ga4_id", "GA4 Measurement ID (vd: G-ABC123XYZ9)", cur.ga4_id || "", "maxlength=20")}${inp("gtm_id", "GTM Container ID (vd: GTM-ABCD12)", cur.gtm_id || "", "maxlength=20")}
    ${sel("tracking_consent", "Đồng ý của khách", [["required", "Chỉ theo dõi sau khi khách bấm “Chấp nhận” (khuyến nghị)"], ["none", "Theo dõi ngay, không hỏi (chỉ khi đã có tư vấn pháp lý)"]], cur.tracking_consent === "none" ? "none" : "required")}</div>
  <h2>Sự kiện được gửi</h2><p class="hint"><code>view_item</code> (xem sản phẩm) · <code>add_to_cart</code> · <code>view_cart</code> · <code>begin_checkout</code> · <code>purchase</code> (mã đơn, giá trị, thuế VAT, phí ship, sản phẩm) · <code>generate_lead</code> (gửi báo giá / liên hệ). Không gửi tên, số điện thoại, email, địa chỉ khách. Giá trị theo VND.</p>
  <details><summary>Nâng cao: cho phép thêm tên miền (CSP)</summary><p class="hint">Website chặn mặc định mọi script/kết nối lạ. Nếu một thẻ trong GTM (Facebook Pixel, Hotjar…) cần tên miền khác, thêm vào đây. Mỗi ô là danh sách <code>https://tên-miền</code> cách nhau bằng dấu cách. Không dùng cho tên miền bạn không tin cậy.</p>
    <div class="form-grid">${CSP_F.map(([k, l]) => txa(k, l, cur[k] || "", 2)).join("")}</div></details>
  <p class="hint">Cách kiểm tra: mở website, bấm “Chấp nhận”, rồi xem GA4 → Báo cáo → Thời gian thực / DebugView, hoặc dùng Google Tag Assistant. Lưu ý cookie/đồng ý theo dõi có thể cần xác nhận với tư vấn pháp lý (Nghị định 13/2023/NĐ-CP).</p>
  <div class="actions">${canW ? '<button class="btn primary" type="submit">Lưu</button>' : '<span class="muted">Chỉ Admin được đổi.</span>'}</div></form>`;
  const form = $("#trform"); if (!canW) $$("input,select,textarea", form).forEach((x) => (x.disabled = true));
  form.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", form), async () => {
    const rows = [], empty = [];
    for (const k of ["ga4_id", "gtm_id"]) { const v = g(form, k).value.trim().toUpperCase(); if (!v) empty.push(k); else if (!TF[k].test(v)) throw new Error(k === "ga4_id" ? "GA4 ID không hợp lệ (dạng G-XXXXXXXXXX)." : "GTM ID không hợp lệ (dạng GTM-XXXXXXX)."); else rows.push({ key: k, value: v, is_public: true }); }
    rows.push({ key: "tracking_consent", value: g(form, "tracking_consent").value, is_public: true });
    for (const [k, l] of CSP_F) { const v = g(form, k).value.trim().replace(/\s+/g, " "); if (!v) empty.push(k); else { if (v.length > 500 || !v.split(" ").every((h) => HOSTS.test(h))) throw new Error(`${l}: chỉ nhận danh sách https://tên-miền[:cổng] (cho phép *. ở đầu), cách nhau bằng dấu cách.`); rows.push({ key: k, value: v, is_public: true }); } }
    if (rows.some((x) => x.key === "ga4_id") && rows.some((x) => x.key === "gtm_id") && !confirm("Bạn nhập cả GA4 và GTM. Hệ thống chỉ dùng GTM (GA4 sẽ bị bỏ qua). Tiếp tục?")) return;
    await saveSettings(rows, empty); toast("Đã lưu. Có hiệu lực trong tối đa 1 phút."); C.reload();
  }); });
}

C.register({ key: "redirects", title: "Chuyển hướng 301", group: "seo", view: viewRedirects });
C.register({ key: "seosettings", title: "Thiết lập SEO", group: "seo", view: viewSeoSettings });
C.register({ key: "seoaudit", title: "Kiểm tra SEO", group: "seo", view: viewAudit });
C.register({ key: "tracking", title: "GA4 / GTM", group: "seo", perm: "settings.write", view: viewTracking });
})();
