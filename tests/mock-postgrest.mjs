// Máy chủ GIẢ kiểu PostgREST (chỉ để kiểm tra đường vẽ trang nội dung của Worker khi DB thật chưa có dữ liệu).
// KHÔNG phải kiểm thử database. Chạy: node tests/mock-postgrest.mjs 8793
import http from "node:http";
const port = Number(process.argv[2] || 8793);
const BAD = '<p>Nội dung <strong>đậm</strong></p><script>alert("xss")</script><img src="/a.png" onerror="alert(1)" alt="ok"><a href="javascript:alert(1)">bad</a><iframe src="https://evil.com"></iframe><h2>Tiêu đề con</h2>';
const items = {
  "gioi-thieu": { kind: "page", title: "Giới thiệu", id: 1, body: BAD },
  "bai-1": { kind: "post", title: "Bài viết đầu <b>tiên</b>", id: 2, body: "<p>Nội dung bài viết</p>", cat: 1, author: "Ban biên tập" },
  "dich-vu-a": { kind: "service", title: "Dịch vụ A", id: 3, body: "<p>Mô tả dịch vụ</p>" },
  "chinh-sach-bao-mat": { kind: "policy", title: "Chính sách bảo mật", id: 4, body: "<p>Quy định</p>" }
};
const ci = (it) => ({ kind: it.kind, cover_path: null, author_name: it.author || null, post_category_id: it.cat || null, created_at: "2026-10-01T00:00:00Z", publish_at: null, sort: 0 });
const row = (slug, it, full) => ({ item_id: it.id, lang: "vi", slug, title: it.title, excerpt: "Tóm tắt " + slug, ...(full ? { body: it.body, seo_title: null, seo_description: null } : {}), content_items: ci(it) });
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), table = u.pathname.split("/").pop(), q = u.searchParams, sel = q.get("select") || "";
  let data = [];
  if (table === "content_translations") {
    const kind = (q.get("content_items.kind") || "").replace("eq.", "");
    if (q.get("slug")) { const slug = q.get("slug").replace("eq.", ""), it = items[slug]; data = it && it.kind === kind ? [row(slug, it, true)] : []; }
    else if (q.get("item_id")) { const id = Number(q.get("item_id").replace("eq.", "")), e = Object.entries(items).find(([, v]) => v.id === id); data = e ? [{ lang: "vi", slug: e[0] }, { lang: "en", slug: e[0] + "-en" }] : []; }
    else if (sel.startsWith("lang,slug,title,content_items")) data = Object.entries(items).filter(([, v]) => v.kind !== "post").map(([s, v]) => ({ lang: "vi", slug: s, title: v.title, content_items: { kind: v.kind, sort: 0 } }));
    else if (sel.startsWith("slug,content_items")) data = (q.get("lang") === "eq.vi") ? [{ slug: "bai-1", content_items: { kind: "post" } }] : [];
    else if (sel.startsWith("item_id,lang,slug,content_items")) data = Object.entries(items).map(([s, v]) => ({ item_id: v.id, lang: "vi", slug: s, content_items: { kind: v.kind } }));
    else data = Object.entries(items).filter(([, v]) => v.kind === kind).map(([s, v]) => row(s, v, false));
  } else if (table === "post_categories") data = [{ id: 1, sort: 0, post_category_translations: [{ lang: "vi", slug: "tin-cong-ty", name: "Tin công ty" }] }];
  else if (table === "site_settings") data = [{ key: "company_name", value: "Cty Mock" }];
  const body = JSON.stringify(data);
  res.writeHead(200, { "content-type": "application/json", "content-range": `0-${Math.max(0, data.length - 1)}/${data.length}` }); res.end(body);
}).listen(port, "127.0.0.1", () => console.log("mock postgrest on", port));
