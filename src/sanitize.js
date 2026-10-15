// Lọc HTML nội dung (do nhân viên soạn) trước khi hiển thị công khai — danh sách cho phép (allowlist), chạy trên HTMLRewriter của Workers.
// Quy tắc: thẻ không có trong danh sách bị bỏ vỏ giữ chữ; thẻ nguy hiểm bị xoá cả nội dung; mọi thuộc tính không được phép bị xoá.
const KEEP = new Set(["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "figure", "figcaption", "code", "pre"]);
const DROP = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select", "option", "svg", "math", "noscript", "template", "link", "meta", "base", "title", "head", "audio", "video", "source", "canvas"]);
const ATTR = { a: ["href", "title"], img: ["src", "alt", "width", "height"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] };

const squash = (v) => String(v).replace(new RegExp("[" + String.fromCharCode(92) + "s" + String.fromCharCode(0) + "-" + String.fromCharCode(32) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + String.fromCharCode(8203) + "-" + String.fromCharCode(8207) + "]+", "g"), "");
export function okHref(v) {
  const s = squash(v).toLowerCase();
  return /^(https?:|mailto:|tel:)/.test(s) || (/^[/#]/.test(s) && !s.startsWith("//"));
}
export function okSrc(v, origin) {
  const s = squash(v);
  return (!!origin && s.startsWith(origin + "/storage/")) || (/^\/[^/]/.test(s));
}

export async function sanitize(html, { origin } = {}) {
  if (!html) return "";
  const rewriter = new HTMLRewriter()
    .on("*", {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) { el.remove(); return; }
        if (!KEEP.has(tag)) { el.removeAndKeepContent(); return; }
        const allowed = ATTR[tag] || [];
        for (const [name, value] of [...el.attributes]) {
          const n = name.toLowerCase();
          if (!allowed.includes(n)) { el.removeAttribute(name); continue; }
          if (n === "href" && !okHref(value)) el.removeAttribute(name);
          else if (n === "src" && !okSrc(value, origin)) el.removeAttribute(name);
          else if ((n === "width" || n === "height" || n === "colspan" || n === "rowspan") && !/^\d{1,4}$/.test(value)) el.removeAttribute(name);
        }
        if (tag === "a") el.setAttribute("rel", "noopener noreferrer");
        if (tag === "img") { el.setAttribute("loading", "lazy"); if (!el.hasAttribute("src")) el.remove(); }
      },
      comments(c) { c.remove(); }
    })
    .onDocument({ comments(c) { c.remove(); }, doctype(d) { d.remove(); } });
  return rewriter.transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })).text();
}
