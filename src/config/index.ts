import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  maxConcurrentCalls: parseInt(process.env.MAX_CONCURRENT_CALLS || '3'),

  database: {
    path: process.env.DATABASE_PATH || './data/dialer.db',
  },

  // ✅ МТС Exolve (новый провайдер)
  exolve: {
    apiKey: process.env.EXOLVE_API_KEY || '',
    phoneNumber: process.env.EXOLVE_PHONE_NUMBER || '',
    webhookSecret: process.env.EXOLVE_WEBHOOK_SECRET || '',
  },

  // Sipuni (старый провайдер — оставлен для совместимости)
  sipuni: {
    host: process.env.SIPUNI_HOST || 'voip.sipuni.ru',
    port: process.env.SIPUNI_PORT || '443',
    user: process.env.SIPUNI_USER,
    secret: process.env.SIPUNI_SECRET,
    sipNumber: process.env.SIPUNI_SIP_NUMBER,
    webhookSecret: process.env.SIPUNI_WEBHOOK_SECRET || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },

  yandex: {
    sttUrl: 'https://stt.api.cloud.yandex.net/speechkit/stt/v2',
    ttsUrl: 'https://tts.api.cloud.yandex.net/cloud/tts/v2',
    iamToken: process.env.YANDEX_IAM_TOKEN,
    apiKey: process.env.YANDEX_API_KEY,
    folderId: process.env.YANDEX_FOLDER_ID,
    voice: process.env.YANDEX_VOICE || 'oksana',
    format: 'mp3',
    lang: 'ru-RU',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
  },

  googleSheets: {
    clientId: process.env.GOOGLE_SHEETS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_SHEETS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_SHEETS_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  },

  callSettings: {
    minHour: parseInt(process.env.CALL_MIN_HOUR || '9'),
    maxHour: parseInt(process.env.CALL_MAX_HOUR || '20'),
    maxAttempts: parseInt(process.env.CALL_MAX_ATTEMPTS || '4'),
  },

  aiVoice: {
    systemPrompt: process.env.AI_SYSTEM_PROMPT || 'Ты вежливый менеджер по продажам.',
    welcomeMessage: process.env.AI_WELCOME_MESSAGE || 'Здравствуйте! У вас есть минута?',
    maxTurns: parseInt(process.env.AI_MAX_TURNS || '12'),
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '180000'),
  },

  proxy: {
    http: process.env.HTTP_PROXY,
    https: process.env.HTTPS_PROXY,
  },

  dashboard: {
    login: process.env.DASHBOARD_LOGIN || 'admin',
    password: process.env.DASHBOARD_PASSWORD || 'dialer123',
  },
};
