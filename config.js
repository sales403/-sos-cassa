/* SOS Rider V10 - configurazione pubblica frontend.
   La chiave Supabase "anon/publishable" è pensata per stare nel browser.
   NON inserire qui service_role, token Telegram o altri secret. */
window.SOS_RIDER_CONFIG = {
  apiBase: 'https://sosrider.sales-3c8.workers.dev',
  supabaseUrl: 'https://fgzlthizmysuebtsigef.supabase.co',
  supabaseAnonKey: 'INSERISCI_SUPABASE_PUBLISHABLE_KEY',
  // Tema automatico: DAY 07:00-18:29, NIGHT 18:30-06:59. L'utente può forzarlo manualmente.
  dayStartMinutes: 7 * 60,
  nightStartMinutes: 18 * 60 + 30,
  // La passkey si abilita solo dopo aver validato perfettamente email + password.
  enablePasskeys: false
};
