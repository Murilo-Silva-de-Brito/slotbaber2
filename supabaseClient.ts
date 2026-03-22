import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[SlotBarber] ERRO CRÍTICO: Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas.');
  console.error('Configure as Environment Variables no painel da Vercel e faça redeploy.');
}

// [SEC] Singleton — evita "Multiple GoTrueClient instances detected"
export const supabase = createClient(
  supabaseUrl ?? '',
  supabaseAnonKey ?? ''
);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
