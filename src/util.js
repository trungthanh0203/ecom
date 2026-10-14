export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const vnd = (n) => (n == null ? "" : new Intl.NumberFormat("vi-VN").format(n) + " ₫");
export const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\u003c")}</script>`;
export const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";

// Giá hiệu lực — PHẢI khớp logic trong DB (cart_quote): KM chỉ khi đang trong thời hạn.
export function priceInfo(p, now = Date.now()) {
  if (p.price == null) return { list: null, current: null, onSale: false };
  const onSale = p.sale_price != null && p.sale_end && now < Date.parse(p.sale_end) && (!p.sale_start || now >= Date.parse(p.sale_start));
  return { list: Number(p.price), current: Number(onSale ? p.sale_price : p.price), onSale: !!onSale };
}
export const imgUrl = (env, path) => `${env.SUPABASE_URL}/storage/v1/object/public/media/${String(path).split("/").map(encodeURIComponent).join("/")}`;
export function mainImage(p) {
  const im = [...(p.product_images || [])].sort((a, b) => (b.is_primary - a.is_primary) || (a.sort - b.sort));
  return im[0] || null;
}
export const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
export const jsonRes = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
export const qsSafe = (s) => String(s || "").replace(/[,()%*\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
