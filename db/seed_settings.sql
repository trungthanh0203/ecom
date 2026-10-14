-- seed_settings.sql — thông tin doanh nghiệp + phương thức thanh toán + phí ship. SỬA GIÁ TRỊ rồi chạy trong SQL Editor.
-- Trang công khai đọc các khoá này (is_public = true nên anon đọc được; ĐỪNG đưa secret/mật khẩu vào đây).
insert into public.site_settings(key, value, is_public) values
  ('company_name',   '"TÊN CÔNG TY CỦA BẠN"',         true),
  ('hotline',        '"0900 000 000"',                 true),
  ('contact_email',  '"lienhe@example.com"',           true),
  ('address',        '"Địa chỉ công ty"',              true),
  ('working_hours',  '"8:00 – 17:30, Thứ 2 – Thứ 7"',  true),
  -- Phương thức thanh toán: chỉ phương thức đã bật/cấu hình mới hiện ở checkout và được server chấp nhận.
  ('pay_cod_enabled','true',                           true)
  -- Bật chuyển khoản: bỏ comment 4 dòng dưới (cần ĐỦ bank_name + bank_account + bank_holder) rồi đổi dấu ',' ở dòng trên.
  -- ,('bank_name',    '"Tên ngân hàng"',               true)
  -- ,('bank_account', '"Số tài khoản"',                true)
  -- ,('bank_holder',  '"Tên chủ tài khoản"',           true)
  -- ,('bank_note',    '"Nội dung CK: mã đơn hàng"',    true)
on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_at = now();

-- Phí vận chuyển: 1 quy tắc mặc định (province = null) + tuỳ chọn theo tỉnh/thành. Không có quy tắc nào = phí 0.
-- Tên tỉnh/thành phải KHỚP (không phân biệt hoa thường) với tên khách nhập/chọn ở checkout.
-- fee = phí (VND); free_over = miễn phí khi tiền hàng (chưa VAT) từ mức này (null = không miễn phí).
insert into public.shipping_rules(province, fee, free_over) values
  (null, 0, null)          -- SỬA: phí mặc định, ví dụ 50000
on conflict do nothing;
