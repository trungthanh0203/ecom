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
  else if (table === "menus" && process.env.MODE === "cfg") data = [
    { id: 1, location: "main", parent_id: null, sort: 0, label_vi: "Sản phẩm", label_en: "Products", url_vi: "/vi/san-pham/", url_en: "/en/products/" },
    { id: 2, location: "main", parent_id: 1, sort: 0, label_vi: "Xe máy điện", label_en: null, url_vi: "/vi/san-pham/danh-muc/xe-may-dien/", url_en: null },
    { id: 3, location: "main", parent_id: null, sort: 1, label_vi: "Liên hệ", label_en: "Contact", url_vi: "/vi/lien-he/", url_en: "/en/contact/" },
    { id: 4, location: "main", parent_id: null, sort: 2, label_vi: "Độc hại", label_en: "Evil", url_vi: "javascript:alert(1)", url_en: "javascript:alert(1)" },
    { id: 5, location: "main", parent_id: null, sort: 3, label_vi: "Chỉ có tiếng Việt", label_en: null, url_vi: "/vi/gioi-thieu/", url_en: null },
    { id: 6, location: "footer", parent_id: null, sort: 0, label_vi: "Công ty", label_en: "Company", url_vi: "/vi/gioi-thieu/", url_en: "/en/about/" },
    { id: 7, location: "footer", parent_id: 6, sort: 0, label_vi: "Giới thiệu", label_en: "About", url_vi: "/vi/gioi-thieu/", url_en: "/en/about/" },
    { id: 8, location: "footer", parent_id: null, sort: 1, label_vi: "Hỗ trợ", label_en: null, url_vi: "/vi/lien-he/", url_en: null }];
  else if (table === "home_blocks" && process.env.MODE === "cfg") data = [
    { id: 1, block_type: "hero", sort: 0, payload: { vi: { title: "Xe điện số 1 <b>VN</b>", subtitle: "Mô tả hero", cta1_label: "Mua ngay", cta1_url: "/vi/san-pham/", cta2_label: "Nút độc hại", cta2_url: "javascript:bad()" }, cfg: { image_path: "site/h.webp" } } },
    { id: 2, block_type: "banner", sort: 1, payload: { vi: { alt: "Khuyến mãi tháng 10", url: "/vi/lien-he/" }, cfg: { image_path: "site/b.webp" } } },
    { id: 3, block_type: "text", sort: 2, payload: { vi: { title: "Về chúng tôi", body: "<p>Xin <strong>chào</strong></p><script>alert(1)</script><img src=\"/a.png\" onerror=\"x()\">" } } },
    { id: 4, block_type: "cta", sort: 3, payload: { vi: { title: "Mua sỉ?", text: "Liên hệ", button_label: "Báo giá", button_url: "/vi/bao-gia-so-luong-lon/" } } },
    { id: 5, block_type: "products", sort: 4, payload: { en: { title: "Only English block" }, cfg: { source: "featured", limit: 99 } } },
    { id: 6, block_type: "products", sort: 5, payload: { vi: { title: "Nổi bật" }, cfg: { source: "featured", limit: 99 } } }];
  const body = JSON.stringify(data);
  res.writeHead(200, { "content-type": "application/json", "content-range": `0-${Math.max(0, data.length - 1)}/${data.length}` }); res.end(body);
}).listen(port, "127.0.0.1", () => console.log("mock postgrest on", port));
