-- ============================================================
-- SlotBarber — Row Level Security (RLS)
-- Requer Supabase Auth (supabase.auth.signInWithPassword)
-- auth.uid() retorna o UUID do usuário autenticado pelo SDK
-- ============================================================

-- Ativar RLS em todas as tabelas
ALTER TABLE agendamentos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE barbeiros      ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes       ENABLE ROW LEVEL SECURITY;

-- Limpar políticas antigas antes de recriar
DROP POLICY IF EXISTS "Barbeiros podem gerenciar seus agendamentos"  ON agendamentos;
DROP POLICY IF EXISTS "Clientes podem criar agendamentos"            ON agendamentos;
DROP POLICY IF EXISTS "Barbeiros podem gerenciar seus serviços"      ON servicos;
DROP POLICY IF EXISTS "Clientes podem ver serviços"                  ON servicos;
DROP POLICY IF EXISTS "Barbeiros podem gerenciar seu perfil"         ON barbeiros;
DROP POLICY IF EXISTS "Clientes podem ver perfis de barbeiros"       ON barbeiros;
DROP POLICY IF EXISTS "Barbeiros podem ver suas assinaturas"         ON subscriptions;
DROP POLICY IF EXISTS "Barbeiros podem gerenciar seus clientes"      ON clientes;

-- ============================================================
-- AGENDAMENTOS
-- ============================================================

-- Barbeiros autenticados veem e gerenciam apenas seus próprios agendamentos
CREATE POLICY "Barbeiros podem gerenciar seus agendamentos"
ON agendamentos FOR ALL
USING (auth.uid() = barbeiro_id)
WITH CHECK (auth.uid() = barbeiro_id);

-- Qualquer visitante (anônimo) pode criar agendamentos — necessário para o fluxo público
CREATE POLICY "Clientes podem criar agendamentos"
ON agendamentos FOR INSERT
WITH CHECK (true);

-- ============================================================
-- SERVIÇOS
-- ============================================================

-- Barbeiros gerenciam apenas seus próprios serviços
CREATE POLICY "Barbeiros podem gerenciar seus serviços"
ON servicos FOR ALL
USING (auth.uid() = barbeiro_id)
WITH CHECK (auth.uid() = barbeiro_id);

-- Qualquer visitante pode visualizar serviços (tela de agendamento público)
CREATE POLICY "Clientes podem ver serviços"
ON servicos FOR SELECT
USING (true);

-- ============================================================
-- BARBEIROS (perfil)
-- ============================================================

-- Barbeiro só acessa e edita seu próprio perfil
CREATE POLICY "Barbeiros podem gerenciar seu perfil"
ON barbeiros FOR ALL
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Qualquer visitante pode ler perfis de barbeiros (necessário para página pública /:slug)
CREATE POLICY "Clientes podem ver perfis de barbeiros"
ON barbeiros FOR SELECT
USING (true);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================

-- Barbeiro só lê suas próprias assinaturas
CREATE POLICY "Barbeiros podem ver suas assinaturas"
ON subscriptions FOR SELECT
USING (auth.uid() = barber_id);

-- ============================================================
-- CLIENTES
-- ============================================================

-- Barbeiros gerenciam apenas seus próprios clientes
CREATE POLICY "Barbeiros podem gerenciar seus clientes"
ON clientes FOR ALL
USING (auth.uid() = barbeiro_id)
WITH CHECK (auth.uid() = barbeiro_id);
