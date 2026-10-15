import { rest } from "./db.js";
import { qsSafe } from "./util.js";

const PSEL = "id,sku,price,sale_price,sale_start,sale_end,retail_enabled,featured,is_new,unit,category_id,brand_id,product_translations!inner(lang,slug,name,short_desc),product_images(path,is_primary,sort,alt_vi,alt_en)";

// Chỉ trả SP đã xuất bản (RLS) và có bản dịch ĐÃ XUẤT BẢN ở đúng ngôn ngữ (inner join).
export async function listProducts(env, lang, o = {}) {
  const p = new URLSearchParams();
  p.set("select", PSEL); p.set("product_translations.lang", `eq.${lang}`);
  if (o.catIds?.length) p.set("category_id", `in.(${o.catIds.join(",")})`);
  if (o.brandId) p.set("brand_id", `eq.${Number(o.brandId)}`);
  if (Number.isFinite(o.min)) p.append("price", `gte.${Math.floor(o.min)}`);
  if (Number.isFinite(o.max)) p.append("price", `lte.${Math.floor(o.max)}`);
  if (o.featured) p.set("featured", "eq.true");
  if (o.isNew) p.set("is_new", "eq.true");
  if (o.excludeId) p.append("id", `neq.${Number(o.excludeId)}`);
  const q = qsSafe(o.q);
  if (q) {
    const enc = encodeURIComponent(q);
    const [a, b] = await Promise.all([
      rest(env, `product_translations?select=product_id&lang=eq.${lang}&name=ilike.*${enc}*&limit=300`),
      rest(env, `products?select=id&sku=ilike.*${enc}*&limit=300`)
    ]);
    const ids = [...new Set([...a.data.map((x) => x.product_id), ...b.data.map((x) => x.id)])];
    if (!ids.length) return { items: [], total: 0 };
    p.append("id", `in.(${ids.join(",")})`);
  }
  p.set("order", { price_asc: "price.asc.nullslast,id.desc", price_desc: "price.desc.nullslast,id.desc" }[o.sort] || "id.desc");
  const limit = o.limit || 24; p.set("limit", String(limit)); p.set("offset", String(((o.page || 1) - 1) * limit));
  const { data, total } = await rest(env, `products?${p}`, { count: true });
  return { items: data, total: total ?? data.length };
}

export async function getProduct(env, lang, slug) {
  const p = new URLSearchParams({
    select: "product_id,lang,slug,name,short_desc,description,features,shipping_info,seo_title,seo_description,products!inner(id,sku,price,sale_price,sale_start,sale_end,retail_enabled,unit,package_info,category_id,brand_id,attrs,product_images(path,is_primary,sort,alt_vi,alt_en))",
    lang: `eq.${lang}`, slug: `eq.${slug}`, limit: "1"
  });
  const { data } = await rest(env, `product_translations?${p}`);
  const row = data[0]; if (!row) return null;
  const prod = row.products, [alts, defs] = await Promise.all([
    rest(env, `product_translations?select=lang,slug&product_id=eq.${prod.id}`),
    rest(env, `attribute_defs?select=code,value_type,unit,label_vi,label_en,sort&or=(category_id.is.null,category_id.eq.${prod.category_id ?? 0})&order=sort.asc,id.asc`)
  ]);
  return { t: row, p: prod, alts: Object.fromEntries(alts.data.map((a) => [a.lang, a.slug])), defs: defs.data };
}

export async function suggest(env, lang, q) {
  const { items } = await listProducts(env, lang, { q, limit: 8 });
  return items.map((x) => ({ id: x.id, sku: x.sku, name: x.product_translations[0].name }));
}

// ---- Nội dung (trang / tin tức / dịch vụ / chính sách) ----
const CSEL = "item_id,lang,slug,title,excerpt,content_items!inner(kind,cover_path,author_name,post_category_id,created_at,publish_at,sort)";
export async function listContent(env, lang, kind, { catId, page = 1, limit = 12 } = {}) {
  const p = new URLSearchParams({ select: CSEL, lang: `eq.${lang}`, "content_items.kind": `eq.${kind}`, limit: String(limit), offset: String((page - 1) * limit) });
  if (catId) p.set("content_items.post_category_id", `eq.${Number(catId)}`);
  p.set("order", kind === "post" ? "content_items(created_at).desc" : "content_items(sort).asc");
  const { data, total } = await rest(env, `content_translations?${p}`, { count: true });
  return { items: data, total: total ?? data.length };
}
export async function getContent(env, lang, kind, slug) {
  const p = new URLSearchParams({
    select: "item_id,lang,slug,title,excerpt,body,seo_title,seo_description,content_items!inner(kind,cover_path,author_name,post_category_id,created_at,publish_at)",
    lang: `eq.${lang}`, slug: `eq.${slug}`, "content_items.kind": `eq.${kind}`, limit: "1"
  });
  const { data } = await rest(env, `content_translations?${p}`);
  const row = data[0]; if (!row) return null;
  const alts = await rest(env, `content_translations?select=lang,slug&item_id=eq.${row.item_id}`);
  return { t: row, item: row.content_items, alts: Object.fromEntries(alts.data.map((a) => [a.lang, a.slug])) };
}
