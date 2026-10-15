import { renderPage } from "../src/layout.js";
import { tr } from "../src/i18n.js";
const T = tr("vi");
const mk = (menus, settings) => ({ env: { LANGS: "vi,en", SUPABASE_URL: "https://x.supabase.co" }, lang: "vi", T, siteUrl: "https://e.x", cfg: { social: [], logo: "", noindex: false, csp: { script: [], connect: [], img: [], frame: [] }, titleSuffix: "x" }, url: new URL("https://e.x/vi/"),
  refs: { settings, menus, cats: [{ id: 1, parent_id: null, tr: { vi: { slug: "xe-may-dien", name: "Xe máy điện" } } }, { id: 2, parent_id: 1, tr: { vi: { slug: "xe-50cc", name: "Xe 50cc" } } }], contentNav: { pages: [], policies: [], services: [], hasPosts: { vi: true }, has: { faq: { vi: true } } } } });
const html = async (ctx) => (await renderPage(ctx, { body: "<p>x</p>", path: "/vi/" })).text?.() ?? (await renderPage(ctx, { body: "<p>x</p>", path: "/vi/" }));
const r = await renderPage(mk([], { company_name: "Cty", hotline: "0900 111 222", hotline_2: "0900 333 444" }), { body: "<p>x</p>", path: "/vi/", alternates: { vi: "/vi/", en: "/en/" } });
const t = typeof r === "string" ? r : await r.text();
const must = ['class="util"', 'class="navbar"', "Xe máy điện", "Xe 50cc", 'class="hotlines"', "Hotline 2", "Tin tức", "Hỏi đáp"];
let bad = 0; for (const m of must) if (!t.includes(m)) { console.log("THIẾU:", m); bad++; }
const none = await renderPage(mk([], { company_name: "Cty" }), { body: "", path: "/vi/" }); const t2 = typeof none === "string" ? none : await none.text();
if (t2.includes('class="hotlines"')) { console.log("hotlines hiện dù chưa nhập"); bad++; }
console.log(bad ? "FAIL" : "OK"); process.exitCode = bad ? 1 : 0;
