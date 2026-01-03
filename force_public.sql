-- FORCE PUBLIC ACCESS
-- Sometimes the initial create leaves it private if it existed before.

update storage.buckets
set public = true
where id = 'pixel-board';

-- Ensure RLS doesn't block "Select" (Read)
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'pixel-board' );

-- Ensure RLS doesn't block "Insert" (Upload)
drop policy if exists "Public Upload" on storage.objects;
create policy "Public Upload"
on storage.objects for insert
with check ( bucket_id = 'pixel-board' );
