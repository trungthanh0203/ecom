import { esc, vnd, jsonLd, priceInfo, imgUrl, mainImage, html, truthy } from "./util.js";
import { u, productUrl, PATHS } from "./i18n.js";

export const siteName = (ctx) => ctx.refs.settings.company_name || ctx.env.SITE_NAME || "Shop";

export function breadcrumbLd(ctx, crumbs) {
  return jsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: ctx.siteUrl + c.href })) });
}
export function breadcrumbs(crumbs) {
  return `<nav class="crumbs" aria-label="breadcrumb"><ol>${crumbs.map((c, i) => i === crumbs.length - 1
    ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>`).join("")}</ol></nav>`;
}

export function productCard(ctx, p) {
  const { env, lang, T } = ctx;
  const t = (p.product_translations || [])[0] || {}, pi = priceInfo(p), im = mainImage(p);
  const href = productUrl(lang, t.slug), retail = p.retail_enabled && pi.current != null && pi.current > 0;
  const price = pi.current == null ? `<p class="price muted">${esc(T.call_price)}</p>`
    : `<p class="price">${pi.onSale ? `<s>${esc(vnd(pi.list))}</s> ` : ""}<strong>${esc(vnd(pi.current))}</strong> <small>${esc(T.excl_vat)}</small></p>`;
  return `<article class="card product">
    <a class="thumb" href="${esc(href)}">${im ? `<img src="${esc(imgUrl(env, im.path))}" alt="${esc((lang === "en" ? im.alt_en : im.alt_vi) || t.name || "")}" loading="lazy" decoding="async">` : '<span class="noimg" aria-hidden="true"></span>'}</a>
    <h3><a href="${esc(href)}">${esc(t.name)}</a></h3><p class="sku muted">${esc(T.sku)}: ${esc(p.sku)}</p>${price}
    <div class="btns">${retail ? `<button type="button" class="btn buy" data-add="${p.id}">${esc(T.add_to_cart)}</button>` : ""}
    <a class="btn quote" href="${esc(u(lang, "quote") + "?sp=" + encodeURIComponent(p.sku))}">${esc(T.quote_short)}</a></div></article>`;
}

// opts: {title, desc, path, alternates:{lang:path}, ogImage, jsonld:[], body, noindex, noStore, forms}
export function renderPage(ctx, o) {
  const { env, lang, T, refs, siteUrl } = ctx, s = refs.settings, name = siteName(ctx);
  const langs = (env.LANGS || "vi,en").split(",").map((x) => x.trim());
  const alts = o.alternates || {};
  const title = o.title ? `${o.title} | ${name}` : name;
  const canon = siteUrl + (o.canonical || o.path);
  const hreflang = Object.keys(alts).map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(siteUrl + alts[l])}">`).join("")
    + (alts.vi ? `<link rel="alternate" hreflang="x-default" href="${esc(siteUrl + alts.vi)}">` : "");
  const sitekey = env.TURNSTILE_SITEKEY || "";
  const i18n = JSON.stringify({ lang, T, sitekey, urls: { cart: u(lang, "cart"), checkout: u(lang, "checkout"), confirm: u(lang, "confirm"), quoteDone: u(lang, "quote", PATHS[lang].quoteDone), products: u(lang, "products") } }).replace(/</g, "\\u003c");
  const switcher = langs.map((l) => l === lang ? `<span class="lang on" aria-current="true">${l.toUpperCase()}</span>`
    : `<a class="lang" hreflang="${l}" lang="${l}" href="${esc(alts[l] || `/${l}/`)}">${l.toUpperCase()}</a>`).join("");
  const contactLines = [s.hotline && `<a href="tel:${esc(String(s.hotline).replace(/[^0-9+]/g, ""))}">${esc(s.hotline)}</a>`, s.contact_email && `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>`, s.address && esc(s.address)].filter(Boolean);
  const body = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${o.desc ? `<meta name="description" content="${esc(o.desc)}">` : ""}
<link rel="canonical" href="${esc(canon)}">${o.noindex ? '<meta name="robots" content="noindex,follow">' : ""}${hreflang}
<meta property="og:site_name" content="${esc(name)}"><meta property="og:title" content="${esc(o.title || name)}"><meta property="og:type" content="${o.ogType || "website"}"><meta property="og:url" content="${esc(canon)}">
${o.desc ? `<meta property="og:description" content="${esc(o.desc)}">` : ""}${o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}">` : ""}<meta property="og:locale" content="${lang === "vi" ? "vi_VN" : "en_US"}">
<link rel="stylesheet" href="/assets/shop.css?v=1">${(o.jsonld || []).join("")}</head>
<body><a class="skip" href="#main">${esc(T.skip)}</a>
<header class="top"><div class="wrap bar"><a class="logo" href="/${lang}/">${esc(name)}</a>
<nav class="nav" aria-label="main"><a href="${u(lang, "products")}">${esc(T.nav_products)}</a><a href="${u(lang, "quote")}">${esc(T.nav_quote)}</a><a href="${u(lang, "contact")}">${esc(T.nav_contact)}</a></nav>
<form class="search" action="${u(lang, "products")}" method="get" role="search"><input type="search" name="q" placeholder="${esc(T.search_ph)}" aria-label="${esc(T.search)}"><button class="btn" type="submit">${esc(T.search)}</button></form>
<div class="right"><span class="langs">${switcher}</span><a class="cartlink" href="${u(lang, "cart")}">${esc(T.cart)} <span id="cart-count" class="badge" hidden>0</span></a></div></div></header>
<main id="main" class="wrap">${o.body}</main>
<footer class="foot"><div class="wrap"><strong>${esc(name)}</strong>${contactLines.length ? `<p>${contactLines.join(" · ")}</p>` : ""}${s.working_hours ? `<p>${esc(T.working)}: ${esc(s.working_hours)}</p>` : ""}<p class="muted">© ${new Date().getFullYear()} ${esc(name)}. ${esc(T.footer_rights)}</p></div></footer>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="application/json" id="i18n">${i18n}</script>
${o.forms && sitekey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
<script src="/assets/shop.js?v=1" defer></script></body></html>`;
  const headers = {
    "cache-control": o.noStore ? "no-store" : "no-cache",
    "content-security-policy": "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: https://*.supabase.co; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY"
  };
  return html(body, o.status || 200, headers);
}
