-- FIX STORAGE: Run this to create the bucket and policies

-- 1. Create Bucket 'pixel-board' if not exists
insert into storage.buckets (id, name, public)
values ('pixel-board', 'pixel-board', true)
on conflict (id) do nothing;

-- 2. Enable RLS (just in case)
alter table storage.objects enable row level security;

-- 3. Create Update Policies (Permissive for Demo)
-- Allow public access to read
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'pixel-board' );

-- Allow public access to upload (anon)
create policy "Public Upload"
on storage.objects for insert
with check ( bucket_id = 'pixel-board' );

-- Allow updating/deleting (optional, good for cleanup)
create policy "Public Update"
on storage.objects for update
using ( bucket_id = 'pixel-board' );

create policy "Public Delete"
on storage.objects for delete
using ( bucket_id = 'pixel-board' );
