import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { initDatabase, ContactRepository } from './core/contacts/contact.repository.js';
import { initDialer } from './core/dialer/dialer.module.js';
import { initTelegramBot } from './integrations/telegram/telegram.service.js';
import { initOpenAI } from './integrations/openai/openai.service.js';
import { initYandexTTS } from './integrations/yandex/tts.service.js';
import { initYandexSTT } from './integrations/yandex/stt.service.js';
import { initAIVoice } from './core/ai-voice/ai-voice.service.js';
import { startScheduler, stopScheduler } from './core/scheduler/scheduler.service.js';
import { contactsRouter } from './api/routes/contacts.routes.js';
import { callsRouter } from './api/routes/calls.routes.js';
import { webhooksRouter } from './api/routes/webhooks.routes.js';
import { uploadRouter } from './api/routes/upload.routes.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/contacts', contactsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/upload', uploadRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

async function start() {
  try {
    logger.info('Starting Dialer System...');

    initDatabase();
    logger.info('✓ Database initialized');

    if (config.sipuni.user && config.sipuni.secret) {
      initDialer('sipuni');
      logger.info('✓ Sipuni dialer initialized');
    }

    if (config.openai.apiKey) {
      initOpenAI();
      logger.info('✓ OpenAI (GPT-4o) initialized');
    }

    if (config.yandex.iamToken && config.yandex.folderId) {
      initYandexTTS();
      initYandexSTT();
      logger.info('✓ Yandex TTS/STT initialized');
    }

    if (config.mango.login && config.openai.apiKey && config.yandex.iamToken) {
      initAIVoice();
      logger.info('✓ AI Voice module initialized');
    }

    if (config.telegram.botToken) {
      initTelegramBot();
      logger.info('✓ Telegram bot initialized');
    }

    await startScheduler();

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
  } catch (error: any) {
    logger.error(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await stopScheduler();
  process.exit(0);
});

start();

export default app;