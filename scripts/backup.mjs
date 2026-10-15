#!/usr/bin/env node
// Sao lưu toàn bộ dữ liệu (bảng + tài khoản nhân viên + ảnh Storage) thành 1 tệp mã hoá.
// Cần: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_PASSPHRASE (>= 12 ký tự). Tuỳ chọn: BACKUP_DIR (mặc định ./backups), BACKUP_KEEP (mặc định 14).
// KHÔNG sao lưu mật khẩu (Supabase không cho đọc); nhân viên sẽ nhận mật khẩu tạm khi khôi phục.
// Lưu ý kỹ thuật: KHÔNG gọi process.exit() khi còn kết nối mạng đang mở (làm Node trên Windows sập với mã lạ) — đặt exitCode rồi thoát tự nhiên.
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { backupStable, encrypt, sha256 } from "./backup-lib.mjs";
import { restTransport } from "./transport-rest.mjs";

async function main() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, BACKUP_PASSPHRASE: pass } = process.env, dir = process.env.BACKUP_DIR || "backups", keep = Number(process.env.BACKUP_KEEP || 14);
  if (!url || !key) throw new Error("thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
  const plain = process.argv.includes("--no-encrypt");
  if (!pass && !plain) throw new Error("thiếu BACKUP_PASSPHRASE (tệp sao lưu chứa dữ liệu khách hàng nên PHẢI mã hoá; chỉ dùng --no-encrypt khi thử nghiệm)");
  console.log("Đang sao lưu…");
  const res = await backupStable(restTransport({ url, key }), { source: url, log: console.log });
  const out = plain ? res.buf : encrypt(res.buf, pass), stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ecom-backup-${stamp}.bak${plain ? "" : ".enc"}`);
  writeFileSync(file, out, { mode: 0o600 });
  const old = readdirSync(dir).filter((f) => /^ecom-backup-.*\.bak(\.enc)?$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) unlinkSync(join(dir, f));
  const rows = Object.values(res.manifest.tables).reduce((s, t) => s + t.rows, 0);
  console.log(`\nXong: ${file}\n  ${(out.length / 1024).toFixed(1)} KB · ${rows} dòng · ${res.manifest.storage.files.length} tệp · sha256 ${sha256(out).slice(0, 16)}…${old.length ? `\n  đã xoá ${old.length} bản cũ (giữ ${keep} bản gần nhất)` : ""}\nHãy lưu cụm mật khẩu ở nơi KHÁC với tệp sao lưu — mất cụm mật khẩu là mất bản sao lưu.`);
}
main().catch((e) => { console.error("LỖI: " + e.message); process.exitCode = 1; });
