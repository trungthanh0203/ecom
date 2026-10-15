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

## CMS vận hành (`public/quan-tri/ops.js`) — cần chạy thêm `db/migrations/005_staff_directory.sql`
Đơn hàng (lọc/tìm, chi tiết, đổi trạng thái đơn/thanh toán/vận chuyển theo đúng bảng chuyển, phân công, ghi chú, lịch sử, in phiếu, xuất CSV), Báo giá B2B (lọc/tìm, chi tiết, trạng thái, phân công, ghi chú, ghi nhận đã liên hệ, xuất CSV), Liên hệ, Cài đặt (thông tin công ty, VAT, COD/chuyển khoản, phí vận chuyển).
Kiểm tra giao diện mới chỉ bằng client Supabase GIẢ (bắt lỗi JS khi vẽ) — chưa thử thao tác ghi thật.

## Nội dung: trang / tin tức / dịch vụ / chính sách (cần chạy thêm `db/migrations/006_content_guard.sql`)
- Công khai: `/vi/{slug}/` (trang, vd /vi/gioi-thieu/), `/vi/tin-tuc/` (+ chuyên mục `/chuyen-muc/{slug}/`), `/vi/dich-vu/`, `/vi/chinh-sach/` và tương ứng `/en/…`. Menu/chân trang tự hiện khi có nội dung; trang chủ hiện 3 tin mới; sitemap + hreflang + JSON-LD Article.
- CMS: nhóm "Nội dung" — soạn bằng trình soạn thảo trực quan tự làm, ảnh đại diện, hẹn giờ, SEO riêng từng ngôn ngữ, trạng thái bản dịch (dịch máy không tự xuất bản), chuyên mục tin.
- An toàn: HTML được lọc theo allowlist ở 3 lớp (khi nạp vào trình soạn thảo, khi dán/lưu, và `src/sanitize.js` khi hiển thị công khai). Slug trang không được trùng đường dẫn hệ thống (trigger trong DB; thêm đường dẫn hệ thống mới => sửa `_reserved_slugs()` trong 006).
- Chưa làm: FAQ, đối tác, chứng nhận, dự án, tuyển dụng (DB đã có loại nội dung, chưa có trang công khai/CMS).
- Kiểm thử: `npm test` (DB, gồm nội dung); bộ lọc HTML: `npx wrangler@4 dev -c tests/wrangler.test.jsonc` rồi POST HTML vào http://127.0.0.1:8787/; `tests/mock-postgrest.mjs` là máy chủ GIẢ chỉ để thử đường vẽ trang khi DB chưa có dữ liệu.

## Menu & khối trang chủ (cần chạy thêm `db/migrations/007_menus_blocks_guard.sql`)
- CMS nhóm "Nội dung": **Menu** (đầu trang/chân trang, tối đa 2 cấp, đổi thứ tự ↑↓, chọn nhanh liên kết tới trang/danh mục/nội dung có sẵn) và **Khối trang chủ** (Hero, Danh mục, Sản phẩm [nổi bật/mới/mới nhất], Thương hiệu, Tin mới, CTA, Nội dung tự do, Banner; bật/tắt, đổi thứ tự, nội dung riêng từng ngôn ngữ).
- Công khai: chưa tạo menu/khối → website giữ menu và bố cục MẶC ĐỊNH như trước. Có menu/khối → dùng cấu hình. Mục/khối thiếu nội dung ở một ngôn ngữ thì ẩn ở ngôn ngữ đó (ngôn ngữ chưa có khối nào dùng bố cục mặc định).
- An toàn: DB chặn liên kết nguy hiểm (chỉ /nội-bộ, #neo, http(s)://, mailto:, tel:), menu > 2 cấp, loại khối lạ; Worker kiểm tra liên kết thêm một lần khi hiển thị; HTML khối "Nội dung tự do" được lọc như bài viết.

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
