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

// Cache nhỏ trong isolate cho dữ liệu ít đổi (danh mục, thương hiệu, cài đặt, điều hướng nội dung) — tối đa 60 giây.
let REFS = null, REFS_AT = 0;
export async function getRefs(env) {
  if (REFS && Date.now() - REFS_AT < 60000) return REFS;
  const langs = (env.LANGS || "vi,en").split(",").map((x) => x.trim());
  const [c, b, s, sh, nav, pc, mn, hb, pres, cbr, ...posts] = await Promise.all([
    rest(env, "categories?select=id,parent_id,sort,image_path,category_translations(lang,slug,name,description,seo_title,seo_description)&order=sort.asc,id.asc"),
    rest(env, "brands?select=id,sort,logo_path,website,brand_translations(lang,slug,name,description)&order=sort.asc,id.asc"),
    rest(env, "site_settings?select=key,value"),
    rest(env, "shipping_rules?select=province,fee,free_over"),
    rest(env, "content_translations?select=lang,slug,title,content_items!inner(kind,sort)&content_items.kind=in.(page,policy,service)&order=content_items(sort).asc&limit=300"),
    rest(env, "post_categories?select=id,sort,post_category_translations(lang,slug,name)&order=sort.asc,id.asc"),
    rest(env, "menus?select=id,location,parent_id,sort,label_vi,label_en,url_vi,url_en&order=sort.asc,id.asc"),
    rest(env, "home_blocks?select=id,block_type,sort,payload&order=sort.asc,id.asc"),
    rest(env, "rpc/content_presence", { method: "POST", body: {} }).catch(() => null),   // 009 chưa chạy => null, vẫn hoạt động
    rest(env, "products?select=category_id,brand_id&status=eq.published&brand_id=not.is.null&category_id=not.is.null&limit=1000").catch(() => ({ data: [] })),   // gợi ý thương hiệu theo danh mục trong menu
    ...langs.map((l) => rest(env, `content_translations?select=slug,content_items!inner(kind)&lang=eq.${l}&content_items.kind=eq.post&limit=1`))
  ]);
  const settings = Object.fromEntries(s.data.map((r) => [r.key, r.value]));
  const cats = c.data.map((x) => ({ ...x, tr: Object.fromEntries((x.category_translations || []).map((t) => [t.lang, t])) }));
  const brands = b.data.map((x) => ({ ...x, tr: Object.fromEntries((x.brand_translations || []).map((t) => [t.lang, t])) }));
  const postCats = pc.data.map((x) => ({ ...x, tr: Object.fromEntries((x.post_category_translations || []).map((t) => [t.lang, t])) }));
  const byKind = (k) => nav.data.filter((r) => r.content_items.kind === k).map((r) => ({ lang: r.lang, slug: r.slug, title: r.title }));
  const has = {}; for (const r of (pres?.data || [])) { (has[r.kind] = has[r.kind] || {})[r.lang] = true; }
  const contentNav = { has, pages: byKind("page"), policies: byKind("policy"), services: byKind("service"), hasPosts: Object.fromEntries(langs.map((l, i) => [l, posts[i].data.length > 0])) };
  const catBrands = {}; for (const r of (cbr?.data || [])) (catBrands[r.category_id] = catBrands[r.category_id] || new Set()).add(r.brand_id);
  REFS = { catBrands, cats, brands, settings, shipping: sh.data, postCats, contentNav, menus: mn.data, homeBlocks: hb.data }; REFS_AT = Date.now();
  return REFS;
}
export const descendants = (cats, id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parent_id === out[i] && !out.includes(c.id)) out.push(c.id); return out; };
