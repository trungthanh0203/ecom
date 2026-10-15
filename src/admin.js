// API quản lý nhân sự (CHỈ Super Admin). Dùng khoá service_role để tạo/khoá tài khoản đăng nhập — vì vậy:
//  • người gọi phải gửi token đăng nhập (Bearer) và được xác thực với Supabase Auth; cờ staff.role phải là super_admin đang hoạt động;
//  • chặn gửi từ nguồn lạ, giới hạn tần suất, ghi nhật ký kèm người thực hiện, KHÔNG ghi mật khẩu vào log/nhật ký.
import { rest, DbError } from "./db.js";
import { jsonRes } from "./util.js";
import { limited } from "./limit.js";

const ROLES = ["super_admin", "admin", "editor", "contributor", "sales", "order_manager"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const fail = (error, status, extra = {}) => jsonRes({ error, ...extra }, status);

async function auth(env, path, { method = "GET", body } = {}) {
  const k = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new DbError(500, { message: "MISSING_SERVICE_ROLE_KEY" });
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, { method, headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { msg: text.slice(0, 200) }; }
  if (!res.ok) { const e = new Error(data?.msg || data?.message || "auth error"); e.status = res.status; e.code = data?.error_code || data?.code; throw e; }
  return data;
}
async function listUsers(env) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const d = await auth(env, `admin/users?page=${page}&per_page=200`), arr = Array.isArray(d) ? d : d?.users || [];
    out.push(...arr); if (arr.length < 200) break;
  }
  return out;
}
const log = (env, actor, action, target, detail) => rest(env, "rpc/log_admin_action", { key: "service", method: "POST", body: { p_actor: actor, p_action: action, p_target: target, p_detail: detail } }).catch((e) => console.error("audit log failed", action, e?.status));

// Mật khẩu tạm: 16 ký tự ngẫu nhiên mật mã học (loại ký tự dễ nhầm), đủ chữ hoa/thường/số.
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function tempPassword() {
  for (;;) {
    const b = new Uint8Array(32); crypto.getRandomValues(b); let p = "";
    for (const x of b) { if (x < 256 - (256 % ALPHA.length)) p += ALPHA[x % ALPHA.length]; if (p.length === 16) break; }
    if (p.length === 16 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

async function caller(env, request) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+([A-Za-z0-9._-]{20,4000})$/);
  if (!m) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !UUID.test(u.id || "")) return null;
  const { data } = await rest(env, `staff?select=role,active&user_id=eq.${u.id}&limit=1`, { key: "service" });
  const s = data[0];
  return s && s.active && s.role === "super_admin" ? { id: u.id, email: u.email } : { forbidden: true };
}

export async function handleAdmin(request, env, url, ip) {
  const path = url.pathname.replace(/\/$/, "");
  const origin = request.headers.get("origin");
  if ((request.method !== "GET" && !origin) || (origin && new URL(origin).origin !== url.origin)) return fail("ORIGIN", 403);
  const strict = path.endsWith("/create") || path.endsWith("/reset-password");
  if (limited(ip, "admin", 120, 600000) || (strict && limited(ip, "admin-strict", 20, 600000))) return fail("RATE", 429);
  try {
    const me = await caller(env, request);
    if (!me) return fail("UNAUTHORIZED", 401);
    if (me.forbidden) return fail("FORBIDDEN", 403);

    if (request.method === "GET" && path === "/api/admin/staff") {
      const [{ data: staff }, users] = await Promise.all([rest(env, "staff?select=user_id,role,display_name,active,created_at&order=created_at.asc", { key: "service" }), listUsers(env)]);
      const byId = new Map(users.map((u) => [u.id, u]));
      return jsonRes({ staff: staff.map((s) => { const u = byId.get(s.user_id); return { ...s, email: u?.email || null, last_sign_in_at: u?.last_sign_in_at || null, banned: !!(u?.banned_until && Date.parse(u.banned_until) > Date.now()), must_change_password: !!u?.user_metadata?.must_change_password }; }), me: me.id });
    }
    if (request.method !== "POST") return fail("NOT_FOUND", 404);
    const text = await request.text();
    if (text.length > 4000) return fail("TOO_LARGE", 413);
    let b; try { b = JSON.parse(text); } catch { return fail("BAD_JSON", 400); }
    if (!b || typeof b !== "object") return fail("BAD_JSON", 400);

    if (path === "/api/admin/staff/create") {
      const email = String(b.email || "").trim().toLowerCase(), name = String(b.display_name || "").trim(), role = b.role;
      if (!EMAIL.test(email) || email.length > 200) return fail("INVALID_EMAIL", 422);
      if (name.length < 1 || name.length > 80) return fail("INVALID_NAME", 422);
      if (!ROLES.includes(role)) return fail("INVALID_ROLE", 422);
      const pwd = tempPassword(); let userId, existing = false;
      try { userId = (await auth(env, "admin/users", { method: "POST", body: { email, password: pwd, email_confirm: true, user_metadata: { must_change_password: true } } })).id; }
      catch (e) {
        if (e.status === 422 || e.code === "email_exists" || /already|exists|registered/i.test(e.message)) {
          const found = (await listUsers(env)).find((u) => (u.email || "").toLowerCase() === email);
          if (!found) return fail("EMAIL_TAKEN", 409);
          userId = found.id; existing = true;
        } else throw e;
      }
      if (existing) { const { data } = await rest(env, `staff?select=user_id&user_id=eq.${userId}&limit=1`, { key: "service" }); if (data.length) return fail("ALREADY_STAFF", 409); }
      try { await rest(env, "staff", { key: "service", method: "POST", body: { user_id: userId, role, display_name: name, active: true } }); }
      catch (e) { if (!existing) await auth(env, `admin/users/${userId}`, { method: "DELETE" }).catch(() => {}); throw e; }   // hoàn tác: không để lại tài khoản mồ côi
      await log(env, me.id, "staff.create", userId, { email, role, existing });
      return jsonRes({ user_id: userId, email, role, existing, temp_password: existing ? null : pwd });
    }

    if (path === "/api/admin/staff/update") {
      if (!UUID.test(String(b.user_id || ""))) return fail("INVALID_USER", 422);
      const patch = {};
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) return fail("INVALID_ROLE", 422); patch.role = b.role; }
      if (b.active !== undefined) { if (typeof b.active !== "boolean") return fail("INVALID_ACTIVE", 422); patch.active = b.active; }
      if (b.display_name !== undefined) { const n = String(b.display_name).trim(); if (n.length < 1 || n.length > 80) return fail("INVALID_NAME", 422); patch.display_name = n; }
      if (!Object.keys(patch).length) return fail("NOTHING_TO_UPDATE", 422);
      if (b.user_id === me.id && (patch.role !== undefined || patch.active !== undefined)) return fail("SELF_CHANGE", 422);
      const { data } = await rest(env, `staff?user_id=eq.${b.user_id}`, { key: "service", method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
      if (!data.length) return fail("NOT_FOUND", 404);
      let banFailed = false;
      if (patch.active !== undefined) { try { await auth(env, `admin/users/${b.user_id}`, { method: "PUT", body: { ban_duration: patch.active ? "none" : "876000h" } }); } catch (e) { banFailed = true; console.error("ban update failed", e?.status); } }
      await log(env, me.id, "staff.update", b.user_id, patch);
      return jsonRes({ ok: true, staff: data[0], ban_failed: banFailed });
    }

    if (path === "/api/admin/staff/reset-password") {
      if (!UUID.test(String(b.user_id || ""))) return fail("INVALID_USER", 422);
      if (b.user_id === me.id) return fail("SELF_RESET", 422);
      const { data } = await rest(env, `staff?select=user_id&user_id=eq.${b.user_id}&limit=1`, { key: "service" });
      if (!data.length) return fail("NOT_FOUND", 404);
      const pwd = tempPassword();
      await auth(env, `admin/users/${b.user_id}`, { method: "PUT", body: { password: pwd, user_metadata: { must_change_password: true } } });
      await log(env, me.id, "staff.reset_password", b.user_id, {});
      return jsonRes({ temp_password: pwd });
    }
    return fail("NOT_FOUND", 404);
  } catch (e) {
    if (e instanceof DbError && e.body?.code === "P0001") return fail(String(e.body.message).split(" ")[0], 422);
    console.error("admin api error", path, e?.status, e?.code, e?.message);
    return fail(e instanceof DbError ? "DB_ERROR" : "AUTH_API", 502, { status: e?.status || 0 });
  }
}
