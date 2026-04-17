import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    path: process.env.DATABASE_PATH || './data/dialer.db',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },

  sipuni: {
    host: process.env.SIPUNI_HOST || 'voip.sipuni.ru',
    port: process.env.SIPUNI_PORT || '443',
    user: process.env.SIPUNI_USER,
    secret: process.env.SIPUNI_SECRET,
    sipNumber: process.env.SIPUNI_SIP_NUMBER,
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

  mango: {
    host: process.env.MANGO_HOST || 'gw1.mangosip.ru',
    login: process.env.MANGO_LOGIN,
    password: process.env.MANGO_PASSWORD,
    sipNumber: process.env.MANGO_SIP_NUMBER,
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
    minHour: 9,
    maxHour: 20,
    maxAttempts: 4,
  },

  aiVoice: {
    systemPrompt: process.env.AI_SYSTEM_PROMPT || 'Ты вежливый менеджер по продажам. Ты звонишь клиенту с предложением услуги. Отвечай кратко и по делу. Не упоминай что ты AI.',
    welcomeMessage: process.env.AI_WELCOME_MESSAGE || 'Здравствуйте! Это компания XYZ. У нас для вас есть интересное предложение. У вас есть минута?',
    maxTurns: parseInt(process.env.AI_MAX_TURNS || '10'),
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '30000'),
  },

  proxy: {
    http: process.env.HTTP_PROXY,
    https: process.env.HTTPS_PROXY,
  },
};