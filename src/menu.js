import { okHref } from "./sanitize.js";

// Dựng cây menu (tối đa 2 cấp) cho 1 vị trí + 1 ngôn ngữ. Mục thiếu nhãn/liên kết ở ngôn ngữ đó bị ẩn (cùng quy tắc "bản dịch riêng" của cả site).
export function buildMenu(items, location, lang) {
  const pick = (m) => {
    const label = lang === "en" ? m.label_en : m.label_vi, url = lang === "en" ? m.url_en : m.url_vi;
    return label && url && okHref(url) ? { label, url } : null;
  };
  const rows = items.filter((m) => m.location === location);
  return rows.filter((m) => !m.parent_id).map((t) => {
    const it = pick(t); if (!it) return null;
    return { ...it, children: rows.filter((c) => c.parent_id === t.id).map(pick).filter(Boolean) };
  }).filter(Boolean);
}
