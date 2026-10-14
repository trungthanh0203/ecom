# commerce-template

Template website bán lẻ + báo giá B2B song ngữ (Cloudflare Worker + Supabase). Xem `../BUOC2_KIEN_TRUC_DIEU_CHINH.md`.

## Trạng thái (Bước 3 — phần dữ liệu & phân quyền)
- `db/migrations/001–003`: schema, RLS, trigger, RPC (create_order, submit_quote, submit_contact, order_lookup, cart_quote, dashboard_stats).
- `db/seed_core.sql`: ma trận quyền + VAT mặc định. `db/seed_xe_dien.sql`: ngành xe điện.
- `tests/`: `npm install && npm test` — 44 kiểm thử trên Postgres thật (PGlite).

## CMS (`public/quan-tri/`)
Đăng nhập, dashboard, sản phẩm (thông tin, giá/KM, bản dịch VI/EN, thông số theo danh mục, ảnh), danh mục, thương hiệu, thuộc tính.
Điền `SUPABASE_URL` + `SUPABASE_ANON_KEY` vào `public/quan-tri/config.js`, chạy thử: `cd public && python -m http.server 8099` → http://localhost:8099/quan-tri/
Cần chạy thêm `db/migrations/004_storage.sql` (bucket ảnh). CMS mới được kiểm tra: cú pháp JS, nạp trang, màn hình đăng nhập/chưa cấu hình, KHÔNG có lỗi console. CRUD thật CHƯA kiểm thử (chờ Supabase).

## Trang công khai + API (Worker: `worker.js`, `src/`, `public/assets/`)
Trang chủ, danh sách/danh mục/thương hiệu, chi tiết sản phẩm, giỏ hàng, checkout (COD/chuyển khoản), xác nhận đơn, báo giá SLL nhiều sản phẩm, liên hệ, sitemap.xml, robots.txt, hreflang, JSON-LD, redirect 301 từ bảng `redirects`, 404. VI/EN, URL riêng từng ngôn ngữ; trang chỉ hiện ở ngôn ngữ có bản dịch ĐÃ XUẤT BẢN.
- Chạy cục bộ: `npx wrangler@4 dev` (tạo `.dev.vars` từ `.dev.vars.example` để thử API ghi; file này đã .gitignore).
- Cloudflare Dashboard → Worker → Settings → Variables and Secrets: thêm secret `SUPABASE_SERVICE_ROLE_KEY` (bắt buộc cho giỏ hàng/đặt hàng/báo giá/liên hệ), `TURNSTILE_SECRET` (tuỳ chọn). Đặt `TURNSTILE_SITEKEY` + `REQUIRE_TURNSTILE=true` trong `wrangler.jsonc` trước khi mở công khai.
- Chạy `db/seed_settings.sql` (đã sửa giá trị) để có thông tin công ty, bật COD, phí ship.

## Chưa làm / giới hạn đã biết
- Trang công khai CHƯA kiểm thử với sản phẩm thật (DB chưa có sản phẩm) và API ghi (checkout/báo giá/liên hệ) CHƯA kiểm thử đầu-cuối trên Supabase thật.
- Chưa có: trang nội dung (giới thiệu, tin tức, dịch vụ, chính sách), lọc theo thuộc tính kỹ thuật, sắp xếp theo tên, GA4/GTM, email thông báo, cache trang.
- Rate-limit trong Worker chỉ theo từng isolate (best-effort) — nên thêm Rate Limiting rule của Cloudflare.
- CMS chưa có: nội dung (tin tức/dịch vụ/trang), menu, trang chủ, SEO/redirect, đơn hàng, báo giá, nhân sự, cài đặt, xuất CSV. Worker render công khai: chưa làm.
- Chưa có: sửa/xoá danh mục chống vòng lặp cha-con; ảnh đại diện danh mục.
- Kiểm thử mới chạy trên PGlite + mô phỏng `auth`/vai trò; CHƯA chạy trên Supabase thật.
- `vat_rate` mặc định 10% — cần kế toán xác nhận. Phí ship chưa tính VAT (giả định, cần xác nhận).
- Ma trận quyền (seed_core.sql) là suy luận từ WRS, cần bạn duyệt.

## Chạy trên Supabase thật
SQL Editor: chạy lần lượt 001, 002, 003, seed_core, seed_xe_dien (KHÔNG chạy tests/auth_stub.sql).
Tạo user đầu tiên trong Auth, rồi: `insert into staff(user_id, role) values ('<uuid>', 'super_admin');`
