import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { enableAutoDial, disableAutoDial, getAutoDialStatus } from '../../core/scheduler/scheduler.service';
import { ContactStatus } from '../../core/contacts/contact.model';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone';
import logger from '../../utils/logger';

let bot: TelegramBot | null = null;

// ✅ Проверка что пишет админ
function isAdmin(chatId: number): boolean {
  return String(chatId) === String(config.telegram.adminChatId);
}

// ✅ Строгая валидация телефона
function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digits = phone.replace(/\D/g, '');
  const isRussian = digits.startsWith('7') || digits.startsWith('8');

  if (isRussian && digits.length !== 11) {
    return {
      valid: false,
      error: `❌ Российский номер должен содержать 11 цифр.\nУ вас: ${digits.length} цифр (${phone})\n\nПравильно: +79001234567`
    };
  }

  if (!isRussian && (digits.length < 10 || digits.length > 13)) {
    return {
      valid: false,
      error: `❌ Неверный номер: ${phone}\nЦифр: ${digits.length} (нужно 10-13)\n\nПример: +79001234567`
    };
  }

  return { valid: true };
}

export function initTelegramBot(): TelegramBot {
  if (!config.telegram.botToken) {
    throw new Error('Telegram bot token not configured');
  }

  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    logger.info(`Telegram received: ${text} from ${chatId}`);

    // /start
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

    // /stats
    } else if (text === '/stats') {
      const all = ContactRepository.findAll();
      const leads = all.filter(c => c.status === ContactStatus.LEAD).length;
      const rejected = all.filter(c => c.status === ContactStatus.REJECT).length;
      const noAnswer = all.filter(c => c.status === ContactStatus.NO_ANSWER).length;
      const newContacts = all.filter(c => c.status === ContactStatus.NEW).length;
      const totalCalls = all.reduce((sum, c) => sum + (c.attemptCount || 0), 0);
      const logs = ContactRepository.findAllCallLogs();
      const { activeCalls, enabled } = getAutoDialStatus();

      await bot?.sendMessage(chatId,
        `📊 Статистика:\n\n` +
        `${enabled ? '✅' : '⏸'} Автодозвон: ${enabled ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}\n` +
        `📞 Активных звонков: ${activeCalls}\n\n` +
        `👥 Всего контактов: ${all.length}\n` +
        `🆕 Новых: ${newContacts}\n` +
        `🎯 Лидов: ${leads}\n` +
        `❌ Отказов: ${rejected}\n` +
        `📵 Не ответили: ${noAnswer}\n\n` +
        `📱 Всего звонков: ${totalCalls}\n` +
        `📋 Логов в БД: ${logs.length}`
      );

    // /calls
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

    // /status
    } else if (text === '/status') {
      const { activeCalls, enabled } = getAutoDialStatus();
      const all = ContactRepository.findAll();
      const due = ContactRepository.findDueForCall();

      await bot?.sendMessage(chatId,
        `🖥 Состояние системы:\n\n` +
        `${enabled ? '✅' : '⏸'} Автодозвон: ${enabled ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}\n` +
        `📞 Активных звонков: ${activeCalls}\n` +
        `👥 Контактов в базе: ${all.length}\n` +
        `⏰ Ожидают звонка: ${due.length}`
      );

    // /enable
    } else if (text === '/enable') {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }
      enableAutoDial();
      await bot?.sendMessage(chatId, '✅ Автодозвон ВКЛЮЧЁН');
      logger.info(`Auto-dial enabled by Telegram admin`);

    // /disable
    } else if (text === '/disable') {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }
      disableAutoDial();
      await bot?.sendMessage(chatId, '⏸ Автодозвон ВЫКЛЮЧЕН');
      logger.info(`Auto-dial disabled by Telegram admin`);

    // /add +79001234567 Иван
    } else if (text.startsWith('/add')) {
      if (!isAdmin(chatId)) {
        await bot?.sendMessage(chatId, '⛔ Нет доступа');
        return;
      }

      const parts = text.split(' ').filter(Boolean);
      if (parts.length < 2) {
        await bot?.sendMessage(chatId,
          '❌ Неверный формат.\n\nИспользуй:\n/add +79001234567 Имя\n\nПример:\n/add +79001234567 Иван Петров'
        );
        return;
      }

      const rawPhone = parts[1];
      const name = parts.slice(2).join(' ') || 'Без имени';

      // ✅ Строгая валидация
      const phoneCheck = validatePhone(rawPhone);
      if (!phoneCheck.valid) {
        await bot?.sendMessage(chatId, phoneCheck.error!);
        return;
      }

      const phone = formatPhoneForCall(rawPhone);

      // ✅ Проверка дублей
      const existing = ContactRepository.findAll().find(c =>
        c.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')
      );
      if (existing) {
        await bot?.sendMessage(chatId,
          `⚠️ Номер ${phone} уже есть в базе!\nИмя: ${existing.name}`
        );
        return;
      }

      // ✅ Timezone определяется автоматически по номеру (не всегда Moscow!)
      const timezone = resolveTimezone(phone);
      const country = resolveCountry(phone) || 'RU';

      const contact = ContactRepository.create({ phone, name, timezone, country });

      await bot?.sendMessage(chatId,
        `✅ Контакт добавлен!\n\n` +
        `👤 Имя: ${contact.name}\n` +
        `📞 Телефон: ${contact.phone}\n` +
        `🌍 Часовой пояс: ${contact.timezone}\n` +
        `🆔 ID: ${contact.id}`
      );
      logger.info(`Contact added via Telegram: ${contact.name} (${contact.phone}), tz: ${timezone}`);

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
    `*Задача:* ${lead.qualification?.hasTask ? '✅ Да' : '❌ Нет'}\n` +
    `*Бюджет:* ${lead.qualification?.hasBudget ? '✅ Есть' : '❌ Нет'}\n` +
    `*Решения принимает:* ${lead.qualification?.decisionMaker || '—'}\n` +
    `*Планирует запуск:* ${lead.qualification?.launchDate || 'неизвестно'}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendCallNotification(contact: {
  name: string;
  phone: string;
  status: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  const statusEmoji: Record<string, string> = {
    'answered': '✅', 'lead': '🎯', 'reject': '❌',
    'no_answer': '📞', 'busy': '🔔', 'hangup': '📵',
    'call1': '🔄', 'call2': '🔄', 'call3': '🔄', 'dont_call': '🚫',
  };
  const message =
    `${statusEmoji[contact.status] || '📱'} *Звонок завершён*\n` +
    `*Имя:* ${contact.name}\n` +
    `*Телефон:* ${contact.phone}\n` +
    `*Статус:* ${contact.status}`;
  await bot.sendMessage(config.telegram.adminChatId, message, { parse_mode: 'Markdown' });
}

export async function sendErrorNotification(error: string): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  await bot.sendMessage(config.telegram.adminChatId, `⚠️ *Ошибка:*\n${error}`, { parse_mode: 'Markdown' });
}
