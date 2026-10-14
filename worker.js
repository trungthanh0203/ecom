// Entry point Cloudflare Worker: trang công khai render phía server + API nghiệp vụ. File tĩnh (/assets, /quan-tri) do Assets phục vụ trước.
import { getRefs, rest } from "./src/db.js";
import { tr, PATHS } from "./src/i18n.js";
import { handleApi } from "./src/api.js";
import { robots, sitemap } from "./src/seo.js";
import * as P from "./src/pages.js";

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) { console.error("unhandled", e?.message, e?.body?.message); return new Response("Internal error", { status: 500, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } }); }
  }
};

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, siteUrl = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const langs = (env.LANGS || "vi,en").split(",").map((x) => x.trim()), def = env.DEFAULT_LANG || "vi";
  if (path.startsWith("/api/")) return handleApi(request, env, url);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  if (path === "/robots.txt") return new Response(robots(siteUrl), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (path === "/sitemap.xml") return new Response(await sitemap(env, siteUrl), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (path === "/") return Response.redirect(`${url.origin}/${def}/`, 302);

  const m = path.match(/^\/([a-z]{2})(\/.*)?$/), lang = m && langs.includes(m[1]) ? m[1] : null;
  const refs = await getRefs(env);
  const ctx = { env, url, lang: lang || def, T: tr(lang || def), refs, siteUrl };
  if (!lang) return (await redirectOr404(ctx, path));
  if (!path.endsWith("/")) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);

  const segs = path.split("/").filter(Boolean).slice(1), p = PATHS[lang], n = segs.length;
  let res = null;
  if (n === 0) res = await P.home(ctx);
  else if (segs[0] === p.products) {
    if (n === 1) res = await P.productList(ctx, {});
    else if (n === 3 && segs[1] === p.category) res = await P.productList(ctx, { catSlug: segs[2] });
    else if (n === 3 && segs[1] === p.brand) res = await P.productList(ctx, { brandSlug: segs[2] });
    else if (n === 2) res = await P.productDetail(ctx, segs[1]);
  } else if (n === 1 && segs[0] === p.cart) res = P.cartPage(ctx);
  else if (n === 1 && segs[0] === p.checkout) res = P.checkoutPage(ctx);
  else if (n === 1 && segs[0] === p.confirm) res = P.confirmPage(ctx);
  else if (n === 1 && segs[0] === p.quote) res = await P.quotePage(ctx);
  else if (n === 2 && segs[0] === p.quote && segs[1] === p.quoteDone) res = P.quoteDonePage(ctx);
  else if (n === 1 && segs[0] === p.contact) res = P.contactPage(ctx);
  return res || redirectOr404(ctx, path);
}

async function redirectOr404(ctx, path) {
  const { data } = await rest(ctx.env, `redirects?select=to_path,status_code&from_path=eq.${encodeURIComponent(path)}&limit=1`);
  if (data[0] && /^\/[^/]/.test(data[0].to_path)) return Response.redirect(ctx.url.origin + data[0].to_path, data[0].status_code);
  return P.notFound(ctx);
}
