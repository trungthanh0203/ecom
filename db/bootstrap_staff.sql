-- Gán vai trò cho tài khoản đã tạo ở Authentication → Users (Add user → tick "Auto confirm user").
-- Thay email cho đúng. Chạy trong SQL Editor (quyền postgres).
insert into public.staff (user_id, role, display_name)
select id, v.role, v.name
from auth.users u
join (values
  ('SUPER_ADMIN@ecom.vn', 'super_admin',   'Super Admin'),
  ('ADMIN@ecom.vn',       'admin',         'Admin thử'),
  ('EDITOR@ecom.vn',      'editor',        'Editor thử'),
  ('CONTRIB@ecom.vn',     'contributor',   'Contributor thử'),
  ('SALES@ecom.vn',       'sales',         'Sales thử'),
  ('ORDER@ecom.vn',       'order_manager', 'Order Manager thử')
) as v(email, role, name) on lower(u.email) = lower(v.email)
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name, active = true;
-- Chỉ cần dòng super_admin để dùng CMS; 5 dòng còn lại chỉ phục vụ kiểm thử phân quyền (xoá khi lên chạy thật).
