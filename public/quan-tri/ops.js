/* Vận hành: đơn hàng, báo giá, liên hệ, cài đặt. Đăng ký vào CMS qua window.CMS (xem cms.js).
   Quyền thật nằm ở RLS/trigger trong DB; các nút ở đây chỉ để tiện — DB mới là nơi quyết định. */
(() => {
"use strict";
const { $, $$, esc, vnd, toast, busy, errMsg, openModal, closeModal, inp, txa, sel, chk, g, numOrNull, S, can } = window.CMS;
const db = () => window.CMS.db();
const PAGE = 25;

const ORD_ST = { new: "Mới tiếp nhận", confirmed: "Đã xác nhận", preparing: "Đang chuẩn bị hàng", shipping: "Đang giao hàng", completed: "Hoàn thành", cancelled: "Đã huỷ", returned: "Hoàn trả" };
const PAY_ST = { unpaid: "Chưa thanh toán", pending_verification: "Chờ xác minh", paid: "Đã thanh toán", failed: "Thất bại", refunded: "Đã hoàn tiền" };
const SHIP_ST = { not_shipped: "Chưa giao", in_transit: "Đang vận chuyển", delivered: "Đã giao", failed: "Giao thất bại", returned: "Hoàn trả" };
const QT_ST = { new: "Mới tiếp nhận", reviewing: "Đang xem xét", preparing_quote: "Đang lập báo giá", quote_sent: "Đã gửi báo giá", negotiating: "Đang thương lượng", won: "Đã chốt", failed: "Không thành công", closed: "Đóng yêu cầu" };
const PM = { cod: "COD", bank_transfer: "Chuyển khoản" };
// Bản sao bảng chuyển trạng thái trong DB (_transition_ok) — DB vẫn là nơi chặn thật.
const NEXT = {
  order: { new: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["shipping", "cancelled"], shipping: ["completed", "returned"], completed: ["returned"], cancelled: [], returned: [] },
  payment: { unpaid: ["pending_verification", "paid", "failed"], pending_verification: ["paid", "failed", "unpaid"], failed: ["unpaid", "pending_verification"], paid: ["refunded"], refunded: [] },
  shipping: { not_shipped: ["in_transit"], in_transit: ["delivered", "failed", "returned"], failed: ["in_transit", "returned"], delivered: ["returned"], returned: [] },
  quote: { new: ["reviewing", "failed", "closed"], reviewing: ["preparing_quote", "failed", "closed"], preparing_quote: ["quote_sent", "failed", "closed"], quote_sent: ["negotiating", "won", "failed", "closed"], negotiating: ["quote_sent", "won", "failed", "closed"], won: ["closed"], failed: ["closed", "reviewing"], closed: [] }
};
const DANGER = new Set(["cancelled", "returned", "refunded", "failed"]);
const COL = { order: "status", payment: "payment_status", shipping: "shipping_status", quote: "status" };

// ---------- tiện ích ----------
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
const bd = (map, k, cls = "") => `<span class="badge ${cls}">${esc(map[k] || k)}</span>`;
let DIR = null, DIR_UID = null;
async function dir() {
  if (DIR && DIR_UID === S.user.id) return DIR;
  const { data, error } = await db().rpc("staff_directory"); if (error) throw error;
  DIR = Object.fromEntries(data.map((x) => [x.user_id, x])); DIR_UID = S.user.id; return DIR;
}
const who = (d, id) => (id && d[id] ? d[id].display_name : id ? "(đã nghỉ)" : "—");
const dirOptions = (d, cur) => [["", "— Chưa phân công —"], ...Object.values(d).map((x) => [x.user_id, `${x.display_name} (${x.role})`])].map(([v, t]) => `<option value="${esc(v)}" ${v === (cur || "") ? "selected" : ""}>${esc(t)}</option>`).join("");
const safeQ = (s) => String(s || "").replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const dayStart = (d) => new Date(d + "T00:00:00").toISOString(), dayEnd = (d) => new Date(d + "T23:59:59.999").toISOString();

function csvDownload(name, header, rows) {
  const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };   // chống chèn công thức Excel
  const text = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function fetchAll(make, max = 5000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) { const { data, error } = await make().range(off, off + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
const pager = (page, total) => { const pages = Math.max(1, Math.ceil(total / PAGE)); return `<div class="pager"><button class="btn" data-pg="-1" ${page <= 0 ? "disabled" : ""}>‹ Trước</button><span>Trang ${page + 1}/${pages}</span><button class="btn" data-pg="1" ${page + 1 >= pages ? "disabled" : ""}>Sau ›</button></div>`; };

// ================= ĐƠN HÀNG =================
const OF = { q: "", status: "", pay: "", pm: "", from: "", to: "", page: 0 };
function ordersQuery(cols, count) {
  let q = db().from("orders").select(cols, count ? { count: "exact" } : undefined).order("created_at", { ascending: false });
  if (OF.status) q = q.eq("status", OF.status); if (OF.pay) q = q.eq("payment_status", OF.pay); if (OF.pm) q = q.eq("payment_method", OF.pm);
  if (OF.from) q = q.gte("created_at", dayStart(OF.from)); if (OF.to) q = q.lte("created_at", dayEnd(OF.to));
  const s = safeQ(OF.q); if (s) q = q.or(`code.ilike.%${s}%,recipient_name.ilike.%${s}%,phone.ilike.%${s}%`);
  return q;
}
async function viewOrders(arg) { return arg ? orderDetail(arg) : orderList(); }

async function orderList() {
  const d = await dir();
  const { data, count, error } = await ordersQuery("id,code,created_at,recipient_name,phone,total,status,payment_status,shipping_status,payment_method,assigned_to", true).range(OF.page * PAGE, OF.page * PAGE + PAGE - 1);
  if (error) throw error;
  const rows = data.map((o) => `<tr class="row" data-id="${o.id}"><td><strong>${esc(o.code)}</strong></td><td>${esc(fmtDT(o.created_at))}</td><td class="wrap">${esc(o.recipient_name)}<br><small class="muted">${esc(o.phone)}</small></td>
    <td>${vnd(o.total)}</td><td>${bd(ORD_ST, o.status, o.status === "new" ? "warn" : o.status === "completed" ? "ok" : o.status === "cancelled" ? "bad" : "")}</td>
    <td>${bd(PAY_ST, o.payment_status, o.payment_status === "paid" ? "ok" : "")} ${esc(PM[o.payment_method] || "")}</td><td>${bd(SHIP_ST, o.shipping_status)}</td><td>${esc(who(d, o.assigned_to))}</td></tr>`).join("");
  const opt = (m, cur) => [["", "Tất cả"], ...Object.entries(m)].map(([k, t]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
  $("#view").innerHTML = `<h1>Đơn hàng <span class="muted">(${count ?? 0})</span></h1>
  <div class="toolbar"><label>Tìm (mã / tên / SĐT)<input id="of-q" value="${esc(OF.q)}" placeholder="Nhập rồi Enter"></label>
   <label>Trạng thái đơn<select id="of-status">${opt(ORD_ST, OF.status)}</select></label><label>Thanh toán<select id="of-pay">${opt(PAY_ST, OF.pay)}</select></label>
   <label>Phương thức<select id="of-pm">${opt(PM, OF.pm)}</select></label><label>Từ ngày<input type="date" id="of-from" value="${esc(OF.from)}"></label><label>Đến ngày<input type="date" id="of-to" value="${esc(OF.to)}"></label>
   ${can("export.data") ? '<button class="btn fix" id="of-csv">Xuất CSV</button>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Mã đơn</th><th>Ngày đặt</th><th>Khách</th><th>Tổng</th><th>Trạng thái</th><th>Thanh toán</th><th>Vận chuyển</th><th>Phụ trách</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="muted">Chưa có đơn hàng.</td></tr>'}</tbody></table></div>${pager(OF.page, count || 0)}`;
  const v = $("#view"), bind = (id, k) => $(id, v).addEventListener("change", (e) => { OF[k] = e.target.value; OF.page = 0; window.CMS.reload(); });
  $("#of-q", v).addEventListener("keydown", (e) => { if (e.key === "Enter") { OF.q = e.target.value.trim(); OF.page = 0; window.CMS.reload(); } });
  bind("#of-status", "status"); bind("#of-pay", "pay"); bind("#of-pm", "pm"); bind("#of-from", "from"); bind("#of-to", "to");
  $$("[data-pg]", v).forEach((b) => b.addEventListener("click", () => { OF.page += Number(b.dataset.pg); window.CMS.reload(); }));
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => (location.hash = "#/orders/" + r.dataset.id)));
  $("#of-csv", v)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const all = await fetchAll(() => ordersQuery("code,created_at,recipient_name,phone,email,province,ward,address_line,subtotal,vat_amount,shipping_fee,total,status,payment_status,shipping_status,payment_method,note"));
    csvDownload(`don-hang-${new Date().toISOString().slice(0, 10)}.csv`, ["Mã đơn", "Ngày đặt", "Người nhận", "SĐT", "Email", "Tỉnh/TP", "Phường/Xã", "Địa chỉ", "Tiền hàng", "VAT", "Phí vận chuyển", "Tổng", "Trạng thái đơn", "Thanh toán", "Vận chuyển", "Phương thức TT", "Ghi chú khách"],
      all.map((o) => [o.code, fmtDT(o.created_at), o.recipient_name, o.phone, o.email, o.province, o.ward, o.address_line, o.subtotal, o.vat_amount, o.shipping_fee, o.total, ORD_ST[o.status], PAY_ST[o.payment_status], SHIP_ST[o.shipping_status], PM[o.payment_method], o.note]));
    toast(`Đã xuất ${all.length} đơn.`);
  }));
}

function statusCard(kind, title, labels, cur, canW) {
  const nexts = NEXT[kind][cur] || [];
  return `<div class="card"><h3>${esc(title)}</h3><p>${bd(labels, cur)}</p>${canW && nexts.length
    ? `<label>Chuyển sang<select data-st="${kind}">${nexts.map((n) => `<option value="${n}">${esc(labels[n])}</option>`).join("")}</select></label><button class="btn primary" data-apply="${kind}">Cập nhật</button>`
    : `<p class="hint">${canW ? "Không còn bước chuyển tiếp." : "Bạn không có quyền đổi trạng thái."}</p>`}</div>`;
}

async function orderDetail(id) {
  const [d, o, it, hs, nt] = await Promise.all([dir(),
    db().from("orders").select("*").eq("id", id).maybeSingle(), db().from("order_items").select("*").eq("order_id", id).order("id"),
    db().from("order_status_history").select("*").eq("order_id", id).order("at").order("id"), db().from("order_notes").select("*").eq("order_id", id).order("at")]);
  for (const r of [o, it, hs, nt]) if (r.error) throw r.error;
  if (!o.data) { $("#view").innerHTML = '<h1>Không tìm thấy đơn hàng</h1><p><a href="#/orders">← Danh sách</a></p>'; return; }
  const x = o.data, canW = can("orders.write");
  const KL = { order: "Đơn hàng", payment: "Thanh toán", shipping: "Vận chuyển" }, LB = { order: ORD_ST, payment: PAY_ST, shipping: SHIP_ST };
  $("#view").innerHTML = `<p class="noprint"><a href="#/orders">← Danh sách đơn hàng</a></p><h1>Đơn ${esc(x.code)}</h1>
  <div class="grid"><div class="card"><h3>Khách hàng</h3><p><strong>${esc(x.recipient_name)}</strong><br><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>${x.email ? `<br><a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : ""}</p>
    <p>${esc(x.address_line)}${x.ward ? ", " + esc(x.ward) : ""}, ${esc(x.province)}</p>${x.note ? `<p><em>Ghi chú của khách:</em> ${esc(x.note)}</p>` : ""}
    <p class="hint">Đặt lúc ${esc(fmtDT(x.created_at))} · ngôn ngữ ${esc(x.lang)} · ${esc(PM[x.payment_method] || x.payment_method)}</p></div>
    ${statusCard("order", "Trạng thái đơn", ORD_ST, x.status, canW)}${statusCard("payment", "Thanh toán", PAY_ST, x.payment_status, canW)}${statusCard("shipping", "Vận chuyển", SHIP_ST, x.shipping_status, canW)}
    <div class="card noprint"><h3>Người phụ trách</h3><label><select id="o-assign" ${canW ? "" : "disabled"}>${dirOptions(d, x.assigned_to)}</select></label></div></div>
  <h2>Sản phẩm</h2><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên (lúc đặt)</th><th>Giá niêm yết</th><th>Đơn giá</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody>
  ${it.data.map((i) => `<tr><td>${esc(i.sku)}</td><td class="wrap">${esc(i.name)}</td><td>${Number(i.list_price) !== Number(i.unit_price) ? `<s>${vnd(i.list_price)}</s>` : vnd(i.list_price)}</td><td>${vnd(i.unit_price)}</td><td>${i.qty}</td><td>${vnd(i.line_total)}</td></tr>`).join("")}
  </tbody></table></div>
  <p style="text-align:right">Tiền hàng: <strong>${vnd(x.subtotal)}</strong> · VAT ${Number(x.vat_rate)}%: <strong>${vnd(x.vat_amount)}</strong> · Vận chuyển: <strong>${vnd(x.shipping_fee)}</strong><br>Tổng: <strong>${vnd(x.total)}</strong></p>
  <div class="grid"><div><h2>Ghi chú nội bộ</h2><ul class="lines">${nt.data.map((n) => `<li><small class="muted">${esc(fmtDT(n.at))} · ${esc(who(d, n.author))}</small><br>${esc(n.note)}</li>`).join("") || '<li class="muted">Chưa có.</li>'}</ul>
    ${canW ? '<label>Thêm ghi chú<textarea id="o-note" rows="3" maxlength="2000"></textarea></label><button class="btn" id="o-note-add">Lưu ghi chú</button>' : ""}</div>
   <div><h2>Lịch sử trạng thái</h2><ul class="lines">${hs.data.map((h) => `<li><small class="muted">${esc(fmtDT(h.at))} · ${esc(who(d, h.actor))}</small><br>${esc(KL[h.kind])}: ${h.from_status ? esc(LB[h.kind][h.from_status] || h.from_status) + " → " : ""}<strong>${esc(LB[h.kind][h.to_status] || h.to_status)}</strong></li>`).join("")}</ul></div></div>
  <div class="actions noprint"><button class="btn" id="o-print">In phiếu đơn hàng</button></div>`;
  const v = $("#view");
  $$("[data-apply]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const kind = b.dataset.apply, val = $(`[data-st="${kind}"]`, v).value;
    if (DANGER.has(val) && !confirm(`Chuyển sang “${LB[kind][val]}”? Thao tác này khó hoàn tác.`)) return;
    const r = await db().from("orders").update({ [COL[kind]]: val }).eq("id", id).select("id"); if (r.error) throw r.error;
    if (!r.data.length) throw new Error("Không cập nhật được (không có quyền hoặc đơn đã thay đổi — hãy tải lại).");
    toast("Đã cập nhật."); window.CMS.reload();
  })));
  $("#o-assign", v).addEventListener("change", async (e) => {
    const r = await db().from("orders").update({ assigned_to: e.target.value || null }).eq("id", id).select("id");
    if (r.error || !r.data.length) toast(r.error ? errMsg(r.error) : "Không có quyền phân công.", true); else toast("Đã phân công.");
  });
  $("#o-note-add", v)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const note = $("#o-note", v).value.trim(); if (!note) return;
    const r = await db().from("order_notes").insert({ order_id: id, author: S.user.id, note }); if (r.error) throw r.error; toast("Đã lưu ghi chú."); window.CMS.reload();
  }));
  $("#o-print", v).addEventListener("click", () => window.print());
}

// ================= BÁO GIÁ B2B =================
const QF = { q: "", status: "", assigned: "", from: "", to: "", page: 0 };
function quotesQuery(cols, count) {
  let q = db().from("quote_requests").select(cols, count ? { count: "exact" } : undefined).order("created_at", { ascending: false });
  if (QF.status) q = q.eq("status", QF.status);
  if (QF.assigned === "none") q = q.is("assigned_to", null); else if (QF.assigned) q = q.eq("assigned_to", QF.assigned);
  if (QF.from) q = q.gte("created_at", dayStart(QF.from)); if (QF.to) q = q.lte("created_at", dayEnd(QF.to));
  const s = safeQ(QF.q); if (s) q = q.or(`code.ilike.%${s}%,company.ilike.%${s}%,contact_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
  return q;
}
async function viewQuotes(arg) { return arg ? quoteDetail(arg) : quoteList(); }
async function quoteList() {
  const d = await dir();
  const { data, count, error } = await quotesQuery("id,code,created_at,company,contact_name,phone,status,assigned_to,quote_request_items(count)", true).range(QF.page * PAGE, QF.page * PAGE + PAGE - 1);
  if (error) throw error;
  const rows = data.map((r) => `<tr class="row" data-id="${r.id}"><td><strong>${esc(r.code)}</strong></td><td>${esc(fmtDT(r.created_at))}</td><td class="wrap">${esc(r.company)}<br><small class="muted">${esc(r.contact_name)} · ${esc(r.phone)}</small></td>
    <td>${r.quote_request_items?.[0]?.count ?? 0}</td><td>${bd(QT_ST, r.status, r.status === "new" ? "warn" : r.status === "won" ? "ok" : r.status === "failed" ? "bad" : "")}</td><td>${esc(who(d, r.assigned_to))}</td></tr>`).join("");
  const stOpt = [["", "Tất cả"], ...Object.entries(QT_ST)].map(([k, t]) => `<option value="${k}" ${k === QF.status ? "selected" : ""}>${esc(t)}</option>`).join("");
  const asOpt = [["", "Tất cả"], ["none", "Chưa phân công"], ...Object.values(d).map((x) => [x.user_id, x.display_name])].map(([k, t]) => `<option value="${esc(k)}" ${k === QF.assigned ? "selected" : ""}>${esc(t)}</option>`).join("");
  $("#view").innerHTML = `<h1>Yêu cầu báo giá <span class="muted">(${count ?? 0})</span></h1>
  <div class="toolbar"><label>Tìm (mã / công ty / liên hệ)<input id="qf-q" value="${esc(QF.q)}" placeholder="Nhập rồi Enter"></label><label>Trạng thái<select id="qf-status">${stOpt}</select></label>
   <label>Người phụ trách<select id="qf-as">${asOpt}</select></label><label>Từ ngày<input type="date" id="qf-from" value="${esc(QF.from)}"></label><label>Đến ngày<input type="date" id="qf-to" value="${esc(QF.to)}"></label>
   ${can("export.data") ? '<button class="btn fix" id="qf-csv">Xuất CSV</button>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày gửi</th><th>Công ty / liên hệ</th><th>SP</th><th>Trạng thái</th><th>Phụ trách</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">Chưa có yêu cầu báo giá.</td></tr>'}</tbody></table></div>${pager(QF.page, count || 0)}`;
  const v = $("#view"), bind = (id, k) => $(id, v).addEventListener("change", (e) => { QF[k] = e.target.value; QF.page = 0; window.CMS.reload(); });
  $("#qf-q", v).addEventListener("keydown", (e) => { if (e.key === "Enter") { QF.q = e.target.value.trim(); QF.page = 0; window.CMS.reload(); } });
  bind("#qf-status", "status"); bind("#qf-as", "assigned"); bind("#qf-from", "from"); bind("#qf-to", "to");
  $$("[data-pg]", v).forEach((b) => b.addEventListener("click", () => { QF.page += Number(b.dataset.pg); window.CMS.reload(); }));
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => (location.hash = "#/quotes/" + r.dataset.id)));
  $("#qf-csv", v)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const all = await fetchAll(() => quotesQuery("code,created_at,company,contact_name,phone,email,tax_code,delivery_area,expected_time,message,status,assigned_to,quote_request_items(name,sku,qty,unit)"));
    csvDownload(`bao-gia-${new Date().toISOString().slice(0, 10)}.csv`, ["Mã", "Ngày gửi", "Công ty", "Người liên hệ", "SĐT", "Email", "MST", "Khu vực giao", "Dự kiến mua", "Nội dung", "Trạng thái", "Phụ trách", "Sản phẩm"],
      all.map((r) => [r.code, fmtDT(r.created_at), r.company, r.contact_name, r.phone, r.email, r.tax_code, r.delivery_area, r.expected_time, r.message, QT_ST[r.status], who(d, r.assigned_to), (r.quote_request_items || []).map((i) => `${i.name}${i.sku ? " [" + i.sku + "]" : ""} x${i.qty}${i.unit ? " " + i.unit : ""}`).join("; ")]));
    toast(`Đã xuất ${all.length} yêu cầu.`);
  }));
}
async function quoteDetail(id) {
  const [d, q, it, ac] = await Promise.all([dir(), db().from("quote_requests").select("*").eq("id", id).maybeSingle(),
    db().from("quote_request_items").select("*").eq("quote_id", id).order("id"), db().from("quote_activities").select("*").eq("quote_id", id).order("at").order("id")]);
  for (const r of [q, it, ac]) if (r.error) throw r.error;
  if (!q.data) { $("#view").innerHTML = '<h1>Không tìm thấy yêu cầu</h1><p><a href="#/quotes">← Danh sách</a></p>'; return; }
  const x = q.data, canW = can("quotes.write"), AT = { note: "Ghi chú nội bộ", contact: "Đã liên hệ khách", status: "Đổi trạng thái", assign: "Phân công" };
  $("#view").innerHTML = `<p><a href="#/quotes">← Danh sách báo giá</a></p><h1>Yêu cầu ${esc(x.code)}</h1>
  <div class="grid"><div class="card"><h3>Khách hàng</h3><p><strong>${esc(x.company)}</strong><br>${esc(x.contact_name)}<br><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a><br><a href="mailto:${esc(x.email)}">${esc(x.email)}</a></p>
    ${x.tax_code ? `<p>MST: ${esc(x.tax_code)}</p>` : ""}${x.delivery_area ? `<p>Khu vực giao: ${esc(x.delivery_area)}</p>` : ""}${x.expected_time ? `<p>Dự kiến mua: ${esc(x.expected_time)}</p>` : ""}
    <p class="hint">Gửi lúc ${esc(fmtDT(x.created_at))} · ngôn ngữ ${esc(x.lang)}${x.source ? " · từ " + esc(x.source) : ""}</p></div>
   ${statusCard("quote", "Trạng thái", QT_ST, x.status, canW)}
   <div class="card"><h3>Người phụ trách</h3><label><select id="q-assign" ${canW ? "" : "disabled"}>${dirOptions(d, x.assigned_to)}</select></label></div></div>
  ${x.message ? `<h2>Nội dung yêu cầu</h2><div class="card">${esc(x.message).replace(/\n/g, "<br>")}</div>` : ""}
  <h2>Sản phẩm cần báo giá</h2><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Tên</th><th>Số lượng</th><th>Đơn vị</th></tr></thead><tbody>
  ${it.data.map((i) => `<tr><td>${esc(i.sku || "—")}</td><td class="wrap">${esc(i.name)}</td><td>${i.qty}</td><td>${esc(i.unit || "")}</td></tr>`).join("")}</tbody></table></div>
  <p class="hint">Yêu cầu báo giá KHÔNG tự trở thành đơn hàng. Giá buôn do nhân viên lập và gửi riêng cho khách.</p>
  <h2>Lịch sử xử lý</h2><ul class="lines">${ac.data.map((a) => `<li><small class="muted">${esc(fmtDT(a.at))} · ${esc(who(d, a.actor))}</small><br><strong>${esc(AT[a.type] || a.type)}</strong>${a.type === "status" ? `: ${a.from_status ? esc(QT_ST[a.from_status]) + " → " : ""}${esc(QT_ST[a.to_status] || a.to_status)}` : a.type === "assign" ? `: ${esc(a.note === "unassigned" ? "bỏ phân công" : who(d, a.note))}` : a.note ? ": " + esc(a.note) : ""}</li>`).join("")}</ul>
  ${canW ? `<div class="card"><label>Ghi chú / nội dung đã trao đổi<textarea id="q-note" rows="3" maxlength="2000"></textarea></label><button class="btn" data-addact="note">Lưu ghi chú nội bộ</button> <button class="btn" data-addact="contact">Ghi nhận đã liên hệ khách</button></div>` : ""}`;
  const v = $("#view");
  $$("[data-apply]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const val = $('[data-st="quote"]', v).value;
    if (DANGER.has(val) && !confirm(`Chuyển sang “${QT_ST[val]}”?`)) return;
    const r = await db().from("quote_requests").update({ status: val }).eq("id", id).select("id"); if (r.error) throw r.error;
    if (!r.data.length) throw new Error("Không cập nhật được (không có quyền hoặc dữ liệu đã thay đổi — hãy tải lại)."); toast("Đã cập nhật."); window.CMS.reload();
  })));
  $("#q-assign", v).addEventListener("change", async (e) => {
    const r = await db().from("quote_requests").update({ assigned_to: e.target.value || null }).eq("id", id).select("id");
    if (r.error || !r.data.length) toast(r.error ? errMsg(r.error) : "Không có quyền phân công.", true); else { toast("Đã phân công."); window.CMS.reload(); }
  });
  $$("[data-addact]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const note = $("#q-note", v).value.trim(); if (!note) return toast("Hãy nhập nội dung.", true);
    const r = await db().from("quote_activities").insert({ quote_id: id, actor: S.user.id, type: b.dataset.addact, note }); if (r.error) throw r.error; toast("Đã lưu."); window.CMS.reload();
  })));
}

// ================= LIÊN HỆ =================
let CF = "";
async function viewContacts() {
  let q = db().from("contact_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (CF) q = q.eq("status", CF);
  const { data, error } = await q; if (error) throw error;
  const canW = can("contacts.write");
  $("#view").innerHTML = `<h1>Liên hệ từ website</h1><div class="toolbar"><label>Trạng thái<select id="cf"><option value="">Tất cả</option><option value="new" ${CF === "new" ? "selected" : ""}>Mới</option><option value="handled" ${CF === "handled" ? "selected" : ""}>Đã xử lý</option></select></label></div>
  <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người gửi</th><th>Nội dung</th><th>Trạng thái</th></tr></thead><tbody>
  ${data.map((c) => `<tr><td>${esc(fmtDT(c.created_at))}</td><td class="wrap">${esc(c.name)}<br><small>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""} ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}</small></td><td class="wrap">${esc(c.message).replace(/\n/g, "<br>")}</td>
   <td>${c.status === "new" ? '<span class="badge warn">Mới</span>' : '<span class="badge ok">Đã xử lý</span>'}${canW ? `<br><button class="btn" data-ct="${c.id}" data-to="${c.status === "new" ? "handled" : "new"}">${c.status === "new" ? "Đánh dấu đã xử lý" : "Mở lại"}</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Chưa có liên hệ.</td></tr>'}</tbody></table></div>`;
  const v = $("#view");
  $("#cf", v).addEventListener("change", (e) => { CF = e.target.value; window.CMS.reload(); });
  $$("[data-ct]", v).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const r = await db().from("contact_requests").update({ status: b.dataset.to }).eq("id", Number(b.dataset.ct)).select("id"); if (r.error) throw r.error;
    if (!r.data.length) throw new Error("Không có quyền cập nhật."); window.CMS.reload();
  })));
}

// ================= CÀI ĐẶT =================
const SET_FIELDS = [["company_name", "Tên công ty / thương hiệu", "text"], ["hotline", "Hotline", "text"], ["contact_email", "Email liên hệ", "email"], ["address", "Địa chỉ", "text"], ["working_hours", "Giờ làm việc", "text"],
  ["vat_rate", "Thuế suất VAT (%) — giá niêm yết CHƯA gồm VAT", "number"], ["pay_cod_enabled", "Bật thanh toán khi nhận hàng (COD)", "bool"],
  ["bank_name", "Ngân hàng", "text"], ["bank_account", "Số tài khoản", "text"], ["bank_holder", "Chủ tài khoản", "text"], ["bank_note", "Nội dung chuyển khoản hướng dẫn khách", "text"]];
async function viewSettings() {
  const [s, sh] = await Promise.all([db().from("site_settings").select("key,value"), db().from("shipping_rules").select("*").order("province", { nullsFirst: true })]);
  for (const r of [s, sh]) if (r.error) throw r.error;
  const cur = Object.fromEntries(s.data.map((r) => [r.key, r.value])), canW = can("settings.write");
  const f = ([k, label, type]) => type === "bool" ? `<div>${chk(k, label, cur[k] === true || cur[k] === "true")}</div>` : inp(k, label, cur[k] ?? "", type === "number" ? 'type="number" min="0" max="100" step="0.01"' : type === "email" ? 'type="email"' : "");
  $("#view").innerHTML = `<h1>Cài đặt</h1><form id="set-form" class="card"><h2>Thông tin doanh nghiệp</h2><div class="form-grid">${SET_FIELDS.slice(0, 5).map(f).join("")}</div>
  <h2>Thuế & thanh toán</h2><div class="form-grid">${SET_FIELDS.slice(5).map(f).join("")}</div>
  <p class="hint">Chuyển khoản chỉ hiện ở checkout khi điền ĐỦ ngân hàng + số tài khoản + chủ tài khoản. Phương thức chưa bật sẽ không hiển thị và server từ chối nhận.</p>
  <div class="actions">${canW ? '<button class="btn primary" type="submit">Lưu cài đặt</button>' : '<span class="muted">Chỉ xem</span>'}</div></form>
  <h2>Phí vận chuyển</h2><p class="hint">Quy tắc không ghi tỉnh/thành = mặc định. Tên tỉnh/thành phải khớp (không phân biệt hoa thường) với tên khách nhập khi đặt hàng. Không có quy tắc nào = phí 0.</p>
  <div class="toolbar">${canW ? '<button class="btn primary fix" id="sh-new">+ Thêm quy tắc</button>' : ""}</div>
  <div class="table-wrap"><table><thead><tr><th>Tỉnh/Thành</th><th>Phí</th><th>Miễn phí từ (tiền hàng chưa VAT)</th><th>Áp dụng</th></tr></thead><tbody>
  ${sh.data.map((r) => `<tr class="row" data-id="${r.id}"><td>${r.province ? esc(r.province) : "<em>Mặc định</em>"}</td><td>${vnd(r.fee)}</td><td>${r.free_over == null ? "—" : vnd(r.free_over)}</td><td>${r.active ? "✓" : "—"}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Chưa có quy tắc.</td></tr>'}</tbody></table></div>`;
  const v = $("#view"), form = $("#set-form", v);
  if (!canW) $$("input", form).forEach((x) => (x.disabled = true));
  form.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", form), async () => {
    const rows = [], empty = [];
    for (const [k, , type] of SET_FIELDS) {
      const el = g(form, k);
      if (type === "bool") rows.push({ key: k, value: el.checked, is_public: true });
      else if (type === "number") { const n = el.value === "" ? null : Number(el.value); if (n == null || !(n >= 0 && n <= 100)) throw new Error("Thuế suất VAT phải từ 0 đến 100."); rows.push({ key: k, value: n, is_public: true }); }
      else if (el.value.trim()) rows.push({ key: k, value: el.value.trim(), is_public: true }); else empty.push(k);
    }
    const r = await db().from("site_settings").upsert(rows, { onConflict: "key" }); if (r.error) throw r.error;
    if (empty.length) { const d = await db().from("site_settings").delete().in("key", empty); if (d.error) throw d.error; }
    toast("Đã lưu. Website cập nhật trong tối đa 1 phút.");
  }); });
  $("#sh-new", v)?.addEventListener("click", () => shipModal(null, sh.data));
  $$("tr.row", v).forEach((r) => r.addEventListener("click", () => shipModal(sh.data.find((x) => x.id === Number(r.dataset.id)), sh.data)));
}
function shipModal(row, all) {
  const canW = can("settings.write"), r = row || { active: true, fee: 0 };
  const m = openModal(`<form id="shform"><h2>${row ? "Sửa" : "Thêm"} quy tắc vận chuyển</h2><div class="form-grid">
    ${inp("province", "Tỉnh/Thành phố (để trống = mặc định)", r.province || "", "maxlength=100")}${inp("fee", "Phí vận chuyển (VND) *", r.fee, 'type="number" min="0" step="1" required')}
    ${inp("free_over", "Miễn phí khi tiền hàng từ (VND, trống = không miễn phí)", r.free_over ?? "", 'type="number" min="1" step="1"')}<div>${chk("active", "Đang áp dụng", r.active)}</div></div>
    <div class="actions"><button class="btn primary" type="submit" ${canW ? "" : "disabled"}>Lưu</button><button class="btn" type="button" id="sh-cancel">Đóng</button>${row && canW ? '<button class="btn danger" type="button" id="sh-del">Xoá</button>' : ""}</div></form>`);
  const f = $("#shform", m); if (!canW) $$("input", f).forEach((x) => (x.disabled = true));
  $("#sh-cancel", m).addEventListener("click", closeModal);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); busy($("button[type=submit]", f), async () => {
    const body = { province: g(f, "province").value.trim() || null, fee: numOrNull(g(f, "fee").value), free_over: numOrNull(g(f, "free_over").value), active: g(f, "active").checked };
    if (body.fee == null || body.fee < 0 || !Number.isInteger(body.fee)) throw new Error("Phí phải là số nguyên VND không âm.");
    const res = row ? await db().from("shipping_rules").update(body).eq("id", row.id) : await db().from("shipping_rules").insert(body);
    if (res.error) throw res.error; closeModal(); toast("Đã lưu."); window.CMS.reload();
  }); });
  $("#sh-del", m)?.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    if (!confirm("Xoá quy tắc này?")) return; const d = await db().from("shipping_rules").delete().eq("id", row.id); if (d.error) throw d.error; closeModal(); toast("Đã xoá."); window.CMS.reload();
  }));
}

window.CMS.register({ key: "orders", title: "Đơn hàng", perm: "orders.read", view: viewOrders });
window.CMS.register({ key: "quotes", title: "Báo giá B2B", perm: "quotes.read", view: viewQuotes });
window.CMS.register({ key: "contacts", title: "Liên hệ", perm: "contacts.read", view: viewContacts });
window.CMS.register({ key: "settings", title: "Cài đặt", perm: "settings.write", view: viewSettings, after: true });
})();
