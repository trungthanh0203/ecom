/* Quản lý nội dung: trang, tin tức, dịch vụ, chính sách + chuyên mục tin. Trình soạn thảo trực quan tự làm (không thư viện ngoài).
   HTML luôn được lọc (allowlist) khi nạp vào trình soạn thảo, khi dán và khi lưu; Worker lọc thêm một lần nữa khi hiển thị công khai. */
(() => {
"use strict";
const C = window.CMS, { $, $$, esc, toast, busy, errMsg, openModal, closeModal, inp, txa, sel, chk, g, numOrNull, S, can, resizeImage, pubUrl, slugify, SLUG_RE, ST, tabs } = C;
const db = () => C.db();
const LANGS = (window.APP_CONFIG && window.APP_CONFIG.LANGS) || ["vi", "en"];
const LANG_NAME = { vi: "Tiếng Việt", en: "English" };
const KIND_DEF = { hasSlug: true, hasExcerpt: true, hasBody: true, hasSeo: true, hasCover: true, titleLabel: "Tiêu đề *", excerptLabel: "Tóm tắt (hiện ở danh sách & SEO)", bodyLabel: "Nội dung", coverLabel: "Ảnh đại diện", meta: [] };
const KIND = Object.fromEntries(Object.entries({
  pages: { kind: "page", title: "Trang nội dung", one: "trang" }, posts: { kind: "post", title: "Tin tức", one: "bài viết" },
  services: { kind: "service", title: "Dịch vụ", one: "dịch vụ" }, policies: { kind: "policy", title: "Chính sách", one: "chính sách" },
  faq: { kind: "faq", title: "Hỏi đáp (FAQ)", one: "câu hỏi", group: "company", titleLabel: "Câu hỏi *", bodyLabel: "Câu trả lời", hasSlug: false, hasExcerpt: false, hasSeo: false, hasCover: false },
  partners: { kind: "partner", title: "Đối tác", one: "đối tác", group: "company", titleLabel: "Tên đối tác *", excerptLabel: "Mô tả ngắn (tuỳ chọn)", coverLabel: "Logo đối tác", hasSlug: false, hasBody: false, hasSeo: false, meta: [["url", "Website đối tác (https://…)", "url"]] },
  certifications: { kind: "certification", title: "Chứng nhận", one: "chứng nhận", group: "company", titleLabel: "Tên chứng nhận *", excerptLabel: "Mô tả ngắn (tuỳ chọn)", coverLabel: "Ảnh chứng nhận", hasSlug: false, hasBody: false, hasSeo: false, meta: [["issuer", "Đơn vị cấp", "text"], ["year", "Năm cấp", "year"], ["url", "Liên kết xác minh (https://…)", "url"]] },
  projects: { kind: "project", title: "Dự án", one: "dự án", group: "company", titleLabel: "Tên dự án *", coverLabel: "Ảnh dự án", meta: [["client", "Khách hàng", "text"], ["year", "Năm thực hiện", "year"], ["url", "Website dự án (https://…)", "url"]] },
  careers: { kind: "career", title: "Tuyển dụng", one: "vị trí tuyển dụng", group: "company", titleLabel: "Vị trí tuyển dụng *", bodyLabel: "Mô tả công việc & yêu cầu", hasCover: false, meta: [["location", "Địa điểm làm việc", "text"], ["type", "Hình thức", "job"], ["deadline", "Hạn nộp hồ sơ (sau ngày này tin tự ẩn khỏi danh sách)", "date"], ["salary", "Mức lương (tuỳ chọn)", "text"], ["apply_email", "Email nhận hồ sơ", "email"]] }
}).map(([k, v]) => [k, { ...KIND_DEF, ...v }]));
const JOB = [["", "— Chưa chọn —"], ["full_time", "Toàn thời gian"], ["part_time", "Bán thời gian"], ["contract", "Hợp đồng"], ["intern", "Thực tập"], ["freelance", "Cộng tác viên"]];
const NO_DETAIL = new Set(["faq", "partner", "certification"]);   // chỉ có trang danh sách, không có trang chi tiết
const PUB = { vi: { post: "tin-tuc", service: "dich-vu", policy: "chinh-sach", faq: "hoi-dap", partner: "doi-tac", certification: "chung-nhan", project: "du-an", career: "tuyen-dung" }, en: { post: "news", service: "services", policy: "policies", faq: "faq", partner: "partners", certification: "certifications", project: "projects", career: "careers" } };
const liveUrl = (lang, kind, slug) => (kind === "page" ? `/${lang}/${slug}/` : NO_DETAIL.has(kind) ? `/${lang}/${PUB[lang][kind]}/` : `/${lang}/${PUB[lang][kind]}/${slug}/`);
const randSlugSuffix = () => Math.random().toString(36).slice(2, 7);
const CST = { draft: "Nháp", published: "Đã xuất bản", archived: "Lưu trữ" };
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// ---------- lọc HTML phía trình duyệt (allowlist; DOMParser không chạy mã) ----------
const OKT = new Set(["P", "BR", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "HR", "FIGURE", "FIGCAPTION", "CODE", "PRE"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "APPLET", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION", "SVG", "MATH", "NOSCRIPT", "TEMPLATE", "LINK", "META", "BASE", "TITLE", "HEAD", "AUDIO", "VIDEO", "SOURCE", "CANVAS"]);
const JUNK = new RegExp("[" + String.fromCharCode(92) + "s" + String.fromCharCode(0) + "-" + String.fromCharCode(32) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + String.fromCharCode(8203) + "-" + String.fromCharCode(8207) + "]+", "g");
const okHref = (v) => { const s = String(v).replace(JUNK, "").toLowerCase(); return /^(https?:|mailto:|tel:)/.test(s) || (/^[/#]/.test(s) && !s.startsWith("//")); };
const okSrc = (v) => { const s = String(v).replace(JUNK, ""); return s.startsWith(window.APP_CONFIG.SUPABASE_URL + "/storage/") || /^\/[^/]/.test(s); };
function walk(node) {
  for (const ch of [...node.childNodes]) {
    if (ch.nodeType === 8) { ch.remove(); continue; }
    if (ch.nodeType !== 1) continue;
    const t = ch.tagName;
    if (DROP.has(t)) { ch.remove(); continue; }
    walk(ch);
    if (!OKT.has(t)) { ch.replaceWith(...ch.childNodes); continue; }
    for (const a of [...ch.attributes]) {
      const n = a.name.toLowerCase();
      const ok = (t === "A" && (n === "href" || n === "title")) || (t === "IMG" && ["src", "alt", "width", "height"].includes(n)) || ((t === "TH" || t === "TD") && (n === "colspan" || n === "rowspan"));
      if (!ok) { ch.removeAttribute(a.name); continue; }
      if (n === "href" && !okHref(a.value)) ch.removeAttribute(a.name);
      else if (n === "src" && !okSrc(a.value)) ch.removeAttribute(a.name);
      else if (["width", "height", "colspan", "rowspan"].includes(n) && !/^\d{1,4}$/.test(a.value)) ch.removeAttribute(a.name);
    }
    if (t === "IMG" && !ch.getAttribute("src")) ch.remove();
  }
}
function cleanHtml(html) { const doc = new DOMParser().parseFromString("<body>" + (html || "") + "</body>", "text/html"); walk(doc.body); return doc.body.innerHTML; }
const blankHtml = (h) => !h || !h.replace(/<br\s*\/?>|<p>\s*<\/p>|&nbsp;|\s/gi, "");

// ---------- trình soạn thảo trực quan ----------
const BTNS = [["bold", "B", "Đậm"], ["italic", "I", "Nghiêng"], ["h2", "H2", "Tiêu đề lớn"], ["h3", "H3", "Tiêu đề nhỏ"], ["p", "Đoạn", "Đoạn văn thường"], ["ul", "• Danh sách", "Danh sách"], ["ol", "1. Danh sách", "Danh sách số"], ["quote", "Trích dẫn", "Trích dẫn"],
  ["link", "Liên kết", "Chèn liên kết"], ["image", "Ảnh", "Chèn ảnh"], ["clear", "Xoá định dạng", "Xoá định dạng"], ["source", "HTML", "Xem/sửa mã HTML"]];
const rteMarkup = (name, html) => `<div class="rte" data-rte="${name}"><div class="rte-bar">${BTNS.map(([c, l, t]) => `<button type="button" class="btn" data-cmd="${c}" title="${t}">${l}</button>`).join("")}</div>
  <div class="rte-body rich" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Nội dung">${cleanHtml(html)}</div><textarea class="rte-src" hidden rows="14" spellcheck="false"></textarea></div>`;
function wireRte(root) {
  $$(".rte", root).forEach((box) => {
    const body = $(".rte-body", box), src = $(".rte-src", box), exec = (c, v) => { body.focus(); document.execCommand(c, false, v); };
    box.addEventListener("mousedown", (e) => { if (e.target.closest("[data-cmd]")) e.preventDefault(); });   // giữ vùng chọn khi bấm nút
    body.addEventListener("paste", (e) => { e.preventDefault(); const h = e.clipboardData.getData("text/html"), t = e.clipboardData.getData("text/plain"); if (h) document.execCommand("insertHTML", false, cleanHtml(h)); else document.execCommand("insertText", false, t); });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cmd]"); if (!b) return; const c = b.dataset.cmd;
      if (src.hidden === false && c !== "source") return;
      if (c === "bold") exec("bold"); else if (c === "italic") exec("italic");
      else if (c === "h2") exec("formatBlock", "<h2>"); else if (c === "h3") exec("formatBlock", "<h3>"); else if (c === "p") exec("formatBlock", "<p>");
      else if (c === "ul") exec("insertUnorderedList"); else if (c === "ol") exec("insertOrderedList"); else if (c === "quote") exec("formatBlock", "<blockquote>");
      else if (c === "clear") exec("removeFormat");
      else if (c === "link") {
        const url = prompt("Địa chỉ liên kết (https://…, mailto:…, tel:… hoặc /đường-dẫn):"); if (!url) return;
        if (!okHref(url)) return toast("Địa chỉ liên kết không hợp lệ.", true); exec("createLink", url.trim());
      } else if (c === "image") {
        const range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
        const f = document.createElement("input"); f.type = "file"; f.accept = "image/jpeg,image/png,image/webp";
        f.onchange = () => busy(b, async () => {
          if (!f.files[0]) return;
          const alt = prompt("Mô tả ảnh (alt) — giúp người khiếm thị và SEO:", "") ?? ""; const blob = await resizeImage(f.files[0]);
          const path = `content/${crypto.randomUUID()}.webp`, up = await db().storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }); if (up.error) throw up.error;
          body.focus(); if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
          document.execCommand("insertHTML", false, `<img src="${esc(pubUrl(path))}" alt="${esc(alt)}">`);
        }); f.click();
      } else if (c === "source") {
        if (src.hidden) { src.value = cleanHtml(body.innerHTML); src.hidden = false; body.hidden = true; b.classList.add("on"); }
        else { body.innerHTML = cleanHtml(src.value); src.hidden = true; body.hidden = false; b.classList.remove("on"); }
      }
    });
  });
}
const readRte = (box) => { const h = cleanHtml($(".rte-src", box).hidden ? $(".rte-body", box).innerHTML : $(".rte-src", box).value); return blankHtml(h) ? "" : h; };

// ---------- danh sách ----------
const LF = {};
async function viewList(key) {
  const K = KIND[key], f = (LF[key] = LF[key] || { status: "", page: 0 }), PG = 25;
  let q = db().from("content_items").select("id,status,publish_at,sort,created_at,content_translations(lang,slug,title,status)", { count: "exact" }).eq("kind", K.kind).order("created_at", { ascending: false }).range(f.page * PG, f.page * PG + PG - 1);
  if (f.status) q = q.eq("status", f.status);
  const { data, count, error } = await q; if (error) throw error;
  const trBadge = (r, l) => { const t = (r.content_translations || []).find((x) => x.lang === l); return t ? `<span class="badge ${t.status === "published" ? "ok" : "warn"}">${l.toUpperCase()}: ${esc(ST[t.status])}</span>` : `<span class="badge bad">${l.toUpperCase()}: thiếu</span>`; };
  const rows = data.map((r) => { const vi = (r.content_translations || []).find((x) => x.lang === "vi"); return `<tr class="row" data-id="${r.id}"><td class="wrap"><strong>${esc(vi ? vi.title : "(chưa có tiêu đề)")}</strong>${K.hasSlug ? `<br><small class="muted">${esc(vi ? "/" + vi.slug : "")}</small>` : ""}</td>
    <td><span class="badge ${r.status === "published" ? "ok" : ""}">${esc(CST[r.status])}</span>${r.publish_at && r.status === "published" && new Date(r.publish_at) > new Date() ? `<br><small class="muted">Hẹn: ${esc(fmtDT(r.publish_at))}</small>` : ""}</td>
    <td>${LANGS.map((l) => trBadge(r, l)).join("")}</td><td>${esc(fmtDT(r.created_at))}</td></tr>`; }).join("");
  const pages = Math.max(1, Math.ceil((count || 0) / PG));
  $("#view").innerHTML = `<h1>${esc(K.title)} <span class="muted">(${count ?? 0})</span></h1>
  <div class="toolbar">${sel("st", "Trạng thái", [["", "Tất cả"], ...Object.entries(CST)], f.status, 'id="cl-st"')}${can("content.write") ? `<button class="btn primary fix" id="c-new">+ Thêm ${esc(K.one)}</button>` : ""}
  ${key === "posts" ? '<a class="btn fix" href="#/postcats">Quản lý chuyên mục</a>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Tiêu đề</th><th>Trạng thái</th><th>Bản dịch</th><th>Tạo lúc</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Chưa có nội dung.</td></tr>'}</tbody></table></div>
  <div class="pager"><button class="btn" id="cl-prev" ${f.page <= 0 ? "disabled" : ""}>‹ Trước</button><span>Trang ${f.page + 1}/${pages}</span><button class="btn" id="cl-next" ${f.page + 1 >= pages ? "disabled" : ""}>Sau ›</button></div>`;
  const v = $("#view");
  $("#cl-st", v).addEventListener("change", (e) => { f.status = e.target.value; f.page = 0; C.reload(); });
  $("#cl-prev", v).addEventListener("click", () => { f.page--; C.reload(); }); $("#cl-next", v).addEventListener("click", () => { f.page++; C.reload(); });
  $("#c-new", v)?.addEventListener("click", () => (location.hash = `#/${key}/new`));
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => (location.hash = `#/${key}/${r.dataset.id}`)));
}

// ---------- soạn / sửa ----------
const TRF_ALL = [["title", "title", "input"], ["slug", "slug", "input"], ["excerpt", "excerpt", "ta3"], ["body", "body", "rte"], ["seo_title", "seo", "input"], ["seo_description", "seo", "ta2"]];
const trFieldsOf = (K) => TRF_ALL.filter(([k, grp]) => (grp === "title") || (k === "slug" ? K.hasSlug : grp === "excerpt" ? K.hasExcerpt : grp === "body" ? K.hasBody : K.hasSeo));
const trLabel = (K, k) => ({ title: K.titleLabel, slug: "Slug (đường dẫn)", excerpt: K.excerptLabel, body: K.bodyLabel, seo_title: "SEO title", seo_description: "SEO description" }[k]);
function trFieldset(lang, t, canPub, K) {
  t = t || {};
  const body = trFieldsOf(K).map(([k, , type]) => { const lab = trLabel(K, k); return type === "input" ? inp(`${lang}__${k}`, lab, t[k] || "") : type === "rte" ? `<div class="full"><span class="lbl">${esc(lab)}</span>${rteMarkup(`${lang}__${k}`, t[k])}</div>` : txa(`${lang}__${k}`, lab, t[k] || "", Number(type.slice(2))); }).join("");
  return `<fieldset class="tr" data-lang="${lang}"><legend>${esc(LANG_NAME[lang] || lang)}</legend><div class="form-grid">${body}
    ${sel(`${lang}__status`, "Trạng thái bản dịch", canPub ? [["draft", "Nháp"], ["reviewed", "Đã duyệt"], ["published", "Đã xuất bản"]] : [["draft", "Nháp"]], t.status || "draft")}
    <div>${chk(`${lang}__machine_translated`, "Đây là bản dịch máy (cần người duyệt)", t.machine_translated)}</div></div>
    ${K.kind === "page" ? '<p class="hint">Slug của trang nằm ngay sau /' + lang + '/ nên không được trùng đường dẫn hệ thống (san-pham, gio-hang, lien-he, tin-tuc, hoi-dap…).</p>' : ""}
    ${!K.hasSlug ? '<p class="hint">Mục này chỉ hiện trong trang danh sách nên không cần đường dẫn riêng (hệ thống tự tạo).</p>' : ""}
    ${lang !== "vi" ? '<p class="hint">Bản dịch máy không tự xuất bản — chỉ chuyển “Đã xuất bản” sau khi người có quyền đã đọc duyệt.</p>' : ""}</fieldset>`;
}
function readTr(root, lang, K, old) {
  const o = {}; let any = false;
  for (const [k, , type] of trFieldsOf(K)) { const el = type === "rte" ? $(`[data-rte="${lang}__${k}"]`, root) : g(root, `${lang}__${k}`); const v = type === "rte" ? readRteSafe(el) : (el?.value || "").trim(); o[k] = v || null; if (v) any = true; }
  if (!any) return null;
  if (!o.title) throw new Error(`Bản dịch ${lang.toUpperCase()}: thiếu ${K.titleLabel.replace(" *", "").toLowerCase()}.`);
  o.slug = K.hasSlug ? (o.slug || slugify(o.title)) : ((old && old.slug) || (slugify(o.title).slice(0, 50) || "muc") + "-" + randSlugSuffix());   // mục không có trang riêng: slug tự tạo, giữ nguyên khi sửa
  if (!SLUG_RE.test(o.slug)) throw new Error(`Bản dịch ${lang.toUpperCase()}: slug chỉ gồm a-z, 0-9 và dấu gạch ngang.`);
  o.status = g(root, `${lang}__status`).value; o.machine_translated = g(root, `${lang}__machine_translated`).checked; o.lang = lang; return o;
}
const readRteSafe = (el) => (el ? readRte(el) : "");
function metaHtml(K, meta) {
  return K.meta.map(([k, label, t]) => { const v = meta && meta[k] != null ? meta[k] : "", n = `meta__${k}`;
    if (t === "job") return sel(n, label, JOB, v);
    if (t === "year") return inp(n, label, v, 'type="number" min="1900" max="2100" step="1"');
    if (t === "date") return inp(n, label, v, 'type="date"');
    if (t === "email") return inp(n, label, v, 'type="email" maxlength="200"');
    if (t === "url") return inp(n, label, v, 'type="url" maxlength="500" placeholder="https://"');
    return inp(n, label, v, "maxlength=200"); }).join("");
}
function readMeta(root, K) {
  const m = {};
  for (const [k, label, t] of K.meta) {
    const v = (g(root, `meta__${k}`)?.value || "").trim(), nm = label.split(" (")[0];
    if (!v) continue;
    if (t === "url" && !/^https:\/\/[^\s<>"']+$/.test(v)) throw new Error(`${nm}: phải bắt đầu bằng https://`);
    if (t === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error(`${nm}: email không hợp lệ.`);
    if (t === "year") { const n = Number(v); if (!Number.isInteger(n) || n < 1900 || n > 2100) throw new Error(`${nm}: nhập năm từ 1900 đến 2100.`); m[k] = n; continue; }
    if (t === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) throw new Error(`${nm}: ngày không hợp lệ.`);
    m[k] = v;
  }
  return m;
}

async function viewEdit(key, arg) {
  const K = KIND[key], isNew = arg === "new", canW = can("content.write"), canPub = can("content.publish");
  if (isNew && !canW) return '<h1>Không có quyền</h1><p class="error">Bạn không có quyền tạo nội dung.</p>';
  let item = { status: "draft", sort: 0 }, TR = {}, cats = [];
  if (K.kind === "post") { const r = await db().from("post_categories").select("id,sort,active,post_category_translations(lang,name)").order("sort"); if (r.error) throw r.error; cats = r.data; }
  if (!isNew) {
    const id = Number(arg), [i, t] = await Promise.all([db().from("content_items").select("*").eq("id", id).eq("kind", K.kind).maybeSingle(), db().from("content_translations").select("*").eq("item_id", id)]);
    for (const r of [i, t]) if (r.error) throw r.error;
    if (!i.data) return `<h1>Không tìm thấy</h1><p><a href="#/${key}">← Danh sách</a></p>`;
    item = i.data; t.data.forEach((x) => (TR[x.lang] = x));
  }
  const catOpts = [["", "— Không —"], ...cats.map((c) => [c.id, (c.post_category_translations.find((x) => x.lang === "vi") || {}).name || "#" + c.id])];
  const viPub = TR.vi && TR.vi.status === "published" && item.status === "published";
  $("#view").innerHTML = `<p><a href="#/${key}">← ${esc(K.title)}</a></p><h1>${isNew ? "Thêm " + esc(K.one) : "Sửa " + esc(K.one)}</h1>
  <form id="cform" class="card" novalidate><div class="tabs"><button type="button" class="on" data-tab="gen">Thông tin chung</button>${LANGS.map((l) => `<button type="button" data-tab="tr-${l}">Nội dung ${l.toUpperCase()}</button>`).join("")}</div>
  <div class="pane" data-pane="gen"><div class="form-grid">
    ${sel("status", "Trạng thái", canPub ? [["draft", "Nháp"], ["published", "Đã xuất bản"], ["archived", "Lưu trữ"]] : [["draft", "Nháp"]], item.status)}
    ${inp("publish_at", "Hẹn giờ hiển thị (trống = ngay khi xuất bản)", toLocalInput(item.publish_at), 'type="datetime-local"')}${inp("sort", "Thứ tự (nhỏ hiện trước)", item.sort, 'type="number"')}
    ${K.kind === "post" ? inp("author_name", "Tác giả", item.author_name || "") + sel("post_category_id", "Chuyên mục", catOpts, item.post_category_id) : ""}
    ${metaHtml(K, item.meta)}
    ${K.hasCover ? `<div class="full"><label>${esc(K.coverLabel)} (JPG/PNG/WebP)<input type="file" name="cover" accept="image/jpeg,image/png,image/webp"></label>
      ${item.cover_path ? `<div id="cover-cur"><img src="${esc(pubUrl(item.cover_path))}" alt="" height="80"> ${chk("cover_remove", "Gỡ ảnh", false)}</div>` : ""}</div>` : ""}</div>
    <p class="hint">Nội dung chỉ hiện trên website khi: trạng thái “Đã xuất bản”, đã đến giờ hẹn, VÀ bản dịch của ngôn ngữ đó ở trạng thái “Đã xuất bản”.</p>
    ${viPub ? `<p><a target="_blank" rel="noopener" href="${esc(liveUrl("vi", K.kind, TR.vi.slug))}">Xem trên website (VI) ↗</a></p>` : ""}</div>
  ${LANGS.map((l) => `<div class="pane" data-pane="tr-${l}" hidden>${trFieldset(l, TR[l], canPub, K)}</div>`).join("")}
  <div class="actions">${canW ? '<button class="btn primary" type="submit" id="c-save">Lưu</button>' : '<span class="muted">Chỉ xem</span>'}${!isNew && canW ? '<button class="btn danger" type="button" id="c-del">Xoá</button>' : ""}</div></form>`;
  const root = $("#cform"); tabs(root); wireRte(root);
  if (!canW) { $$("input,select,textarea", root).forEach((x) => (x.disabled = true)); $$(".rte-body", root).forEach((x) => (x.contentEditable = "false")); $$(".rte-bar button", root).forEach((x) => (x.disabled = true)); }
  let id = isNew ? null : item.id;
  root.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("#c-save"), async () => {
    const trs = LANGS.map((l) => readTr(root, l, K, TR[l])).filter(Boolean);
    if (!trs.some((t) => t.lang === "vi")) throw new Error("Cần nhập ít nhất nội dung tiếng Việt (có tiêu đề).");
    const row = { status: g(root, "status").value, sort: Number(g(root, "sort").value || 0), publish_at: g(root, "publish_at").value ? new Date(g(root, "publish_at").value).toISOString() : null };
    if (K.meta.length) row.meta = readMeta(root, K);
    if (K.kind === "post") { row.author_name = g(root, "author_name").value.trim() || null; row.post_category_id = numOrNull(g(root, "post_category_id").value); }
    let oldCover = null, newCover = null; const file = K.hasCover ? g(root, "cover").files[0] : null;
    if (file) { const blob = await resizeImage(file), path = `content/cover-${crypto.randomUUID()}.webp`; const up = await db().storage.from("media").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }); if (up.error) throw up.error; newCover = path; oldCover = item.cover_path || null; row.cover_path = path; }
    else if (K.hasCover && g(root, "cover_remove")?.checked) { oldCover = item.cover_path; row.cover_path = null; }
    try {
      if (!id) { const r = await db().from("content_items").insert({ kind: K.kind, ...row }).select("id").single(); if (r.error) throw r.error; id = r.data.id; }
      else { const r = await db().from("content_items").update(row).eq("id", id); if (r.error) throw r.error; }
    } catch (e) { if (newCover) await db().storage.from("media").remove([newCover]); throw e; }
    if (oldCover) await db().storage.from("media").remove([oldCover]);
    const tr = await db().from("content_translations").upsert(trs.map((t) => ({ ...t, item_id: id })), { onConflict: "item_id,lang" });
    if (tr.error) { history.replaceState(null, "", `#/${key}/${id}`); throw tr.error; }
    if (window.CMS.afterSlugChange) await window.CMS.afterSlugChange(K.kind, TR, trs, item.status === "published");   // đổi slug => tự tạo chuyển hướng 301
    const live = row.status === "published" && trs.some((t) => t.status === "published");
    toast(live ? "Đã lưu. Nội dung hiển thị trên website trong tối đa 1 phút." : row.status === "published" ? "Đã lưu — nhưng chưa hiện vì chưa có bản dịch ở trạng thái “Đã xuất bản”." : "Đã lưu.");
    if (isNew) location.hash = `#/${key}/${id}`; else C.reload();
  }); });
  $("#c-del")?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá vĩnh viễn nội dung này? Nên chọn “Lưu trữ” nếu chỉ muốn gỡ khỏi website.")) return;
    const r = await db().from("content_items").delete().eq("id", id).select("id"); if (r.error) throw r.error;
    if (!r.data.length) throw new Error("Không xoá được (không có quyền).");
    if (item.cover_path) await db().storage.from("media").remove([item.cover_path]);
    toast("Đã xoá."); location.hash = `#/${key}`;
  }));
}

const makeView = (key) => (arg) => (arg ? viewEdit(key, arg) : viewList(key));

// ---------- chuyên mục tin ----------
async function viewPostCats() {
  const { data, error } = await db().from("post_categories").select("id,sort,active,post_category_translations(lang,slug,name,status)").order("sort").order("id"); if (error) throw error;
  const canW = can("content.publish");
  $("#view").innerHTML = `<p><a href="#/posts">← Tin tức</a></p><h1>Chuyên mục tin tức</h1><div class="toolbar">${canW ? '<button class="btn primary fix" id="pc-new">+ Thêm chuyên mục</button>' : '<span class="muted">Chỉ xem</span>'}</div>
  <div class="table-wrap"><table><thead><tr><th>ID</th><th>Tên (VI)</th><th>Slug</th><th>Thứ tự</th><th>Hiển thị</th><th>EN</th></tr></thead><tbody>
  ${data.map((c) => { const vi = c.post_category_translations.find((x) => x.lang === "vi") || {}, en = c.post_category_translations.find((x) => x.lang === "en"); return `<tr class="row" data-id="${c.id}"><td>${c.id}</td><td>${esc(vi.name || "(chưa có tên)")}</td><td>${esc(vi.slug || "")}</td><td>${c.sort}</td><td>${c.active ? "✓" : "—"}</td><td><span class="badge ${en ? (en.status === "published" ? "ok" : "warn") : "bad"}">${en ? esc(ST[en.status]) : "thiếu"}</span></td></tr>`; }).join("") || '<tr><td colspan="6" class="muted">Chưa có chuyên mục.</td></tr>'}</tbody></table></div>`;
  const v = $("#view");
  $("#pc-new", v)?.addEventListener("click", () => catModal(null, data)); $$("tr.row", v).forEach((r) => r.addEventListener("click", () => catModal(data.find((x) => x.id === Number(r.dataset.id)), data)));
}
function catModal(row, all) {
  const canW = can("content.publish"), r = row || { sort: 0, active: true }, TRm = Object.fromEntries((r.post_category_translations || []).map((t) => [t.lang, t]));
  const m = openModal(`<form id="pcform"><h2>${row ? "Sửa" : "Thêm"} chuyên mục</h2><div class="form-grid">${inp("sort", "Thứ tự", r.sort, 'type="number"')}<div>${chk("active", "Hiển thị trên website", r.active)}</div></div>
    ${LANGS.map((l) => `<fieldset class="tr" data-lang="${l}"><legend>${esc(LANG_NAME[l] || l)}</legend><div class="form-grid">${inp(`${l}__name`, "Tên", (TRm[l] || {}).name || "")}${inp(`${l}__slug`, "Slug", (TRm[l] || {}).slug || "")}
      ${sel(`${l}__status`, "Trạng thái", canW ? [["draft", "Nháp"], ["reviewed", "Đã duyệt"], ["published", "Đã xuất bản"]] : [["draft", "Nháp"]], (TRm[l] || {}).status || "draft")}<div>${chk(`${l}__machine`, "Dịch máy", (TRm[l] || {}).machine_translated)}</div></div></fieldset>`).join("")}
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="pc-cancel">Đóng</button>${row && canW ? '<button class="btn danger" type="button" id="pc-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#pcform", m); if (!canW) $$("input,select", f).forEach((x) => (x.disabled = true));
  $("#pc-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const trs = [];
    for (const l of LANGS) { const name = g(f, `${l}__name`).value.trim(); if (!name) continue; const slug = g(f, `${l}__slug`).value.trim() || slugify(name); if (!SLUG_RE.test(slug)) throw new Error(`Slug ${l.toUpperCase()} không hợp lệ.`); trs.push({ lang: l, name, slug, status: g(f, `${l}__status`).value, machine_translated: g(f, `${l}__machine`).checked }); }
    if (!trs.some((t) => t.lang === "vi")) throw new Error("Cần nhập tên tiếng Việt.");
    const base = { sort: Number(g(f, "sort").value || 0), active: g(f, "active").checked }; let id = row?.id;
    if (id) { const u = await db().from("post_categories").update(base).eq("id", id); if (u.error) throw u.error; } else { const i = await db().from("post_categories").insert(base).select("id").single(); if (i.error) throw i.error; id = i.data.id; }
    const t = await db().from("post_category_translations").upsert(trs.map((x) => ({ ...x, post_category_id: id })), { onConflict: "post_category_id,lang" }); if (t.error) throw t.error;
    closeModal(); toast("Đã lưu."); C.reload();
  }); });
  $("#pc-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => { if (!confirm("Xoá chuyên mục? Các bài trong chuyên mục sẽ thành “không chuyên mục”.")) return; const d = await db().from("post_categories").delete().eq("id", row.id); if (d.error) throw d.error; closeModal(); toast("Đã xoá."); C.reload(); }));
}

C.rte = { rteMarkup, wireRte, readRte, cleanHtml };
for (const [key, K] of Object.entries(KIND)) C.register({ key, title: K.title, group: K.group || "content", view: makeView(key) });
C.register({ key: "postcats", title: "Chuyên mục tin", group: "content", view: viewPostCats });
})();
