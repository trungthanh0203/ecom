// Truy cập Supabase PostgREST từ Worker. anon = chỉ đọc dữ liệu công khai (RLS); service = chỉ cho RPC nghiệp vụ.
export class DbError extends Error { constructor(status, body) { super(body?.message || "DB error"); this.status = status; this.body = body; } }

export async function rest(env, path, { key = "anon", method = "GET", body, count = false, headers = {} } = {}) {
  const k = key === "service" ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!k) throw new DbError(500, { message: key === "service" ? "MISSING_SERVICE_ROLE_KEY" : "MISSING_ANON_KEY" });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", ...(count ? { Prefer: "count=exact" } : {}), ...headers }
  });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) throw new DbError(res.status, data);
  let total = null; const cr = res.headers.get("content-range");
  if (cr && cr.includes("/")) { const t = cr.split("/")[1]; total = t === "*" ? null : Number(t); }
  return { data, total };
}
export const rpc = (env, name, args) => rest(env, `rpc/${name}`, { key: "service", method: "POST", body: args }).then((r) => r.data);

// Cache nhỏ trong isolate cho dữ liệu ít đổi (danh mục, thương hiệu, cài đặt) — tối đa 60 giây.
let REFS = null, REFS_AT = 0;
export async function getRefs(env) {
  if (REFS && Date.now() - REFS_AT < 60000) return REFS;
  const [c, b, s, sh] = await Promise.all([
    rest(env, "categories?select=id,parent_id,sort,image_path,category_translations(lang,slug,name,description,seo_title,seo_description)&order=sort.asc,id.asc"),
    rest(env, "brands?select=id,sort,logo_path,website,brand_translations(lang,slug,name,description)&order=sort.asc,id.asc"),
    rest(env, "site_settings?select=key,value"),
    rest(env, "shipping_rules?select=province,fee,free_over")
  ]);
  const settings = Object.fromEntries(s.data.map((r) => [r.key, r.value]));
  const cats = c.data.map((x) => ({ ...x, tr: Object.fromEntries((x.category_translations || []).map((t) => [t.lang, t])) }));
  const brands = b.data.map((x) => ({ ...x, tr: Object.fromEntries((x.brand_translations || []).map((t) => [t.lang, t])) }));
  REFS = { cats, brands, settings, shipping: sh.data }; REFS_AT = Date.now();
  return REFS;
}
export const descendants = (cats, id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parent_id === out[i] && !out.includes(c.id)) out.push(c.id); return out; };
