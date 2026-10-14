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

## Chưa làm / giới hạn đã biết
- CMS chưa có: nội dung (tin tức/dịch vụ/trang), menu, trang chủ, SEO/redirect, đơn hàng, báo giá, nhân sự, cài đặt, xuất CSV. Worker render công khai: chưa làm.
- Chưa có: sửa/xoá danh mục chống vòng lặp cha-con; ảnh đại diện danh mục.
- Kiểm thử mới chạy trên PGlite + mô phỏng `auth`/vai trò; CHƯA chạy trên Supabase thật.
- `vat_rate` mặc định 10% — cần kế toán xác nhận. Phí ship chưa tính VAT (giả định, cần xác nhận).
- Ma trận quyền (seed_core.sql) là suy luận từ WRS, cần bạn duyệt.

## Chạy trên Supabase thật
SQL Editor: chạy lần lượt 001, 002, 003, seed_core, seed_xe_dien (KHÔNG chạy tests/auth_stub.sql).
Tạo user đầu tiên trong Auth, rồi: `insert into staff(user_id, role) values ('<uuid>', 'super_admin');`
