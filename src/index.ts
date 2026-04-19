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

// ✅ FIX #29: Rate Limiting без внешних пакетов — простой in-memory лимитер
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests = 100, windowMs = 60000) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      logger.warn(`Rate limit exceeded for IP: ${ip}`);
      return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
    }
    next();
  };
}

// Очистка map раз в 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ Rate limiting — 200 запросов в минуту на IP
app.use('/api', rateLimit(200, 60000));

// API маршруты — без basicAuth
app.use('/api/contacts', contactsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/upload', uploadRouter);

app.get('/api/health', (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m`,
    version: '1.2.0',
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  });
});

// Фронтенд — только с Basic Auth
app.use(basicAuth);
app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

async function start() {
  try {
    logger.info('=== Starting Dialer System v1.2.0 ===');

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
    }

    if ((config.yandex.apiKey || config.yandex.iamToken) && config.yandex.folderId) {
      initYandexTTS();
      initYandexSTT();
      logger.info('✓ Yandex TTS/STT initialized');
    }

    if (config.openai.apiKey && (config.yandex.apiKey || config.yandex.iamToken)) {
      initAIVoice(config.aiVoice as any);
      logger.info('✓ AI Voice initialized with sentiment analysis & personalization');
    }

    if (config.telegram.botToken) {
      initTelegramBot();
      logger.info('✓ Telegram bot initialized');
    }

    await startScheduler();
    logger.info(`✓ Scheduler started (max ${config.maxConcurrentCalls} concurrent calls)`);

    app.listen(config.port, config.host, () => {
      logger.info(`✓ Server on http://${config.host}:${config.port}`);
    });
  } catch (error: any) {
    logger.error(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`${signal} — graceful shutdown...`);
  await stopScheduler();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => logger.error(`Uncaught: ${err.message}`));
process.on('unhandledRejection', (r) => logger.error(`Unhandled rejection: ${r}`));

start();
export default app;
