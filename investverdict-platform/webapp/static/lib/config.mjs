/**
 * Supabase connection for the InvestVerdict tool.
 *
 * The publishable key is DESIGNED to ship in frontend code (it only grants
 * what Row Level Security allows — here, the iv_* tool tables). The
 * service_role key must NEVER appear in this file or anywhere client-side.
 *
 * The master site can override these at runtime without touching this file:
 *   localStorage.setItem("iv_supa", JSON.stringify({ url: "...", key: "..." }))
 */
export const SUPABASE_URL = "https://pmpyqgzvesrwoqoyhbin.supabase.co";
export const SUPABASE_KEY = "sb_publishable_IKSAhQCwejx7Dz6MSgAsmg_cjdevELv";
