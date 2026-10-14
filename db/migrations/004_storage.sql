-- 004_storage.sql — bucket ảnh `media` (công khai để đọc ảnh; ghi/xoá chỉ staff có quyền media.write).
-- CHỈ chạy trên Supabase thật (cần schema `storage`). Chưa kiểm thử được trên PGlite.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_staff_select on storage.objects;
drop policy if exists media_staff_insert on storage.objects;
drop policy if exists media_staff_update on storage.objects;
drop policy if exists media_staff_delete on storage.objects;

create policy media_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_staff());
create policy media_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.has_perm('media.write'));
create policy media_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.has_perm('media.write')) with check (bucket_id = 'media' and public.has_perm('media.write'));
create policy media_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.has_perm('media.write'));
