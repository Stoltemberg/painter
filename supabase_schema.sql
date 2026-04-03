-- ============================================================
-- Painter — Supabase SQL Schema Completo
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  1. TABELA: profiles                                    ║
-- ║  Armazena perfis de usuários autenticados                ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nickname TEXT,
    last_nickname_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para busca por nickname
CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles(nickname);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ler todos os perfis
CREATE POLICY "profiles_select_all"
    ON public.profiles FOR SELECT
    USING (true);

-- Usuários só podem inserir/atualizar seu próprio perfil
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Service role bypass completo (server-side com SUPABASE_KEY)
-- O service role já ignora RLS por padrão no Supabase.


-- ╔══════════════════════════════════════════════════════════╗
-- ║  2. TABELA: sessions                                    ║
-- ║  Sessões de conexão (guest ou autenticado)               ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_uuid TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now()
);

-- Índice para busca por guest_uuid (usado no login)
CREATE INDEX IF NOT EXISTS idx_sessions_guest_uuid ON public.sessions(guest_uuid);

-- Índice para busca por user_id (usado em /api/stats/user/:id)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

-- RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Leitura pública (leaderboard, stats)
CREATE POLICY "sessions_select_all"
    ON public.sessions FOR SELECT
    USING (true);

-- Inserção aberta (guests criam sessões sem auth)
CREATE POLICY "sessions_insert_all"
    ON public.sessions FOR INSERT
    WITH CHECK (true);

-- Update aberto (server atualiza last_seen e user_id)
CREATE POLICY "sessions_update_all"
    ON public.sessions FOR UPDATE
    USING (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  3. TABELA: strokes                                     ║
-- ║  Histórico de pixels pintados (auditoria/replay)         ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.strokes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT,              -- hex string (ex: "#ff00ff")
    team TEXT,               -- nome do time (ex: "Red", "Blue")
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para contagem de strokes por sessão (stats endpoint)
CREATE INDEX IF NOT EXISTS idx_strokes_session_id ON public.strokes(session_id);

-- Índice para queries por coordenada (replay por área)
CREATE INDEX IF NOT EXISTS idx_strokes_coords ON public.strokes(x, y);

-- Índice temporal (para replay cronológico)
CREATE INDEX IF NOT EXISTS idx_strokes_created_at ON public.strokes(created_at);

-- RLS
ALTER TABLE public.strokes ENABLE ROW LEVEL SECURITY;

-- Leitura pública (stats, replay)
CREATE POLICY "strokes_select_all"
    ON public.strokes FOR SELECT
    USING (true);

-- Inserção aberta (server insere via service role)
CREATE POLICY "strokes_insert_all"
    ON public.strokes FOR INSERT
    WITH CHECK (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  4. TABELA: leaderboard                                 ║
-- ║  Ranking global persistido (upsert por guestId)          ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.leaderboard (
    id TEXT PRIMARY KEY,     -- guestId (UUID do cliente)
    name TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    team TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para ranking (top 10)
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON public.leaderboard(score DESC);

-- RLS
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

-- Leitura pública (leaderboard)
CREATE POLICY "leaderboard_select_all"
    ON public.leaderboard FOR SELECT
    USING (true);

-- Inserção/Update aberto (server upsert via service role)
CREATE POLICY "leaderboard_insert_all"
    ON public.leaderboard FOR INSERT
    WITH CHECK (true);

CREATE POLICY "leaderboard_update_all"
    ON public.leaderboard FOR UPDATE
    USING (true);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  5. STORAGE BUCKET: pixel-board                         ║
-- ║  Armazena board.dat e team_scores.json                   ║
-- ╚══════════════════════════════════════════════════════════╝

-- Criar bucket (se não existir)
INSERT INTO storage.buckets (id, name, public)
VALUES ('pixel-board', 'pixel-board', false)
ON CONFLICT (id) DO NOTHING;

-- Permitir download do board
CREATE POLICY "pixel_board_download_all"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'pixel-board');

-- Permitir upload (INSERT) no bucket pixel-board
CREATE POLICY "pixel_board_upload_all"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'pixel-board');

-- Permitir update (upsert) no bucket pixel-board
CREATE POLICY "pixel_board_update_all"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'pixel-board');

-- Permitir delete no bucket pixel-board (para upsert/replace)
CREATE POLICY "pixel_board_delete_all"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'pixel-board');


-- ╔══════════════════════════════════════════════════════════╗
-- ║  6. FUNÇÃO: auto-update updated_at                      ║
-- ║  Trigger para atualizar timestamps automaticamente       ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger no leaderboard
CREATE TRIGGER leaderboard_updated_at
    BEFORE UPDATE ON public.leaderboard
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();


-- ╔══════════════════════════════════════════════════════════╗
-- ║  7. FUNÇÃO: auto-create profile on signup               ║
-- ║  Cria perfil automaticamente quando user faz signup      ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, nickname)
    VALUES (NEW.id, NULL)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger no auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ╔══════════════════════════════════════════════════════════╗
-- ║  8. GRANTS (permissões para roles)                      ║
-- ╚══════════════════════════════════════════════════════════╝

-- anon e authenticated podem ler todas as tabelas públicas
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.sessions TO anon, authenticated;
GRANT SELECT ON public.strokes TO anon, authenticated;
GRANT SELECT ON public.leaderboard TO anon, authenticated;

-- authenticated pode inserir/atualizar perfil próprio
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

-- anon pode inserir sessões (guests)
GRANT INSERT, UPDATE ON public.sessions TO anon, authenticated;

-- Inserção de strokes (server via service role, mas grants para safety)
GRANT INSERT ON public.strokes TO anon, authenticated;

-- Leaderboard upsert
GRANT INSERT, UPDATE ON public.leaderboard TO anon, authenticated;

-- Sequence access para bigint identity
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  RESUMO DE RECURSOS                                     ║
-- ╠══════════════════════════════════════════════════════════╣
-- ║  Tabelas:                                               ║
-- ║    • profiles     — perfil do usuário (nickname, etc)    ║
-- ║    • sessions     — sessões guest/auth                   ║
-- ║    • strokes      — histórico de pixels                  ║
-- ║    • leaderboard  — ranking global                       ║
-- ║                                                          ║
-- ║  Storage:                                                ║
-- ║    • pixel-board   — bucket para board.dat e scores      ║
-- ║                                                          ║
-- ║  Triggers:                                               ║
-- ║    • leaderboard_updated_at  — auto timestamp            ║
-- ║    • on_auth_user_created    — auto create profile       ║
-- ║                                                          ║
-- ║  Auth:                                                   ║
-- ║    • Supabase Auth nativo (email/password)               ║
-- ║    • Service Role Key para server-side operations        ║
-- ╚══════════════════════════════════════════════════════════╝
