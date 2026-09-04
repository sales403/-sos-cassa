/* SOS Rider V10 - configurazione pubblica frontend.
   La chiave Supabase "anon/publishable" è pensata per stare nel browser.
   NON inserire qui service_role, token Telegram o altri secret. */
window.SOS_RIDER_CONFIG = {
  apiBase: 'https://sosrider.sales-3c8.workers.dev',
  supabaseUrl: 'https://fgzlthizmysuebtsigef.supabase.co',
  supabaseAnonKey: 'sb_publishable_uFXzct6v_LB8qTvcSCQi1w_YJsg9CTO',
  // Tema automatico: DAY 07:00-18:29, NIGHT 18:30-06:59. L'utente può forzarlo manualmente.
  dayStartMinutes: 7 * 60,
  nightStartMinutes: 18 * 60 + 30,
  // Web Push: chiave pubblica VAPID (sicura da esporre nel frontend).
  vapidPublicKey: 'BIyQVvPNTE1Tbwb2GgWsnCigIEiJ7-PSIzVTnzG89IXGWKKzf3huZuBfCKgtBSciumT8TTaxqaMFAJygpm4Xl0c',
  // La passkey si abilita solo dopo aver validato perfettamente email + password.
  enablePasskeys: false
};
