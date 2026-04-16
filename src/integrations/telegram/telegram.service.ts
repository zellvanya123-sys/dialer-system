import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';

let bot: TelegramBot | null = null;

export function initTelegramBot(): TelegramBot {
  if (!config.telegram.botToken) {
    throw new Error('Telegram bot token not configured');
  }

  bot = new TelegramBot(config.telegram.botToken, { polling: false });
  logger.info('Telegram bot initialized');
  return bot;
}

export function getTelegramBot(): TelegramBot {
  if (!bot) {
    throw new Error('Telegram bot not initialized');
  }
  return bot;
}

export async function sendLeadNotification(lead: {
  name: string;
  phone: string;
  qualification: any;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) {
    logger.warn('Telegram not configured, skipping notification');
    return;
  }

  const message = `🎯 *Новый лид!*

*Имя:* ${lead.name}
*Телефон:* ${lead.phone}
*Задача:* ${lead.qualification.hasTask ? '✅ Да' : '❌ Нет'}
*Бюджет:* ${lead.qualification.hasBudget ? '✅ Есть' : '❌ Нет'}
*Решения принимает:* ${lead.qualification.decisionMaker}
*Планирует запуск:* ${lead.qualification.launchDate || 'неизвестно'}`;

  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
  logger.info(`Lead notification sent for ${lead.phone}`);
}

export async function sendCallNotification(contact: {
  name: string;
  phone: string;
  status: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) {
    return;
  }

  const statusEmoji: Record<string, string> = {
    'lead': '🎯',
    'reject': '❌',
    'no_answer': '📞',
    'no_answer': '🤝'
  };

  const message = `${statusEmoji[contact.status] || '📱'} *Звонок завершен*

*Имя:* ${contact.name}
*Телефон:* ${contact.phone}
*Статус:* ${contact.status}`;

  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendErrorNotification(error: string): Promise<void> {
  if (!bot || !config.telegram.adminChatId) {
    return;
  }

  await bot.sendMessage(config.telegram.adminChatId, `⚠️ *Ошибка:*\n${error}`, { parse_mode: 'Markdown' });
}