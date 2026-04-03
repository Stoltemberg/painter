-- ============================================================
-- Painter — Supabase SQL Schema Completo (Idempotente)
-- Execute no SQL Editor do Supabase Dashboard
-- Seguro para re-executar: usa DROP IF EXISTS + CREATE
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  1. TABELA: profiles                                    ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nickname TEXT,
    last_nickname_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles(nickname);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all"
    ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id) WITH CHECK (auth.uid() = id);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  2. TABELA: sessions                                    ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_uuid TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_guest_uuid ON public.sessions(guest_uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_all" ON public.sessions;
CREATE POLICY "sessions_select_all"
    ON public.sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "sessions_insert_all" ON public.sessions;
CREATE POLICY "sessions_insert_all"
    ON public.sessions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "sessions_update_all" ON public.sessions;
CREATE POLICY "sessions_update_all"
    ON public.sessions FOR UPDATE USING (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  3. TABELA: strokes                                     ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.strokes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT,
    team TEXT,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strokes_session_id ON public.strokes(session_id);
CREATE INDEX IF NOT EXISTS idx_strokes_coords ON public.strokes(x, y);
CREATE INDEX IF NOT EXISTS idx_strokes_created_at ON public.strokes(created_at);

ALTER TABLE public.strokes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strokes_select_all" ON public.strokes;
CREATE POLICY "strokes_select_all"
    ON public.strokes FOR SELECT USING (true);

DROP POLICY IF EXISTS "strokes_insert_all" ON public.strokes;
CREATE POLICY "strokes_insert_all"
    ON public.strokes FOR INSERT WITH CHECK (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  4. TABELA: leaderboard                                 ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.leaderboard (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    team TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON public.leaderboard(score DESC);

ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leaderboard_select_all" ON public.leaderboard;
CREATE POLICY "leaderboard_select_all"
    ON public.leaderboard FOR SELECT USING (true);

DROP POLICY IF EXISTS "leaderboard_insert_all" ON public.leaderboard;
CREATE POLICY "leaderboard_insert_all"
    ON public.leaderboard FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "leaderboard_update_all" ON public.leaderboard;
CREATE POLICY "leaderboard_update_all"
    ON public.leaderboard FOR UPDATE USING (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  5. STORAGE BUCKET: pixel-board                         ║
-- ╚══════════════════════════════════════════════════════════╝

INSERT INTO storage.buckets (id, name, public)
VALUES ('pixel-board', 'pixel-board', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "pixel_board_download_all" ON storage.objects;
CREATE POLICY "pixel_board_download_all"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'pixel-board');

DROP POLICY IF EXISTS "pixel_board_upload_all" ON storage.objects;
CREATE POLICY "pixel_board_upload_all"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'pixel-board');

DROP POLICY IF EXISTS "pixel_board_update_all" ON storage.objects;
CREATE POLICY "pixel_board_update_all"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'pixel-board');

DROP POLICY IF EXISTS "pixel_board_delete_all" ON storage.objects;
CREATE POLICY "pixel_board_delete_all"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'pixel-board');


-- ╔══════════════════════════════════════════════════════════╗
-- ║  6. TRIGGERS                                            ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leaderboard_updated_at ON public.leaderboard;
CREATE TRIGGER leaderboard_updated_at
    BEFORE UPDATE ON public.leaderboard
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, nickname)
    VALUES (NEW.id, NULL)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ╔══════════════════════════════════════════════════════════╗
-- ║  7. GRANTS                                              ║
-- ╚══════════════════════════════════════════════════════════╝

GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.sessions TO anon, authenticated;
GRANT SELECT ON public.strokes TO anon, authenticated;
GRANT SELECT ON public.leaderboard TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT INSERT, UPDATE ON public.sessions TO anon, authenticated;
GRANT INSERT ON public.strokes TO anon, authenticated;
GRANT INSERT, UPDATE ON public.leaderboard TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
