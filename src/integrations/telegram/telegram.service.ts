import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { enableAutoDial, disableAutoDial, getAutoDialStatus } from '../../core/scheduler/scheduler.service';
import { ContactStatus } from '../../core/contacts/contact.model';
import logger from '../../utils/logger';

let bot: TelegramBot | null = null;

// ✅ Проверка что пишет админ
function isAdmin(chatId: number): boolean {
  return String(chatId) === String(config.telegram.adminChatId);
}

export function initTelegramBot(): TelegramBot {
  if (!config.telegram.botToken) {
    throw new Error('Telegram bot token not configured');
  }

  bot = new TelegramBot(config.telegram.botToken, {
    polling: true
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    logger.info(`Telegram received: ${text} from ${chatId}`);

    // /start — приветствие
    if (text === '/start') {
      await bot?.sendMessage(chatId,
        '👋 Привет! Я бот для авто-обзвона.\n\n' +
        'Команды:\n' +
        '/start — это сообщение\n' +
        '/stats — статистика звонков\n' +
        '/calls — контакты на звонок\n' +
        '/status — состояние системы\n' +
        '/enable — включить автодозвон\n' +
        '/disable — выключить автодозвон\n' +
        '/add +79001234567 Имя — добавить контакт'
      );

    // /stats — статистика
    } else if (text === '/stats') {
      const all = ContactRepository.findAll();
      const leads = all.filter(c => c.status === ContactStatus.LEAD).length;
      const rejected = all.filter(c => c.status === ContactStatus.REJECT).length;
      const noAnswer = all.filter(c => c.status === ContactStatus.NO_ANSWER).length;
      const newContacts = all.filter(c => c.status === ContactStatus.NEW).length;
      const totalCalls = all.reduce((sum, c) => sum + (c.attemptCount || 0), 0);
      const logs = ContactRepository.findAllCallLogs();

      await bot?.sendMessage(chatId,
        `📊 Статистика:\n\n` +
        `👥 Всего контактов: ${all.length}\n` +
        `🆕 Новых: ${newContacts}\n` +
        `🎯 Лидов: ${leads}\n` +
        `❌ Отказов: ${rejected}\n` +
        `📞 Не ответили: ${noAnswer}\n\n` +
        `📱 Всего звонков: ${totalCalls}\n` +
        `📋 Логов в БД: ${logs.length}`
      );

    // /calls — список контактов на звонок
    } else if (text === '/calls') {
      const due = ContactRepository.findDueForCall();
      if (due.length === 0) {
        await bot?.sendMessage(chatId, '📭 Нет контактов на звонок');
      } else {
        const list = due.slice(0, 10).map((c, i) =>
          `${i + 1}. ${c.name} — ${c.phone} (попыток: ${c.attemptCount})`
        ).join('\n');
        await bot?.sendMessage(chatId,
          `📞 Контакты на звонок (${due.length} всего, первые 10):\n\n${list}`
        );
      }

    // /status — состояние системы
    } else if (text === '/status') {
      const dialStatus = getAutoDialStatus();
      const all = ContactRepository.findAll();
      const due = ContactRepository.findDueForCall();
      const statusEmoji = dialStatus.enabled ? '✅' : '⏸';

      await bot?.sendMessage(chatId,
        `🖥 Состояние системы:\n\n` +
        `${statusEmoji} Автодозвон: ${dialStatus.enabled ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}\n` +
        `📞 Активных звонков: ${dialStatus.activeCalls}\n` +
        `👥 Контактов в базе: ${all.length}\n` +
        `⏰ Ожидают звонка: ${due.length}`
      );

    // /enable — включить автодозвон
    } else if (text === '/enable') {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }
      enableAutoDial();
      await bot?.sendMessage(chatId, '✅ Автодозвон ВКЛЮЧЁН');
      logger.info(`Auto-dial enabled by Telegram admin`);

    // /disable — выключить автодозвон
    } else if (text === '/disable') {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }
      disableAutoDial();
      await bot?.sendMessage(chatId, '⏸ Автодозвон ВЫКЛЮЧЕН');
      logger.info(`Auto-dial disabled by Telegram admin`);

    // /add +79001234567 Иван — добавить контакт
    } else if (text.startsWith('/add')) {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }

      // Парсим: /add +79001234567 Иван Иванов
      const parts = text.split(' ').filter(Boolean);
      if (parts.length < 2) {
        await bot?.sendMessage(chatId,
          '❌ Неверный формат.\n\nИспользуй:\n/add +79001234567 Имя\n\nПример:\n/add +79001234567 Иван Петров'
        );
        return;
      }

      const phone = parts[1];
      const name = parts.slice(2).join(' ') || 'Без имени';

      // Проверяем формат телефона
      if (!phone.match(/^\+?[0-9]{10,15}$/)) {
        await bot?.sendMessage(chatId, `❌ Неверный формат телефона: ${phone}\n\nПример: +79001234567`);
        return;
      }

      // Проверяем нет ли уже такого контакта
      const existing = ContactRepository.findAll().find(c =>
        c.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')
      );
      if (existing) {
        await bot?.sendMessage(chatId, `⚠️ Контакт с номером ${phone} уже есть в базе (${existing.name})`);
        return;
      }

      const contact = ContactRepository.create({
        phone,
        name,
        timezone: 'Europe/Moscow',
        country: 'RU',
      });

      await bot?.sendMessage(chatId,
        `✅ Контакт добавлен!\n\n` +
        `👤 Имя: ${contact.name}\n` +
        `📞 Телефон: ${contact.phone}\n` +
        `🆔 ID: ${contact.id}`
      );
      logger.info(`Contact added via Telegram: ${contact.name} (${contact.phone})`);

    // Неизвестная команда
    } else if (text.startsWith('/')) {
      await bot?.sendMessage(chatId,
        '❓ Неизвестная команда. Напиши /start чтобы увидеть список команд.'
      );
    }
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
  const message =
    `🎯 *Новый лид!*\n` +
    `*Имя:* ${lead.name}\n` +
    `*Телефон:* ${lead.phone}\n` +
    `*Задача:* ${lead.qualification.hasTask ? '✅ Да' : '❌ Нет'}\n` +
    `*Бюджет:* ${lead.qualification.hasBudget ? '✅ Есть' : '❌ Нет'}\n` +
    `*Решения принимает:* ${lead.qualification.decisionMaker}\n` +
    `*Планирует запуск:* ${lead.qualification.launchDate || 'неизвестно'}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendCallNotification(contact: {
  name: string;
  phone: string;
  status: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  const statusEmoji: Record<string, string> = {
    'answered': '✅',
    'lead': '🎯',
    'reject': '❌',
    'no_answer': '📞',
    'busy': '🔔',
    'hangup': '📵',
    'call1': '🔄',
    'call2': '🔄',
    'call3': '🔄',
    'dont_call': '🚫',
  };
  const emoji = statusEmoji[contact.status] || '📱';
  const message =
    `${emoji} *Звонок завершён*\n` +
    `*Имя:* ${contact.name}\n` +
    `*Телефон:* ${contact.phone}\n` +
    `*Статус:* ${contact.status}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendErrorNotification(error: string): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  await bot.sendMessage(config.telegram.adminChatId, `⚠️ *Ошибка:*\n${error}`, { parse_mode: 'Markdown' });
}
