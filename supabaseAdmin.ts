import { createClient } from '@supabase/supabase-js';

// [SEC] Este cliente usa a SERVICE_ROLE_KEY — NUNCA importar em arquivos do frontend
// Usar apenas em server.ts ou Edge Functions
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[SlotBarber] supabaseAdmin: variáveis de ambiente ausentes. Operações admin não funcionarão.');
}

export const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;
