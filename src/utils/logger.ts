import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Создаём папку для логов если нет
const logDir = './data/logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, json, colorize, simple, printf } = winston.format;

// Формат для файлов
const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  json()
);

// Формат для консоли
const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Консоль
    new winston.transports.Console({ format: consoleFormat }),

    // ✅ FIX #20: Все логи в файл с ротацией по дате
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB — ротация
      maxFiles: 7,               // хранить 7 файлов (неделя)
      tailable: true,
    }),

    // Только ошибки отдельно
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 14,
      tailable: true,
    }),
  ],
});

// В продакшне не показываем stack traces в консоли
if (process.env.NODE_ENV === 'production') {
  logger.exceptions.handle(
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      format: fileFormat,
    })
  );
}

export default logger;
