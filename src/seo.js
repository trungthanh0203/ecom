import { rest, getRefs } from "./db.js";
import { u, productUrl, PATHS, contentUrl, listUrl } from "./i18n.js";
import { esc } from "./util.js";

export function robots(siteUrl) {
  return ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /quan-tri/",
    "Disallow: /vi/gio-hang/", "Disallow: /en/cart/", "Disallow: /vi/thanh-toan/", "Disallow: /en/checkout/",
    "Disallow: /vi/dat-hang-thanh-cong/", "Disallow: /en/order-confirmation/", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join("\n");
}

async function allPages(env, path) {
  const out = [];
  for (let off = 0; off < 10000; off += 1000) {
    const { data } = await rest(env, `${path}&limit=1000&offset=${off}`);
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}

export async function sitemap(env, siteUrl) {
  const refs = await getRefs(env), langs = (env.LANGS || "vi,en").split(",").map((x) => x.trim());
  const urls = [];   // {alts:{lang:path}}
  const add = (alts) => { if (Object.keys(alts).length) urls.push(alts); };
  add(Object.fromEntries(langs.map((l) => [l, `/${l}/`])));
  for (const k of ["products", "quote", "contact"]) add(Object.fromEntries(langs.map((l) => [l, u(l, k)])));
  const trs = await allPages(env, "product_translations?select=product_id,lang,slug&order=product_id.asc");
  const byProd = new Map(); for (const t of trs) { if (!byProd.has(t.product_id)) byProd.set(t.product_id, {}); byProd.get(t.product_id)[t.lang] = productUrl(t.lang, t.slug); }
  for (const alts of byProd.values()) add(alts);
  for (const c of refs.cats) add(Object.fromEntries(Object.entries(c.tr).map(([l, t]) => [l, u(l, "products", PATHS[l].category, t.slug)])));
  for (const b of refs.brands) add(Object.fromEntries(Object.entries(b.tr).map(([l, t]) => [l, u(l, "products", PATHS[l].brand, t.slug)])));
  const ct = await allPages(env, "content_translations?select=item_id,lang,slug,content_items!inner(kind)&order=item_id.asc");
  const byItem = new Map(), present = new Map();
  for (const t of ct) {
    const k = t.content_items.kind;
    if (!byItem.has(t.item_id)) byItem.set(t.item_id, {});
    byItem.get(t.item_id)[t.lang] = contentUrl(t.lang, k, t.slug);
    if (!present.has(k)) present.set(k, {});
    present.get(k)[t.lang] = listUrl(t.lang, k === "page" ? "post" : k);
  }
  for (const alts of byItem.values()) add(alts);
  for (const [k, alts] of present) if (k !== "page") add(alts);
  const body = urls.flatMap((alts) => Object.entries(alts).map(([l, p]) =>
    `<url><loc>${esc(siteUrl + p)}</loc>${Object.entries(alts).map(([l2, p2]) => `<xhtml:link rel="alternate" hreflang="${l2}" href="${esc(siteUrl + p2)}"/>`).join("")}${alts.vi ? `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(siteUrl + alts.vi)}"/>` : ""}</url>`)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;
}
