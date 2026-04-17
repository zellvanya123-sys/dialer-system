import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index';
import logger from '../../utils/logger';

let bot: TelegramBot | null = null;

export function initTelegramBot(): TelegramBot {
  if (!config.telegram.botToken) {
    throw new Error('Telegram bot token not configured');
  }

  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot!.sendMessage(msg.chat.id, `✅ Бот работает!\nВаш chat_id: ${msg.chat.id}`);
  });

  bot.on('polling_error', (err) => {
    logger.error(`[polling_error] ${JSON.stringify(err)}`);
  });

  logger.info('Telegram bot initialized');
  return bot;
}

export function getTelegramBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
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
  const message = `🎯 *Новый лид!*\n*Имя:* ${lead.name}\n*Телефон:* ${lead.phone}\n*Задача:* ${lead.qualification.hasTask ? '✅ Да' : '❌ Нет'}\n*Бюджет:* ${lead.qualification.hasBudget ? '✅ Есть' : '❌ Нет'}\n*Решения принимает:* ${lead.qualification.decisionMaker}\n*Планирует запуск:* ${lead.qualification.launchDate || 'неизвестно'}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendCallNotification(contact: {
  name: string;
  phone: string;
  status: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  const statusEmoji: Record<string, string> = {
    'lead': '🎯', 'reject': '❌', 'no_answer': '📞',
    'call1': '🔄', 'call2': '🔄', 'call3': '🔄', 'dont_call': '🚫',
  };
  const message = `${statusEmoji[contact.status] || '📱'} *Звонок завершен*\n*Имя:* ${contact.name}\n*Телефон:* ${contact.phone}\n*Статус:* ${contact.status}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendErrorNotification(error: string): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  await bot.sendMessage(config.telegram.adminChatId, `⚠️ *Ошибка:*\n${error}`, { parse_mode: 'Markdown' });
}
