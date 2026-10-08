// Replace these public values with the URL and publishable key from Supabase.
export const SUPABASE_URL = 'https://moyvnsmbpyphxkfqwesg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rmd3RlJk1eEMysb3BqKr9w_3vxkSQzO';

export const isSupabaseConfigured = ![
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
].some((value) => value.includes('YOUR_'));