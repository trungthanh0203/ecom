import { sanitize } from "../src/sanitize.js";
export default { async fetch(req) {
  const url = new URL(req.url); const html = await req.text();
  if (url.searchParams.get("mode") === "plain") return new Response("plain:" + html);
  if (url.searchParams.get("mode") === "bare") { const o = await new HTMLRewriter().on("script", { element(e) { e.remove(); } }).transform(new Response(html)).text(); return new Response("bare:" + o); }
  try { return new Response(await sanitize(html, { origin: "https://x.supabase.co" }), { headers: { "content-type": "text/plain; charset=utf-8" } }); }
  catch (e) { return new Response("ERR:" + e.message, { status: 500 }); }
} };
