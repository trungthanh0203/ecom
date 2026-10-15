// Giới hạn tần suất theo isolate (best-effort, KHÔNG chia sẻ giữa các isolate/vùng).
// Lớp chống lạm dụng thật: Turnstile + (khuyến nghị) quy tắc Rate Limiting/WAF của Cloudflare + khoá idempotency trong DB.
const buckets = new Map();
export function limited(ip, route, max, windowMs) {
  const now = Date.now(), k = `${route}|${ip}`; let b = buckets.get(k);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.n++;
  if (buckets.size > 5000) for (const [kk, v] of buckets) if (now > v.reset) buckets.delete(kk);
  return b.n > max;
}
