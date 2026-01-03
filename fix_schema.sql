-- FIX SQL: Run this to add missing columns and tables

-- 1. Add missing 'team' column to strokes
alter table public.strokes add column if not exists team text;

-- 2. Create Leaderboard table (was missing)
create table if not exists public.leaderboard (
  id uuid primary key, -- Use the same guest_uuid
  name text,
  score int4 default 0,
  team text,
  updated_at timestamptz default now()
);

-- 3. Enable RLS (Security) - policies for public access (since we are likely using anon key)
alter table public.leaderboard enable row level security;
alter table public.strokes enable row level security;
alter table public.sessions enable row level security;

-- Allow anyone to read/write (for now, to match current server logic)
create policy "Enable all for leaderboard" on public.leaderboard for all using (true) with check (true);
create policy "Enable all for strokes" on public.strokes for all using (true) with check (true);
create policy "Enable all for sessions" on public.sessions for all using (true) with check (true);
