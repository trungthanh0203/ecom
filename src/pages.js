import { esc, vnd, jsonLd, priceInfo, imgUrl, mainImage, truthy } from "./util.js";
import { u, productUrl, PATHS, contentUrl, listUrl } from "./i18n.js";
import { sanitize } from "./sanitize.js";
import { renderPage, productCard, breadcrumbs, breadcrumbLd, siteName } from "./layout.js";
import { listProducts, getProduct, listContent, getContent } from "./catalog.js";
import { descendants } from "./db.js";

const PER = 24;
const para = (t) => String(t || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("");
const staticAlts = (key) => ({ vi: u("vi", key), en: u("en", key) });
const catAvail = (ctx) => ctx.refs.cats.filter((c) => c.tr[ctx.lang] && c.tr[ctx.lang].slug);
const catHref = (lang, c) => u(lang, "products", PATHS[lang].category, c.tr[lang].slug);
const brandHref = (lang, b) => u(lang, "products", PATHS[lang].brand, b.tr[lang].slug);
const hp = '<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">';
const ts = (ctx) => (ctx.env.TURNSTILE_SITEKEY ? `<div class="cf-turnstile" data-sitekey="${esc(ctx.env.TURNSTILE_SITEKEY)}"></div>` : "");
const field = (label, input) => `<label>${esc(label)}${input}</label>`;

export function notFound(ctx) {
  const { T, lang } = ctx;
  return renderPage(ctx, { title: T.nf_title, path: ctx.url.pathname, noindex: true, status: 404, noStore: true,
    body: `<h1>${esc(T.nf_title)}</h1><p>${esc(T.nf_text)}</p><p><a class="btn" href="/${lang}/">${esc(T.home)}</a></p>` });
}

export async function home(ctx) {
  const { env, lang, T, refs, siteUrl } = ctx, s = refs.settings, name = siteName(ctx);
  const [feat, neu, news] = await Promise.all([listProducts(env, lang, { featured: true, limit: 8 }), listProducts(env, lang, { isNew: true, limit: 8 }), refs.contentNav.hasPosts[lang] ? listContent(env, lang, "post", { limit: 3 }) : { items: [] }]);
  const cats = catAvail(ctx).filter((c) => !c.parent_id), brands = refs.brands.filter((b) => b.tr[lang]);
  const section = (h, items) => items.length ? `<section><h2>${esc(h)}</h2><div class="grid">${items.map((p) => productCard(ctx, p)).join("")}</div></section>` : "";
  const org = { "@context": "https://schema.org", "@type": "Organization", name, url: siteUrl + "/" + lang + "/", ...(s.hotline ? { telephone: s.hotline } : {}), ...(s.contact_email ? { email: s.contact_email } : {}), ...(s.address ? { address: s.address } : {}) };
  return renderPage(ctx, { title: null, desc: T.hero_sub, path: `/${lang}/`, alternates: { vi: "/vi/", en: "/en/" }, jsonld: [jsonLd(org)],
    body: `<section class="hero"><h1>${esc(name)}</h1><p>${esc(T.hero_sub)}</p><p><a class="btn buy" href="${u(lang, "products")}">${esc(T.hero_cta)}</a> <a class="btn quote" href="${u(lang, "quote")}">${esc(T.hero_cta2)}</a></p></section>
${cats.length ? `<section><h2>${esc(T.h_cats)}</h2><ul class="tiles">${cats.map((c) => `<li><a class="card tile" href="${esc(catHref(lang, c))}">${c.image_path ? `<img src="${esc(imgUrl(env, c.image_path))}" alt="" loading="lazy">` : ""}<span>${esc(c.tr[lang].name)}</span></a></li>`).join("")}</ul></section>` : ""}
${section(T.h_featured, feat.items)}${section(T.h_new, neu.items)}
${news.items.length ? `<section><h2>${esc(T.h_latest_news)}</h2><div class="grid">${news.items.map((r) => contentCard(ctx, "post", r)).join("")}</div></section>` : ""}
${brands.length ? `<section><h2>${esc(T.h_brands)}</h2><ul class="brands">${brands.map((b) => `<li><a href="${esc(brandHref(lang, b))}">${b.logo_path ? `<img src="${esc(imgUrl(env, b.logo_path))}" alt="${esc(b.tr[lang].name)}" loading="lazy" height="40">` : esc(b.tr[lang].name)}</a></li>`).join("")}</ul></section>` : ""}
<section class="b2b card"><h2>${esc(T.b2b_title)}</h2><p>${esc(T.b2b_text)}</p><p><a class="btn quote" href="${u(lang, "quote")}">${esc(T.b2b_cta)}</a></p></section>` });
}

export async function productList(ctx, { catSlug, brandSlug }) {
  const { env, lang, T, refs, url } = ctx, qs = url.searchParams;
  const cat = catSlug ? refs.cats.find((c) => c.tr[lang]?.slug === catSlug) : null;
  const brand = brandSlug ? refs.brands.find((b) => b.tr[lang]?.slug === brandSlug) : null;
  if ((catSlug && !cat) || (brandSlug && !brand)) return null;
  const page = Math.max(1, parseInt(qs.get("page") || "1", 10) || 1), q = (qs.get("q") || "").trim();
  const min = qs.get("min") ? Number(qs.get("min")) : NaN, max = qs.get("max") ? Number(qs.get("max")) : NaN;
  const sort = ["price_asc", "price_desc"].includes(qs.get("sort")) ? qs.get("sort") : "";
  const { items, total } = await listProducts(env, lang, { catIds: cat ? descendants(refs.cats, cat.id) : null, brandId: brand?.id, q, min, max, sort, page, limit: PER });
  const base = cat ? u(lang, "products", PATHS[lang].category, cat.tr[lang].slug) : brand ? u(lang, "products", PATHS[lang].brand, brand.tr[lang].slug) : u(lang, "products");
  const keep = (extra = {}) => { const p = new URLSearchParams(); for (const k of ["q", "min", "max", "sort"]) if (qs.get(k)) p.set(k, qs.get(k)); for (const [k, v] of Object.entries(extra)) v ? p.set(k, v) : p.delete(k); const s = p.toString(); return base + (s ? "?" + s : ""); };
  const pages = Math.max(1, Math.ceil(total / PER)), filtered = !!(q || sort || Number.isFinite(min) || Number.isFinite(max));
  const heading = cat?.tr[lang].name || brand?.tr[lang].name || T.nav_products;
  const crumbs = [{ name: T.home, href: `/${lang}/` }, { name: T.nav_products, href: u(lang, "products") }, ...(cat || brand ? [{ name: heading, href: base }] : [])];
  const alts = {}; for (const l of ["vi", "en"]) { if (cat) { if (cat.tr[l]) alts[l] = u(l, "products", PATHS[l].category, cat.tr[l].slug); } else if (brand) { if (brand.tr[l]) alts[l] = u(l, "products", PATHS[l].brand, brand.tr[l].slug); } else alts[l] = u(l, "products"); }
  const tree = catAvail(ctx).filter((c) => !c.parent_id).map((c) => `<li><a href="${esc(catHref(lang, c))}"${cat?.id === c.id ? ' aria-current="true"' : ""}>${esc(c.tr[lang].name)}</a>${catAvail(ctx).some((k) => k.parent_id === c.id) ? `<ul>${catAvail(ctx).filter((k) => k.parent_id === c.id).map((k) => `<li><a href="${esc(catHref(lang, k))}">${esc(k.tr[lang].name)}</a></li>`).join("")}</ul>` : ""}</li>`).join("");
  const brandList = refs.brands.filter((b) => b.tr[lang]).map((b) => `<li><a href="${esc(brandHref(lang, b))}"${brand?.id === b.id ? ' aria-current="true"' : ""}>${esc(b.tr[lang].name)}</a></li>`).join("");
  const pager = pages > 1 ? `<nav class="pager" aria-label="pages">${page > 1 ? `<a class="btn" href="${esc(keep({ page: page > 2 ? String(page - 1) : "" }))}">${esc(T.prev)}</a>` : ""}<span>${esc(T.page)} ${page}/${pages}</span>${page < pages ? `<a class="btn" href="${esc(keep({ page: String(page + 1) }))}">${esc(T.next)}</a>` : ""}</nav>` : "";
  return renderPage(ctx, {
    title: heading, desc: cat?.tr[lang].seo_description || cat?.tr[lang].description || undefined, path: base, canonical: base + (page > 1 ? `?page=${page}` : ""), alternates: alts, noindex: filtered, jsonld: [breadcrumbLd(ctx, crumbs)],
    body: `${breadcrumbs(crumbs)}<h1>${esc(heading)} <small class="muted">(${total} ${esc(T.results)})</small></h1>
<div class="layout"><aside class="filters"><h2>${esc(T.filters)}</h2>
<form method="get" action="${esc(base)}">${q ? `<input type="hidden" name="q" value="${esc(q)}">` : ""}
${field(T.price_min, `<input type="number" name="min" min="0" step="1" value="${Number.isFinite(min) ? min : ""}">`)}${field(T.price_max, `<input type="number" name="max" min="0" step="1" value="${Number.isFinite(max) ? max : ""}">`)}
${field(T.sort, `<select name="sort"><option value="">${esc(T.sort_new)}</option><option value="price_asc"${sort === "price_asc" ? " selected" : ""}>${esc(T.sort_asc)}</option><option value="price_desc"${sort === "price_desc" ? " selected" : ""}>${esc(T.sort_desc)}</option></select>`)}
<button class="btn" type="submit">${esc(T.apply)}</button> <a href="${esc(base)}">${esc(T.reset)}</a></form>
<h3>${esc(T.category)}</h3><ul class="list"><li><a href="${u(lang, "products")}">${esc(T.all_cats)}</a></li>${tree}</ul>
${brandList ? `<h3>${esc(T.brand)}</h3><ul class="list"><li><a href="${u(lang, "products")}">${esc(T.all_brands)}</a></li>${brandList}</ul>` : ""}</aside>
<section>${items.length ? `<div class="grid">${items.map((p) => productCard(ctx, p)).join("")}</div>${pager}` : `<p>${esc(T.no_products)}</p>`}</section></div>` });
}

export async function productDetail(ctx, slug) {
  const { env, lang, T, refs, siteUrl } = ctx;
  const d = await getProduct(env, lang, slug); if (!d) return null;
  const { t, p, defs, alts } = d, pi = priceInfo(p), imgs = [...(p.product_images || [])].sort((a, b) => (b.is_primary - a.is_primary) || (a.sort - b.sort));
  const cat = refs.cats.find((c) => c.id === p.category_id), brand = refs.brands.find((b) => b.id === p.brand_id);
  const retail = p.retail_enabled && pi.current != null && pi.current > 0, path = productUrl(lang, t.slug);
  const crumbs = [{ name: T.home, href: `/${lang}/` }, { name: T.nav_products, href: u(lang, "products") }, ...(cat?.tr[lang] ? [{ name: cat.tr[lang].name, href: catHref(lang, cat) }] : []), { name: t.name, href: path }];
  const specRows = [
    ...defs.map((df) => { const v = p.attrs?.[df.code]; if (v === undefined || v === null || v === "") return null; const val = df.value_type === "boolean" ? (v ? "✓" : "—") : `${v}${df.unit ? " " + df.unit : ""}`; return [lang === "en" && df.label_en ? df.label_en : df.label_vi, val]; }).filter(Boolean),
    ...(p.unit ? [[T.unit, p.unit]] : []), ...(p.package_info ? [[T.package, p.package_info]] : [])
  ];
  const price = pi.current == null ? `<p class="price muted">${esc(T.call_price)}</p>` : `<p class="price big">${pi.onSale ? `<s>${esc(vnd(pi.list))}</s> ` : ""}<strong>${esc(vnd(pi.current))}</strong> <small>${esc(T.excl_vat)}</small>${pi.onSale ? ` <small class="muted">→ ${esc(new Date(p.sale_end).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB"))}</small>` : ""}</p>`;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: t.name, sku: p.sku, ...(t.short_desc ? { description: t.short_desc } : {}), ...(imgs.length ? { image: imgs.map((i) => imgUrl(env, i.path)) } : {}), ...(brand?.tr[lang] ? { brand: { "@type": "Brand", name: brand.tr[lang].name } } : {}),
    ...(pi.current != null && pi.current > 0 ? { offers: { "@type": "Offer", url: siteUrl + path, priceCurrency: "VND", price: pi.current, ...(pi.onSale ? { priceValidUntil: String(p.sale_end).slice(0, 10) } : {}), priceSpecification: { "@type": "PriceSpecification", price: pi.current, priceCurrency: "VND", valueAddedTaxIncluded: false } } } : {}) };
  const related = (await listProducts(env, lang, { catIds: p.category_id ? [p.category_id] : null, excludeId: p.id, limit: 4 })).items;
  const altPaths = Object.fromEntries(Object.entries(alts).map(([l, sl]) => [l, productUrl(l, sl)]));
  const gallery = imgs.length ? `<div class="gallery"><img id="main-img" src="${esc(imgUrl(env, imgs[0].path))}" alt="${esc((lang === "en" ? imgs[0].alt_en : imgs[0].alt_vi) || t.name)}" fetchpriority="high">${imgs.length > 1 ? `<ul class="thumbs">${imgs.map((i) => `<li><a href="${esc(imgUrl(env, i.path))}" data-thumb><img src="${esc(imgUrl(env, i.path))}" alt="${esc((lang === "en" ? i.alt_en : i.alt_vi) || "")}" loading="lazy" width="72" height="72"></a></li>`).join("")}</ul>` : ""}</div>` : '<div class="gallery"><span class="noimg big" aria-hidden="true"></span></div>';
  const det = (h, inner, open) => inner ? `<details${open ? " open" : ""}><summary>${esc(h)}</summary><div class="rich">${inner}</div></details>` : "";
  return renderPage(ctx, {
    title: t.seo_title || t.name, desc: t.seo_description || t.short_desc || undefined, path, alternates: altPaths, ogType: "product", ogImage: imgs[0] ? imgUrl(env, imgs[0].path) : undefined, jsonld: [jsonLd(ld), breadcrumbLd(ctx, crumbs)],
    body: `${breadcrumbs(crumbs)}<div class="detail">${gallery}<div><h1>${esc(t.name)}</h1>
<p class="muted">${esc(T.sku)}: <strong>${esc(p.sku)}</strong>${brand?.tr[lang] ? ` · ${esc(T.brand)}: <a href="${esc(brandHref(lang, brand))}">${esc(brand.tr[lang].name)}</a>` : ""}${cat?.tr[lang] ? ` · ${esc(T.category)}: <a href="${esc(catHref(lang, cat))}">${esc(cat.tr[lang].name)}</a>` : ""}</p>
${t.short_desc ? `<p>${esc(t.short_desc)}</p>` : ""}${price}
${retail ? `<div class="buyrow"><label>${esc(T.qty)} <input type="number" id="qty" min="1" max="999" value="1" inputmode="numeric"></label><button type="button" class="btn buy" data-add="${p.id}" data-qty-input="#qty">${esc(T.add_to_cart)}</button></div>` : `<p class="muted">${pi.current == null ? "" : esc(T.not_retail)}</p>`}
<p><a class="btn quote" href="${esc(u(lang, "quote") + "?sp=" + encodeURIComponent(p.sku))}">${esc(T.quote_btn)}</a></p></div></div>
<div class="tabs">${det(T.t_desc, para(t.description), true)}${det(T.t_specs, specRows.length ? `<table class="specs"><tbody>${specRows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : "", true)}${det(T.t_features, para(t.features))}${det(T.t_ship, para(t.shipping_info))}</div>
${related.length ? `<section><h2>${esc(T.related)}</h2><div class="grid">${related.map((x) => productCard(ctx, x)).join("")}</div></section>` : ""}` });
}

export function cartPage(ctx) {
  const { T, lang } = ctx;
  return renderPage(ctx, { title: T.cart_title, path: u(lang, "cart"), alternates: staticAlts("cart"), noindex: true, noStore: true,
    body: `<h1>${esc(T.cart_title)}</h1><div id="cart-root" aria-live="polite"><p class="muted">…</p></div>` });
}

export function checkoutPage(ctx) {
  const { T, lang, refs } = ctx, s = refs.settings;
  const cod = truthy(s.pay_cod_enabled), bank = !!(s.bank_name && s.bank_account && s.bank_holder);
  const provinces = [...new Set(refs.shipping.map((r) => r.province).filter(Boolean))];
  const pays = [cod && `<label class="chk"><input type="radio" name="payment_method" value="cod" required> ${esc(T.ck_cod)}</label>`, bank && `<label class="chk"><input type="radio" name="payment_method" value="bank_transfer" required> ${esc(T.ck_bank)}</label>`].filter(Boolean);
  return renderPage(ctx, { title: T.ck_title, path: u(lang, "checkout"), alternates: staticAlts("checkout"), noindex: true, noStore: true, forms: true,
    body: `<h1>${esc(T.ck_title)}</h1><div class="two"><form id="checkout-form" novalidate>
${field(T.ck_name, '<input name="name" autocomplete="name" required maxlength="120">')}${field(T.ck_phone, '<input name="phone" type="tel" autocomplete="tel" required maxlength="20">')}${field(T.ck_email, '<input name="email" type="email" autocomplete="email" maxlength="200">')}
${field(T.ck_province, `<input name="province" list="provinces" autocomplete="address-level1" required maxlength="100">${provinces.length ? `<datalist id="provinces">${provinces.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : ""}`)}
${field(T.ck_ward, '<input name="ward" autocomplete="address-level2" maxlength="100">')}${field(T.ck_address, '<input name="address" autocomplete="street-address" required maxlength="300">')}${field(T.ck_note, '<textarea name="note" rows="3" maxlength="1000"></textarea>')}
<fieldset><legend>${esc(T.ck_pay)}</legend>${pays.length ? pays.join("") : `<p class="error">${esc(T.ck_no_pay)}</p>`}</fieldset>
<label class="chk"><input type="checkbox" name="consent" required> ${esc(T.ck_consent)}</label>${hp}${ts(ctx)}
<p id="form-msg" class="error" role="alert" hidden></p><button class="btn buy" type="submit"${pays.length ? "" : " disabled"}>${esc(T.ck_submit)}</button></form>
<aside class="card" id="checkout-summary" aria-live="polite"></aside></div>` });
}

export function confirmPage(ctx) {
  const { T, lang, refs } = ctx, s = refs.settings;
  const bank = s.bank_name && s.bank_account && s.bank_holder ? `<div id="bank-box" class="card" hidden><h2>${esc(T.cf_bank_title)}</h2><p>${esc(s.bank_name)}<br>${esc(s.bank_holder)}<br><strong>${esc(s.bank_account)}</strong></p>${s.bank_note ? `<p>${esc(s.bank_note)}</p>` : ""}</div>` : "";
  return renderPage(ctx, { title: T.cf_title, path: u(lang, "confirm"), alternates: staticAlts("confirm"), noindex: true, noStore: true,
    body: `<h1>${esc(T.cf_title)}</h1><div id="confirm-root" aria-live="polite"><p class="muted">…</p></div>${bank}<p><a class="btn" href="${u(lang, "products")}">${esc(T.continue)}</a></p>` });
}

export async function quotePage(ctx) {
  const { T, lang, env } = ctx, sp = (ctx.url.searchParams.get("sp") || "").trim().slice(0, 60);
  let pre = null;
  if (sp) { const { items } = await listProducts(env, lang, { q: sp, limit: 5 }); pre = items.find((x) => x.sku.toLowerCase() === sp.toLowerCase()) || null; }
  return renderPage(ctx, { title: T.q_title, desc: T.q_intro, path: u(lang, "quote"), alternates: staticAlts("quote"), forms: true,
    body: `<h1>${esc(T.q_title)}</h1><p>${esc(T.q_intro)}</p><form id="quote-form" novalidate><div class="cols">
${field(T.q_contact, '<input name="contact_name" autocomplete="name" required maxlength="120">')}${field(T.q_company, '<input name="company" autocomplete="organization" required maxlength="200">')}
${field(T.q_phone, '<input name="phone" type="tel" autocomplete="tel" required maxlength="20">')}${field(T.q_email, '<input name="email" type="email" autocomplete="email" required maxlength="200">')}${field(T.q_tax, '<input name="tax_code" maxlength="20">')}</div>
<fieldset><legend>${esc(T.q_items)}</legend><div id="q-rows"><div class="qrow">${field(T.q_prod, `<input name="item_name" list="q-suggest" required maxlength="200" value="${esc(pre ? pre.sku : sp)}" data-pid="${pre ? pre.id : ""}">`)}${field(T.q_qty, '<input name="item_qty" type="number" min="1" step="1" value="10" required>')}${field(T.q_unit, '<input name="item_unit" maxlength="30">')}<button type="button" class="btn" data-rm hidden aria-label="remove">✕</button></div></div>
<datalist id="q-suggest"></datalist><button type="button" class="btn" id="q-add">${esc(T.q_add)}</button></fieldset>
<div class="cols">${field(T.q_area, '<input name="delivery_area" maxlength="200">')}${field(T.q_time, '<input name="expected_time" maxlength="100">')}</div>${field(T.q_msg, '<textarea name="message" rows="4" maxlength="3000"></textarea>')}
<label class="chk"><input type="checkbox" name="consent" required> ${esc(T.q_consent)}</label>${hp}${ts(ctx)}<p id="form-msg" class="error" role="alert" hidden></p><button class="btn quote solid" type="submit">${esc(T.q_submit)}</button></form>` });
}

export function quoteDonePage(ctx) {
  const { T, lang } = ctx;
  return renderPage(ctx, { title: T.qd_title, path: u(lang, "quote", PATHS[lang].quoteDone), alternates: { vi: u("vi", "quote", PATHS.vi.quoteDone), en: u("en", "quote", PATHS.en.quoteDone) }, noindex: true, noStore: true,
    body: `<h1>${esc(T.qd_title)}</h1><p>${esc(T.qd_text)} <strong id="quote-code">…</strong></p><p><a class="btn" href="${u(lang, "products")}">${esc(T.continue)}</a></p>` });
}

export function contactPage(ctx) {
  const { T, lang, refs } = ctx, s = refs.settings;
  const info = [s.hotline && `<p>☎ <a href="tel:${esc(String(s.hotline).replace(/[^0-9+]/g, ""))}">${esc(s.hotline)}</a></p>`, s.contact_email && `<p>✉ <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p>`, s.address && `<p>${esc(s.address)}</p>`, s.working_hours && `<p>${esc(T.working)}: ${esc(s.working_hours)}</p>`].filter(Boolean).join("");
  return renderPage(ctx, { title: T.ct_title, path: u(lang, "contact"), alternates: staticAlts("contact"), forms: true,
    body: `<h1>${esc(T.ct_title)}</h1><div class="two"><div>${info}</div><form id="contact-form" novalidate>
${field(T.ct_name, '<input name="name" autocomplete="name" required maxlength="120">')}${field(T.ct_phone, '<input name="phone" type="tel" autocomplete="tel" maxlength="20">')}${field(T.ct_email, '<input name="email" type="email" autocomplete="email" maxlength="200">')}${field(T.ct_msg, '<textarea name="message" rows="5" required maxlength="3000"></textarea>')}
<label class="chk"><input type="checkbox" name="consent" required> ${esc(T.q_consent)}</label>${hp}${ts(ctx)}<p id="form-msg" class="error" role="alert" hidden></p><button class="btn" type="submit">${esc(T.ct_submit)}</button></form></div>` });
}

// ================= NỘI DUNG: trang / tin tức / dịch vụ / chính sách =================
const KIND_TITLE = { post: "news_title", service: "services_title", policy: "policies_title" };
const fmtDate = (iso, lang) => new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB");
function contentCard(ctx, kind, r) {
  const { env, lang, T } = ctx, it = r.content_items, href = contentUrl(lang, kind, r.slug);
  return `<article class="card post">${it.cover_path ? `<a class="thumb" href="${esc(href)}"><img src="${esc(imgUrl(env, it.cover_path))}" alt="" loading="lazy" decoding="async"></a>` : ""}
    <h3><a href="${esc(href)}">${esc(r.title)}</a></h3>${kind === "post" ? `<p class="muted">${esc(fmtDate(it.publish_at || it.created_at, lang))}</p>` : ""}${r.excerpt ? `<p>${esc(r.excerpt)}</p>` : ""}
    <a class="btn" href="${esc(href)}">${esc(T.read_more)}</a></article>`;
}
export async function contentList(ctx, kind, { catSlug } = {}) {
  const { env, lang, T, refs, url } = ctx, page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const cat = catSlug ? refs.postCats.find((c) => c.tr[lang]?.slug === catSlug) : null;
  if (catSlug && !cat) return null;
  const { items, total } = await listContent(env, lang, kind, { catId: cat?.id, page, limit: 12 });
  const base = cat ? u(lang, "news", PATHS[lang].postCat, cat.tr[lang].slug) : listUrl(lang, kind), title = cat?.tr[lang].name || T[KIND_TITLE[kind]];
  const pages = Math.max(1, Math.ceil(total / 12)), has = (l) => (kind === "post" ? refs.contentNav.hasPosts[l] : (kind === "service" ? refs.contentNav.services : refs.contentNav.policies).some((x) => x.lang === l));
  const alts = {};
  for (const l of ["vi", "en"]) { if (cat) { if (cat.tr[l]) alts[l] = u(l, "news", PATHS[l].postCat, cat.tr[l].slug); } else if (has(l)) alts[l] = listUrl(l, kind); }
  const crumbs = [{ name: T.home, href: `/${lang}/` }, ...(cat ? [{ name: T.news_title, href: listUrl(lang, kind) }] : []), { name: title, href: base }];
  const topics = kind === "post" ? refs.postCats.filter((c) => c.tr[lang]) : [];
  const pager = pages > 1 ? `<nav class="pager" aria-label="pages">${page > 1 ? `<a class="btn" href="${esc(base + (page > 2 ? "?page=" + (page - 1) : ""))}">${esc(T.prev)}</a>` : ""}<span>${esc(T.page)} ${page}/${pages}</span>${page < pages ? `<a class="btn" href="${esc(base + "?page=" + (page + 1))}">${esc(T.next)}</a>` : ""}</nav>` : "";
  return renderPage(ctx, { title, path: base, canonical: base + (page > 1 ? `?page=${page}` : ""), alternates: alts, noindex: !items.length, jsonld: [breadcrumbLd(ctx, crumbs)],
    body: `${breadcrumbs(crumbs)}<h1>${esc(title)}</h1>
${topics.length ? `<ul class="topics"><li><a href="${esc(listUrl(lang, kind))}"${cat ? "" : ' aria-current="true"'}>${esc(T.all_topics)}</a></li>${topics.map((c) => `<li><a href="${esc(u(lang, "news", PATHS[lang].postCat, c.tr[lang].slug))}"${cat?.id === c.id ? ' aria-current="true"' : ""}>${esc(c.tr[lang].name)}</a></li>`).join("")}</ul>` : ""}
${items.length ? `<div class="grid">${items.map((r) => contentCard(ctx, kind, r)).join("")}</div>${pager}` : `<p>${esc(T.empty_content)}</p>`}` });
}
export async function contentDetail(ctx, kind, slug) {
  const { env, lang, T, siteUrl } = ctx, d = await getContent(env, lang, kind, slug);
  if (!d) return null;
  const { t, item, alts } = d, path = contentUrl(lang, kind, slug), when = item.publish_at || item.created_at;
  const body = await sanitize(t.body, { origin: env.SUPABASE_URL }), cover = item.cover_path ? imgUrl(env, item.cover_path) : null;
  const crumbs = [{ name: T.home, href: `/${lang}/` }, ...(kind !== "page" ? [{ name: T[KIND_TITLE[kind]], href: listUrl(lang, kind) }] : []), { name: t.title, href: path }];
  const ld = kind === "post" ? [jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: t.title, inLanguage: lang, datePublished: when, mainEntityOfPage: siteUrl + path, ...(cover ? { image: [cover] } : {}), ...(item.author_name ? { author: { "@type": "Person", name: item.author_name } } : {}), ...(t.excerpt ? { description: t.excerpt } : {}) })] : [];
  return renderPage(ctx, { title: t.seo_title || t.title, desc: t.seo_description || t.excerpt || undefined, path, ogType: kind === "post" ? "article" : "website", ogImage: cover || undefined,
    alternates: Object.fromEntries(Object.entries(alts).map(([l, sl]) => [l, contentUrl(l, kind, sl)])), jsonld: [...ld, breadcrumbLd(ctx, crumbs)],
    body: `${breadcrumbs(crumbs)}<article class="article"><h1>${esc(t.title)}</h1>${kind === "post" ? `<p class="muted">${esc(T.posted_on)} ${esc(fmtDate(when, lang))}${item.author_name ? ` · ${esc(T.by)} ${esc(item.author_name)}` : ""}</p>` : ""}
${cover ? `<img class="cover" src="${esc(cover)}" alt="" fetchpriority="high">` : ""}<div class="rich">${body}</div>
${kind === "service" ? `<p class="cta"><a class="btn buy" href="${u(lang, "contact")}">${esc(T.cta_contact)}</a> <a class="btn quote" href="${u(lang, "quote")}">${esc(T.b2b_cta)}</a></p>` : ""}</article>` });
}
