/* JS phía khách: giỏ hàng (localStorage chỉ lưu {product_id, qty}), checkout, báo giá, liên hệ.
   Giá luôn do server tính — client chỉ hiển thị kết quả /api/cart/price. */
(() => {
"use strict";
const J = JSON.parse(document.getElementById("i18n").textContent), T = J.T, LANG = J.lang;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
const ST = { vi: { new: "Mới tiếp nhận", confirmed: "Đã xác nhận", preparing: "Đang chuẩn bị hàng", shipping: "Đang giao hàng", completed: "Hoàn thành", cancelled: "Đã huỷ", returned: "Hoàn trả", unpaid: "Chưa thanh toán", pending_verification: "Chờ xác minh", paid: "Đã thanh toán", failed: "Thất bại", refunded: "Đã hoàn tiền" },
  en: { new: "Received", confirmed: "Confirmed", preparing: "Preparing", shipping: "Shipping", completed: "Completed", cancelled: "Cancelled", returned: "Returned", unpaid: "Unpaid", pending_verification: "Pending verification", paid: "Paid", failed: "Failed", refunded: "Refunded" } }[LANG] || {};

// ---- theo dõi GA4 / GTM: chỉ chạy khi đã cấu hình VÀ khách đã đồng ý (nếu website bật yêu cầu đồng ý). KHÔNG gửi dữ liệu cá nhân (không tên, SĐT, email, địa chỉ). ----
const TRK = J.track || {}, trackOn = () => !!(TRK.ga4 || TRK.gtm);
const getConsent = () => { try { return localStorage.getItem("consent_v1"); } catch { return null; } };
const setConsent = (v) => { try { localStorage.setItem("consent_v1", v); } catch { /* bỏ qua */ } };
const allowed = () => trackOn() && (TRK.consent === "none" || getConsent() === "granted");
let trkLoaded = false;
function loadTracking() {
  if (trkLoaded || !allowed()) return;
  trkLoaded = true; window.dataLayer = window.dataLayer || [];
  const inject = (src) => { const el = document.createElement("script"); el.async = true; el.src = src; document.head.appendChild(el); };
  if (TRK.gtm) { window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" }); inject("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(TRK.gtm)); }
  else if (TRK.ga4) { window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag("js", new Date()); window.gtag("config", TRK.ga4); inject("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(TRK.ga4)); }
}
function track(name, params) {
  if (!allowed() || !trkLoaded) return;
  if (TRK.gtm) { if (params && params.items) window.dataLayer.push({ ecommerce: null }); window.dataLayer.push({ event: name, ...(params && params.items ? { ecommerce: params } : params || {}) }); }
  else if (TRK.ga4 && window.gtag) window.gtag("event", name, params || {});
}
const itemOf = (x) => ({ item_id: x.sku, item_name: x.name, price: Number(x.price), quantity: x.qty || 1 });
const okItems = (q) => q.items.filter((i) => !i.problem).map((i) => itemOf({ sku: i.sku, name: i.name, price: i.unit_price, qty: i.qty }));
let viewed = false;
function pageEvents() {
  if (viewed || !allowed()) return;
  const el = document.getElementById("ev-item"); if (!el) return;
  try { const it = JSON.parse(el.textContent); viewed = true; track("view_item", { currency: it.currency || "VND", value: it.price, items: [{ item_id: it.item_id, item_name: it.item_name, price: it.price, quantity: 1 }] }); } catch { /* bỏ qua */ }
}
loadTracking();
const banner = $("#consent");
if (banner && trackOn() && TRK.consent === "required" && getConsent() === null) banner.hidden = false;
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-consent]");
  if (c) { const prev = getConsent(); setConsent(c.dataset.consent); if (banner) banner.hidden = true; if (c.dataset.consent === "granted") { loadTracking(); pageEvents(); } else if (prev === "granted") location.reload(); }
  if (e.target.closest("[data-cookie-settings]") && banner) banner.hidden = false;
});
const once = (k) => { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, "1"); } catch { /* không có sessionStorage: cho phép */ } return true; };

// ---- giỏ hàng ----
const CK = "cart_v1"; let mem = [];
const valid = (c) => Array.isArray(c) ? c.filter((x) => Number.isInteger(x.product_id) && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= 999) : [];
function getCart() { try { const c = valid(JSON.parse(localStorage.getItem(CK))); mem = c; return c; } catch { return mem; } }
function setCart(c) { mem = c; try { localStorage.setItem(CK, JSON.stringify(c)); } catch { /* bộ nhớ bị chặn: giữ trong RAM */ } badge(); }
function badge() { const n = getCart().reduce((s, x) => s + x.qty, 0), b = $("#cart-count"); if (b) { b.textContent = n; b.hidden = !n; } }
let tt; function toast(m, err) { const t = $("#toast"); if (!t) return; t.textContent = m; t.className = err ? "err" : ""; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3000); }

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    const id = Number(add.dataset.add), qi = add.dataset.qtyInput ? $(add.dataset.qtyInput) : null;
    const q = Math.min(999, Math.max(1, parseInt(qi?.value || "1", 10) || 1)), c = getCart(), ex = c.find((x) => x.product_id === id);
    if (ex) ex.qty = Math.min(999, ex.qty + q); else c.push({ product_id: id, qty: q });
    setCart(c); toast(T.added);
    const pr = Number(add.dataset.price); if (add.dataset.sku && Number.isFinite(pr)) track("add_to_cart", { currency: "VND", value: pr * q, items: [{ item_id: add.dataset.sku, item_name: add.dataset.name, price: pr, quantity: q }] });
  }
  const th = e.target.closest("[data-thumb]");
  if (th) { e.preventDefault(); const m = $("#main-img"); if (m) { m.src = th.href; m.alt = $("img", th)?.alt || m.alt; } }
});

async function post(url, body) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch { return { status: 0, data: {} }; }
}
const errMsg = (r) => (r.status === 429 ? T.err_RATE : T["err_" + r.data?.error] || T.err_GENERIC + (r.status === 0 ? " (NETWORK)" : r.data?.reason ? ` (${r.data.reason})` : ""));

function summary(q, withShip) {
  return `<dl class="sum"><div><dt>${esc(T.subtotal)}</dt><dd>${fmt(q.subtotal)}</dd></div><div><dt>${esc(T.vat)} (${Number(q.vat_rate)}%)</dt><dd>${fmt(q.vat_amount)}</dd></div>
  <div><dt>${esc(T.shipping)}</dt><dd>${withShip ? fmt(q.shipping_fee) : esc(T.ship_tbd)}</dd></div>
  <div class="tot"><dt>${esc(T.total)}</dt><dd>${fmt(withShip ? q.total : q.subtotal + q.vat_amount)}</dd></div></dl><p class="muted">${esc(T.price_note)}</p>`;
}
const probText = (p) => T["problem_" + p] || p;

// ---- trang giỏ hàng ----
let viewCart = false, began = false;
async function renderCart(root) {
  const cart = getCart();
  if (!cart.length) { root.innerHTML = `<p>${esc(T.cart_empty)}</p><p><a class="btn" href="${J.urls.products}">${esc(T.continue)}</a></p>`; return; }
  const r = await post("/api/cart/price", { items: cart, lang: LANG });
  if (r.status !== 200) { root.innerHTML = `<p class="error">${esc(errMsg(r))}</p><p><button class="btn" id="cart-clear">${esc(T.remove)}</button></p>`; $("#cart-clear")?.addEventListener("click", () => { setCart([]); renderCart(root); }); return; }
  const q = r.data, bad = q.items.some((i) => i.problem);
  if (!viewCart) { viewCart = true; track("view_cart", { currency: "VND", value: q.subtotal, items: okItems(q) }); }
  root.innerHTML = `<div class="table-wrap"><table class="cart"><thead><tr><th>${esc(T.item)}</th><th>${esc(T.unit_price)}</th><th>${esc(T.qty)}</th><th>${esc(T.line_total)}</th><th></th></tr></thead><tbody>
  ${q.items.map((i) => `<tr><td>${esc(i.name || "#" + i.product_id)}<br><small class="muted">${esc(i.sku || "")}</small>${i.problem ? `<br><small class="error">${esc(probText(i.problem))}</small>` : ""}</td>
  <td>${i.problem ? "—" : fmt(i.unit_price)}</td><td><input type="number" min="1" max="999" value="${i.qty}" data-qty="${i.product_id}" aria-label="${esc(T.qty)}"></td>
  <td>${i.problem ? "—" : fmt(i.line_total)}</td><td><button class="btn" data-rm="${i.product_id}">${esc(T.remove)}</button></td></tr>`).join("")}</tbody></table></div>
  ${summary(q, false)}<p><a class="btn" href="${J.urls.products}">${esc(T.continue)}</a> ${bad ? "" : `<a class="btn buy" href="${J.urls.checkout}">${esc(T.checkout)}</a>`}</p>`;
}
const cartRoot = $("#cart-root");
if (cartRoot) {
  renderCart(cartRoot);
  cartRoot.addEventListener("change", (e) => { const i = e.target.closest("[data-qty]"); if (!i) return; const c = getCart(), x = c.find((y) => y.product_id === Number(i.dataset.qty)); if (x) x.qty = Math.min(999, Math.max(1, parseInt(i.value, 10) || 1)); setCart(c); renderCart(cartRoot); });
  cartRoot.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; setCart(getCart().filter((y) => y.product_id !== Number(b.dataset.rm))); renderCart(cartRoot); });
}

// ---- form dùng chung ----
const idemKey = (name) => { try { let k = sessionStorage.getItem("idem_" + name); if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)) + "-" + Math.random().toString(36).slice(2, 8); sessionStorage.setItem("idem_" + name, k); } return k; } catch { return Date.now() + "-" + Math.random().toString(36).slice(2, 12); } };
const idemClear = (name) => { try { sessionStorage.removeItem("idem_" + name); } catch { /* bỏ qua */ } };
function bindForm(form, endpoint, name, build, onOk) {
  const msg = $("#form-msg", form), btn = $("button[type=submit]", form);
  const show = (m) => { msg.textContent = m; msg.hidden = !m; };
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); show("");
    if (!form.reportValidity()) return;
    const tok = form.querySelector('[name="cf-turnstile-response"]')?.value;
    if (J.sitekey && !tok) return show(T.turnstile_need);
    const body = { ...build(new FormData(form)), lang: LANG, consent: !!form.consent?.checked, website: form.website?.value || "", turnstile_token: tok, idempotency_key: idemKey(name) };
    btn.disabled = true; const label = btn.textContent; btn.textContent = T.sending;
    const r = await post(endpoint, body);
    btn.disabled = false; btn.textContent = label;
    if (r.status === 200) { idemClear(name); onOk(r.data, body); }
    else { show(errMsg(r)); window.turnstile?.reset?.(); }
  });
}

// ---- checkout ----
const ckForm = $("#checkout-form");
if (ckForm) {
  const box = $("#checkout-summary"); let timer;
  async function refresh() {
    const cart = getCart();
    if (!cart.length) { box.innerHTML = `<p>${esc(T.cart_empty)}</p><a class="btn" href="${J.urls.products}">${esc(T.continue)}</a>`; $("button[type=submit]", ckForm).disabled = true; return; }
    const r = await post("/api/cart/price", { items: cart, lang: LANG, province: ckForm.province.value });
    if (r.status !== 200) { box.innerHTML = `<p class="error">${esc(errMsg(r))}</p>`; return; }
    const q = r.data, bad = q.items.some((i) => i.problem);
    if (!began && !bad) { began = true; track("begin_checkout", { currency: "VND", value: q.subtotal, items: okItems(q) }); }
    box.innerHTML = `<ul class="lines">${q.items.map((i) => `<li>${esc(i.name || "#" + i.product_id)} × ${i.qty} — ${i.problem ? `<span class="error">${esc(probText(i.problem))}</span>` : fmt(i.line_total)}</li>`).join("")}</ul>${summary(q, true)}${bad ? `<p><a href="${J.urls.cart}">${esc(T.cart_title)}</a></p>` : ""}`;
    $("button[type=submit]", ckForm).disabled = bad || !$$('[name="payment_method"]', ckForm).length;
  }
  refresh(); ckForm.province.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
  bindForm(ckForm, "/api/checkout", "order", (fd) => ({
    customer: { name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email") || undefined, province: fd.get("province"), ward: fd.get("ward") || undefined, address: fd.get("address") },
    payment_method: fd.get("payment_method"), note: fd.get("note") || undefined, items: getCart() }),
  (data, body) => { try { sessionStorage.setItem("last_order", JSON.stringify({ code: data.code, phone: body.customer.phone })); } catch { /* bỏ qua */ } if (!data.hp) setCart([]); location.href = J.urls.confirm; });
}

// ---- xác nhận đơn ----
const cfRoot = $("#confirm-root");
if (cfRoot) (async () => {
  let o = null; try { o = JSON.parse(sessionStorage.getItem("last_order")); } catch { /* không có */ }
  if (!o?.code) { cfRoot.innerHTML = `<p>${esc(T.cf_none)}</p>`; return; }
  const r = await post("/api/order-lookup", o);
  if (r.status !== 200) { cfRoot.innerHTML = `<p>${esc(T.cf_none)}</p>`; return; }
  const d = r.data;
  if (once("ev_purchase_" + d.code)) track("purchase", { transaction_id: d.code, currency: "VND", value: d.total, tax: d.vat_amount, shipping: d.shipping_fee, items: (d.items || []).map((i) => itemOf({ sku: i.sku, name: i.name, price: i.unit_price, qty: i.qty })) });
  cfRoot.innerHTML = `<p>${esc(T.cf_code)}: <strong class="code">${esc(d.code)}</strong><br><small class="muted">${esc(T.cf_keep)}</small></p>
  <p>${esc(T.cf_status)}: ${esc(ST[d.status] || d.status)} · ${esc(T.cf_pay_status)}: ${esc(ST[d.payment_status] || d.payment_status)}</p>
  <ul class="lines">${(d.items || []).map((i) => `<li>${esc(i.name)} (${esc(i.sku)}) × ${i.qty} — ${fmt(i.line_total)}</li>`).join("")}</ul>${summary({ subtotal: d.subtotal, vat_rate: d.vat_rate, vat_amount: d.vat_amount, shipping_fee: d.shipping_fee, total: d.total }, true).replace(/<p class="muted">.*<\/p>/, "")}`;
  if (d.payment_method === "bank_transfer") { const b = $("#bank-box"); if (b) b.hidden = false; }
})();

// ---- báo giá B2B ----
const qForm = $("#quote-form");
if (qForm) {
  const rows = $("#q-rows"), dl = $("#q-suggest"), sug = new Map(); let st;
  const first = rows.firstElementChild;
  const syncRm = () => $$("[data-rm]", rows).forEach((b) => (b.hidden = rows.children.length < 2));
  $("#q-add").addEventListener("click", () => { if (rows.children.length >= 50) return; const n = first.cloneNode(true); $$("input", n).forEach((i) => { i.value = i.name === "item_qty" ? "10" : ""; delete i.dataset.pid; i.removeAttribute("data-pid"); }); rows.appendChild(n); syncRm(); });
  rows.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b && rows.children.length > 1) { b.closest(".qrow").remove(); syncRm(); } });
  rows.addEventListener("input", (e) => {
    const i = e.target; if (i.name !== "item_name") return;
    i.dataset.pid = sug.has(i.value) ? sug.get(i.value) : ""; clearTimeout(st);
    st = setTimeout(async () => { if (i.value.trim().length < 2) return; try { const r = await fetch(`/api/suggest?lang=${LANG}&q=${encodeURIComponent(i.value.trim())}`); const l = await r.json(); dl.innerHTML = ""; for (const x of l) { sug.set(x.sku, x.id); const o = document.createElement("option"); o.value = x.sku; o.label = x.name; dl.appendChild(o); } i.dataset.pid = sug.has(i.value) ? sug.get(i.value) : i.dataset.pid; } catch { /* gợi ý là tuỳ chọn */ } }, 250);
  });
  bindForm(qForm, "/api/quote", "quote", (fd) => ({
    contact_name: fd.get("contact_name"), company: fd.get("company"), phone: fd.get("phone"), email: fd.get("email"), tax_code: fd.get("tax_code") || undefined,
    delivery_area: fd.get("delivery_area") || undefined, expected_time: fd.get("expected_time") || undefined, message: fd.get("message") || undefined,
    items: $$(".qrow", rows).map((r) => { const n = $('[name="item_name"]', r), pid = n.dataset.pid; return { product_id: pid ? Number(pid) : undefined, name: n.value.trim(), qty: Number($('[name="item_qty"]', r).value), unit: $('[name="item_unit"]', r).value || undefined }; }) }),
  (data) => { try { sessionStorage.setItem("last_quote", data.code || ""); } catch { /* bỏ qua */ } location.href = J.urls.quoteDone; });
}
const qc = $("#quote-code"); if (qc) { let c = ""; try { c = sessionStorage.getItem("last_quote") || ""; } catch { /* bỏ qua */ } qc.textContent = c || "—"; if (c && once("ev_quote_" + c)) track("generate_lead", { lead_type: "quote" }); }

// ---- liên hệ ----
const cForm = $("#contact-form");
if (cForm) bindForm(cForm, "/api/contact", "contact", (fd) => ({ name: fd.get("name"), phone: fd.get("phone") || undefined, email: fd.get("email") || undefined, message: fd.get("message") }),
  () => { cForm.reset(); const m = $("#form-msg", cForm); m.className = "ok"; m.textContent = T.ct_ok; m.hidden = false; track("generate_lead", { lead_type: "contact" }); });

badge(); pageEvents();
})();
