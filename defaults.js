/* Polter - default nonrahasia bersama.
   Dipakai background (importScripts) dan options.html (script tag).
   Nilai tersimpan pengguna selalu menang atas default ini. */

var JAWAB_DEFAULTS = {
  provider: 'custom',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-5',
  museMode: 'api',
  museApiKey: '',
  museModel: 'muse-spark-1.2',
  museBridgeUrl: 'https://bridge.floodcare.my.id/v1',
  museBridgeKey: '',
  museBridgeModel: 'muse-spark-1.3',
  customUrl: '',
  customKey: '',
  customModel: '',
  agentrouterUrl: 'https://agentrouter.org',
  agentrouterKey: '',
  agentrouterModel: 'claude-sonnet-4-6',
  systemPrompt: 'Kamu adalah asisten yang menjawab dengan ringkas, langsung ke inti, dan jelas dalam Bahasa Indonesia.'
};

/* Model ID diverifikasi 2026-10-12 dari dokumentasi resmi:
   - Anthropic: claude-sonnet-5 (pengganti claude-3-5-sonnet-20241022 yang pensiun 2025-10-28)
   - OpenAI: gpt-4o-mini (masih didukung)
   Semua mendukung input gambar (vision). Field ini bisa diedit bebas. */

var JAWAB_MUSE_API_URL = 'https://api.meta.ai/v1';

var JAWAB_MODEL_HINTS = {
  muse: 'cth: muse-spark-1.2 (Model API) / muse-spark-1.3 (bridge)',
  openai: 'cth: gpt-4o-mini, gpt-5-mini',
  anthropic: 'cth: claude-sonnet-5, claude-haiku-4-5',
  custom: 'ID model di endpoint custom-mu',
  agentrouter: 'cth: claude-sonnet-4-6, claude-opus-4-6'
};

var JAWAB_LIMITS = {
  maxTextChars: 100000,
  maxImageBytes: 5 * 1024 * 1024,
  maxImportItems: 2000,
  maxImportTotalBytes: 50 * 1024 * 1024,
  draftTtlMs: 7 * 24 * 60 * 60 * 1000
};
