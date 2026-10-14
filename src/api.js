import { rpc, DbError, getRefs } from "./db.js";
import { jsonRes, truthy } from "./util.js";
import { suggest } from "./catalog.js";

// Giới hạn tần suất theo isolate (best-effort, KHÔNG chia sẻ giữa các isolate/vùng).
// Lớp chống lạm dụng thật: Turnstile + (khuyến nghị) quy tắc Rate Limiting/WAF của Cloudflare + khoá idempotency trong DB.
const buckets = new Map();
function limited(ip, route, max, windowMs) {
  const now = Date.now(), k = `${route}|${ip}`; let b = buckets.get(k);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.n++;
  if (buckets.size > 5000) for (const [kk, v] of buckets) if (now > v.reset) buckets.delete(kk);
  return b.n > max;
}
const LIMITS = { "/api/cart/price": [120, 60000], "/api/checkout": [10, 600000], "/api/quote": [10, 600000], "/api/contact": [5, 600000], "/api/order-lookup": [20, 600000] };
const str = (v, n = 1000) => (typeof v === "string" ? v.slice(0, n) : undefined);
const opt = (v, n) => { const s = str(v, n); return s && s.trim() ? s : undefined; };

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return env.REQUIRE_TURNSTILE === "true" ? "MISCONFIG" : true;
  if (!token || typeof token !== "string") return false;
  const fd = new FormData(); fd.append("secret", env.TURNSTILE_SECRET); fd.append("response", token); if (ip) fd.append("remoteip", ip);
  try { const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd }); return !!(await r.json()).success; } catch { return false; }
}
const fail = (error, status, extra = {}) => jsonRes({ error, ...extra }, status);

export async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/$/, ""), ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (request.method === "GET" && path === "/api/suggest") {
    if (limited(ip, path, 60, 60000)) return fail("RATE", 429);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "vi", q = url.searchParams.get("q") || "";
    if (q.trim().length < 2) return jsonRes([], 200, { "cache-control": "public, max-age=60" });
    return jsonRes(await suggest(env, lang, q), 200, { "cache-control": "public, max-age=60" });
  }
  if (request.method !== "POST" || !LIMITS[path]) return fail("NOT_FOUND", 404);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== url.origin) return fail("ORIGIN", 403);
  if (limited(ip, path, ...LIMITS[path])) return fail("RATE", 429);
  const text = await request.text();
  if (text.length > 60000) return fail("TOO_LARGE", 413);
  let b; try { b = JSON.parse(text); } catch { return fail("BAD_JSON", 400); }
  if (!b || typeof b !== "object") return fail("BAD_JSON", 400);

  try {
    if (path === "/api/cart/price") {
      const lang = b.lang === "en" ? "en" : "vi";
      return jsonRes(await rpc(env, "cart_quote", { p_items: Array.isArray(b.items) ? b.items.slice(0, 100).map((i) => ({ product_id: i?.product_id, qty: i?.qty })) : null, p_lang: lang, p_province: opt(b.province, 100) ?? null }));
    }
    if (path === "/api/order-lookup") {
      const r = await rpc(env, "order_lookup", { p_code: str(b.code, 40) || "", p_phone: str(b.phone, 30) || "" });
      return r ? jsonRes(r) : fail("NOT_FOUND", 404);
    }
    // ----- các API ghi dữ liệu: chống bot -----
    const tv = await verifyTurnstile(env, b.turnstile_token, ip);
    if (tv === "MISCONFIG") return fail("GENERIC", 503);
    if (!tv) return fail("TURNSTILE", 422);
    if (typeof b.website === "string" && b.website.trim()) return jsonRes({ ok: true, hp: true });   // honeypot: giả vờ thành công, không ghi gì
    const lang = b.lang === "en" ? "en" : "vi";

    if (path === "/api/checkout") {
      const refs = await getRefs(env), s = refs.settings;
      const enabled = { cod: truthy(s.pay_cod_enabled), bank_transfer: !!(s.bank_name && s.bank_account && s.bank_holder) };
      if (!enabled[b.payment_method]) return fail("INVALID_PAYMENT_METHOD", 422);   // không nhận phương thức chưa được cấu hình
      const c = b.customer && typeof b.customer === "object" ? b.customer : {};
      const r = await rpc(env, "create_order", { p: {
        idempotency_key: str(b.idempotency_key, 100), consent: b.consent === true ? "true" : "false", payment_method: b.payment_method, lang, note: opt(b.note, 1000),
        customer: { name: str(c.name, 120), phone: str(c.phone, 20), email: opt(c.email, 200), province: str(c.province, 100), ward: opt(c.ward, 100), address: str(c.address, 300) },
        items: Array.isArray(b.items) ? b.items.slice(0, 101).map((i) => ({ product_id: i?.product_id, qty: i?.qty })) : null } });
      return jsonRes(r);
    }
    if (path === "/api/quote") {
      let source; try { source = new URL(request.headers.get("referer") || "").pathname.slice(0, 200); } catch { /* không có referer */ }
      const r = await rpc(env, "submit_quote", { p: {
        idempotency_key: str(b.idempotency_key, 100), consent: b.consent === true ? "true" : "false", lang, source,
        contact_name: str(b.contact_name, 120), company: str(b.company, 200), phone: str(b.phone, 20), email: str(b.email, 200), tax_code: opt(b.tax_code, 20),
        delivery_area: opt(b.delivery_area, 200), expected_time: opt(b.expected_time, 100), message: opt(b.message, 3000),
        items: Array.isArray(b.items) ? b.items.slice(0, 51).map((i) => ({ product_id: Number.isInteger(i?.product_id) ? i.product_id : undefined, name: opt(i?.name, 200), qty: i?.qty, unit: opt(i?.unit, 30) })) : null } });
      return jsonRes(r);
    }
    if (path === "/api/contact") {
      const r = await rpc(env, "submit_contact", { p: { name: str(b.name, 120), phone: opt(b.phone, 20), email: opt(b.email, 200), message: str(b.message, 3000), consent: b.consent === true ? "true" : "false", lang } });
      return jsonRes(r);
    }
  } catch (e) {
    if (e instanceof DbError && e.body?.code === "P0001") {
      let detail; try { detail = e.body.details ? JSON.parse(e.body.details) : undefined; } catch { /* không phải JSON */ }
      return fail(String(e.body.message).split(" ")[0], 422, detail ? { detail } : {});
    }
    console.error("api error", path, e?.message, e?.body?.code);
    return fail("GENERIC", 500);
  }
  return fail("NOT_FOUND", 404);
}
