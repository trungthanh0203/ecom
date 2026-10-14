-- 005_staff_directory.sql — danh bạ nhân viên (chỉ id + tên + vai trò) cho mọi staff đang hoạt động,
-- để chọn người phụ trách đơn/báo giá và hiện tên trong lịch sử. Không lộ email/dữ liệu khác.
create or replace function public.staff_directory()
returns table (user_id uuid, display_name text, role text)
language sql stable security definer set search_path = public as
$$ select s.user_id, coalesce(nullif(s.display_name, ''), s.role), s.role
   from staff s where s.active and public.is_staff() $$;

revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;
