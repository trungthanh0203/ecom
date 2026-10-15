// Kết nối THẬT tới Supabase (PostgREST + Auth Admin + Storage) bằng khoá service_role. Chỉ dùng cho scripts/backup.mjs và scripts/restore.mjs.
import { orderOf } from "./backup-lib.mjs";

export function restTransport({ url, key, bucket = "media" }) {
  const base = url.replace(/\/$/, ""), H = { apikey: key, Authorization: `Bearer ${key}` };
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  async function j(path, opt = {}) {
    const r = await fetch(base + path, { ...opt, headers: { ...H, "Content-Type": "application/json", ...(opt.headers || {}) } });
    const text = await r.text(); let d = null; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
    if (!r.ok) { const m = typeof d === "string" ? d : (d && (d.message || d.msg || d.error)) || JSON.stringify(d); const e = new Error(`${opt.method || "GET"} ${path.split("?")[0]} -> ${r.status}: ${String(m).slice(0, 200)}`); e.status = r.status; e.body = d; throw e; }
    return d;
  }
  return {
    select: (t, off, lim) => j(`/rest/v1/${t}?select=*&order=${orderOf(t)}&limit=${lim}&offset=${off}`),
    rpc: (name, args) => j(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) }),
    async listUsers() { const out = []; for (let p = 1; p <= 50; p++) { const d = await j(`/auth/v1/admin/users?page=${p}&per_page=200`), a = Array.isArray(d) ? d : d.users || []; out.push(...a); if (a.length < 200) break; } return out; },
    createUser: (body) => j("/auth/v1/admin/users", { method: "POST", body: JSON.stringify(body) }),
    async storageList(prefix) {
      const out = [];
      for (let off = 0; ; off += 1000) {
        const d = await j(`/storage/v1/object/list/${bucket}`, { method: "POST", body: JSON.stringify({ prefix, limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } }) });
        for (const e of d) out.push({ name: e.name, isFolder: e.id === null || e.id === undefined });
        if (d.length < 1000) break;
      }
      return out;
    },
    async storageGet(path) { const r = await fetch(`${base}/storage/v1/object/${bucket}/${enc(path)}`, { headers: H }); if (!r.ok) throw new Error(`tải ${path}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    async storagePut(path, buf, contentType) { const r = await fetch(`${base}/storage/v1/object/${bucket}/${enc(path)}`, { method: "POST", headers: { ...H, "Content-Type": contentType, "x-upsert": "true" }, body: buf }); if (!r.ok) throw new Error(`tải lên ${path}: ${r.status} ${(await r.text()).slice(0, 120)}`); }
  };
}
