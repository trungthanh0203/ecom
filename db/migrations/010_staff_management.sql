-- 010_staff_management.sql — quản lý nhân sự: chống tự đổi quyền, hồ sơ cá nhân, danh bạ đầy đủ cho nhật ký, ghi nhật ký từ API quản trị.
-- Việc TẠO/KHOÁ tài khoản đăng nhập cần khoá service_role nên nằm ở Worker (/api/admin/*); DB giữ các quy tắc không thể bỏ qua.

alter table public.staff add constraint staff_display_name_len check (display_name is null or char_length(display_name) <= 80);

-- Người dùng không được tự đổi vai trò / tự khoá chính mình qua API dữ liệu (kể cả Super Admin). Lệnh từ service_role (auth.uid() null) do API quản trị tự kiểm.
create or replace function public.staff_self_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() = old.user_id and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'SELF_CHANGE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_staff_self_guard before update on public.staff for each row execute function public.staff_self_guard();

-- Mỗi nhân viên tự đổi tên hiển thị của mình (không cần quyền staff.manage)
create or replace function public.update_my_profile(p_name text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_NAME' using errcode = 'P0001'; end if;
  update staff set display_name = trim(p_name) where user_id = auth.uid();
end $$;
revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated;

-- Danh bạ ĐẦY ĐỦ (cả người đã khoá) để hiện tên trong nhật ký thao tác; chỉ người có quyền xem nhật ký hoặc quản lý nhân sự
create or replace function public.staff_directory_all() returns table (user_id uuid, display_name text, role text, active boolean)
language sql stable security definer set search_path = public as
$$ select s.user_id, coalesce(nullif(s.display_name, ''), s.role), s.role, s.active from staff s
   where public.has_perm('audit.read') or public.has_perm('staff.manage') $$;
revoke all on function public.staff_directory_all() from public, anon;
grant execute on function public.staff_directory_all() to authenticated;

-- Worker (service_role) ghi nhật ký kèm NGƯỜI THỰC HIỆN thật (trigger không biết người dùng khi lệnh đến từ service_role)
create or replace function public.log_admin_action(p_actor uuid, p_action text, p_target uuid, p_detail jsonb) returns void
language sql volatile security definer set search_path = public as
$$ insert into audit_logs(actor, action, entity, entity_id, diff) values (p_actor, left(p_action, 60), 'staff_admin', p_target::text, p_detail) $$;
revoke all on function public.log_admin_action(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_admin_action(uuid, text, uuid, jsonb) to service_role;
