import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index';
import { initDatabase, ContactRepository } from './core/contacts/contact.repository';
import { initDialer } from './core/dialer/dialer.module';
import { initTelegramBot } from './integrations/telegram/telegram.service';
import { initOpenAI } from './integrations/openai/openai.service';
import { initYandexTTS } from './integrations/yandex/tts.service';
import { initYandexSTT } from './integrations/yandex/stt.service';
import { initAIVoice } from './core/ai-voice/ai-voice.service';
import { startScheduler, stopScheduler } from './core/scheduler/scheduler.service';
import { contactsRouter } from './api/routes/contacts.routes';
import { callsRouter } from './api/routes/calls.routes';
import { webhooksRouter } from './api/routes/webhooks.routes';
import { uploadRouter } from './api/routes/upload.routes';
import logger from './utils/logger';

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

    if ((config.yandex.apiKey || config.yandex.iamToken) && config.yandex.folderId) {
      initYandexTTS();
      initYandexSTT();
      logger.info('✓ Yandex TTS/STT initialized');
    }

    if (config.openai.apiKey && (config.yandex.apiKey || config.yandex.iamToken)) {
      initAIVoice(config.aiVoice as any);
      logger.info('✓ AI Voice module initialized');
    }

    if (config.telegram.botToken) {
      initTelegramBot();
      logger.info('✓ Telegram bot initialized');
    }

    await startScheduler();

    app.listen(config.port, config.host || '0.0.0.0', () => {
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