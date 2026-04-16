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
    host: process.env.SIPUNI_HOST || 'sipuni.com',
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
    minHour: 9,
    maxHour: 20,
    maxAttempts: 4,
  },
};