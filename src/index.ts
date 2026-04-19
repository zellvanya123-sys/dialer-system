import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index';
import { initDatabase } from './core/contacts/contact.repository';
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
import { basicAuth } from './api/middleware/basicAuth';
import logger from './utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ API маршруты — без basicAuth (у них свой API-ключ)
app.use('/api/contacts', contactsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/webhooks', webhooksRouter); // Sipuni шлёт сюда без авторизации
app.use('/api/upload', uploadRouter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.1.0',
  });
});

// ✅ Фронтенд — только с Basic Auth авторизацией
app.use(basicAuth);
app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

async function start() {
  try {
    logger.info('=== Starting Dialer System v1.1.0 ===');

    initDatabase();
    logger.info('✓ Database initialized');

    if (config.sipuni.user && config.sipuni.secret) {
      initDialer('sipuni');
      logger.info('✓ Sipuni dialer initialized');
    } else {
      logger.warn('⚠ Sipuni not configured — dialer disabled');
    }

    if (config.openai.apiKey) {
      initOpenAI();
      logger.info('✓ OpenAI initialized');
    } else {
      logger.warn('⚠ OpenAI not configured');
    }

    if ((config.yandex.apiKey || config.yandex.iamToken) && config.yandex.folderId) {
      initYandexTTS();
      initYandexSTT();
      logger.info('✓ Yandex TTS/STT initialized');
    } else {
      logger.warn('⚠ Yandex not configured');
    }

    if (config.openai.apiKey && (config.yandex.apiKey || config.yandex.iamToken)) {
      initAIVoice(config.aiVoice as any);
      logger.info('✓ AI Voice initialized');
    }

    if (config.telegram.botToken) {
      initTelegramBot();
      logger.info('✓ Telegram bot initialized');
    }

    await startScheduler();
    logger.info(`✓ Scheduler started (max ${config.maxConcurrentCalls} concurrent calls)`);

    // ✅ FIX #6: port теперь number
    app.listen(config.port, config.host, () => {
      logger.info(`✓ Server running on http://${config.host}:${config.port}`);
      logger.info(`✓ Dashboard: http://62.60.249.223:${config.port}`);
    });
  } catch (error: any) {
    logger.error(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

// ✅ FIX #10: Graceful shutdown для SIGINT и SIGTERM
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received — graceful shutdown...`);
  await stopScheduler();
  logger.info('Scheduler stopped');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // ✅ PM2 использует SIGTERM

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

start();

export default app;
