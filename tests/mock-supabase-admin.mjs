// Máy chủ GIẢ của Supabase Auth Admin + PostgREST (staff, rpc) — CHỈ để kiểm thử API quản lý nhân sự của Worker trong máy.
// KHÔNG phải kiểm thử Supabase thật. Chạy: node tests/mock-supabase-admin.mjs 8821
import http from "node:http";
const port = Number(process.argv[2] || 8821), SERVICE = "service-test", ANON = "anon-test";
const ids = { sa: "00000000-0000-0000-0000-000000000001", ed: "00000000-0000-0000-0000-000000000003", sales: "00000000-0000-0000-0000-000000000005", orphan: "00000000-0000-0000-0000-0000000000aa" };
const users = new Map([[ids.sa, { id: ids.sa, email: "sa@x.vn", last_sign_in_at: "2026-10-14T01:00:00Z", user_metadata: {} }], [ids.ed, { id: ids.ed, email: "ed@x.vn", last_sign_in_at: null, user_metadata: { must_change_password: true } }],
  [ids.sales, { id: ids.sales, email: "sales@x.vn", last_sign_in_at: null, user_metadata: {} }], [ids.orphan, { id: ids.orphan, email: "orphan@x.vn", last_sign_in_at: null, user_metadata: {} }]]);
const staff = new Map([[ids.sa, { user_id: ids.sa, role: "super_admin", display_name: "SA", active: true, created_at: "2026-01-01T00:00:00Z" }], [ids.ed, { user_id: ids.ed, role: "editor", display_name: "Ed", active: true, created_at: "2026-01-02T00:00:00Z" }],
  [ids.sales, { user_id: ids.sales, role: "sales", display_name: "Sales", active: false, created_at: "2026-01-03T00:00:00Z" }]]);
const tokens = { "token-sa-aaaaaaaaaaaaaaaaaaaaaaaa": ids.sa, "token-ed-aaaaaaaaaaaaaaaaaaaaaaaa": ids.ed, "token-sales-aaaaaaaaaaaaaaaaaaaa": ids.sales };
const audit = [], calls = []; let seq = 100;
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname, q = u.searchParams, b = req.method === "GET" || req.method === "DELETE" ? {} : await body(req);
  const key = req.headers.apikey, bearer = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
  if (p === "/__state") return json(res, 200, { staff: [...staff.values()], users: [...users.values()], audit, calls });
  if (p === "/auth/v1/user") {   // xác thực token người dùng (chỉ cần apikey = anon)
    if (key !== ANON || !tokens[bearer]) return json(res, 401, { msg: "invalid" });
    const id = tokens[bearer]; return json(res, 200, { id, email: users.get(id)?.email });
  }
  const svc = key === SERVICE && bearer === SERVICE;
  if (p.startsWith("/auth/v1/admin/") || p.startsWith("/rest/v1/")) { calls.push({ m: req.method, p, svc }); if (!svc) return json(res, 401, { message: "Invalid API key" }); }
  if (p === "/auth/v1/admin/users" && req.method === "GET") return json(res, 200, { users: [...users.values()] });
  if (p === "/auth/v1/admin/users" && req.method === "POST") {
    if (b.email === "boom@x.vn") return json(res, 500, { msg: "boom" });
    if ([...users.values()].some((x) => x.email === b.email)) return json(res, 422, { error_code: "email_exists", msg: "A user with this email address has already been registered" });
    const id = "00000000-0000-0000-0000-" + String(++seq).padStart(12, "0");
    users.set(id, { id, email: b.email, last_sign_in_at: null, user_metadata: b.user_metadata || {}, password_len: String(b.password || "").length, confirmed: b.email_confirm === true }); return json(res, 200, { id, email: b.email });
  }
  let m = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && req.method === "PUT") { const x = users.get(m[1]); if (!x) return json(res, 404, { msg: "not found" }); if (b.password) x.password_len = b.password.length, x.password_set_at = Date.now(); if (b.user_metadata) x.user_metadata = { ...x.user_metadata, ...b.user_metadata }; if (b.ban_duration) x.ban_duration = b.ban_duration, x.banned_until = b.ban_duration === "none" ? null : "2999-01-01T00:00:00Z"; return json(res, 200, x); }
  if (m && req.method === "DELETE") { users.delete(m[1]); staff.delete(m[1]); return json(res, 200, {}); }
  if (p === "/rest/v1/staff" && req.method === "GET") { const id = (q.get("user_id") || "").replace("eq.", ""); return json(res, 200, id ? [...staff.values()].filter((s) => s.user_id === id) : [...staff.values()]); }
  if (p === "/rest/v1/staff" && req.method === "POST") {
    if ([...users.values()].find((x) => x.id === b.user_id)?.email === "rollback@x.vn") return json(res, 500, { message: "simulated failure" });
    if (!users.has(b.user_id)) return json(res, 409, { code: "23503", message: "foreign key" }); if (staff.has(b.user_id)) return json(res, 409, { code: "23505", message: "duplicate" });
    const row = { ...b, created_at: new Date().toISOString() }; staff.set(b.user_id, row); return json(res, 201, [row]);
  }
  if (p === "/rest/v1/staff" && req.method === "PATCH") {
    const id = (q.get("user_id") || "").replace("eq.", ""), row = staff.get(id); if (!row) return json(res, 200, []);
    const others = [...staff.values()].filter((s) => s.user_id !== id && s.role === "super_admin" && s.active);
    if (row.role === "super_admin" && row.active && ((b.role && b.role !== "super_admin") || b.active === false) && !others.length) return json(res, 400, { code: "P0001", message: "LAST_SUPER_ADMIN" });
    Object.assign(row, b); return json(res, 200, [row]);
  }
  if (p === "/rest/v1/rpc/log_admin_action") { audit.push(b); return json(res, 200, null); }
  json(res, 404, { message: "mock: not handled " + p });
}).listen(port, "127.0.0.1", () => console.log("mock supabase admin on", port));
