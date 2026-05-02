import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { enableAutoDial, disableAutoDial, getAutoDialStatus } from '../../core/scheduler/scheduler.service';
import { ContactStatus, CallResult } from '../../core/contacts/contact.model';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone';
import logger from '../../utils/logger';

let bot: TelegramBot | null = null;

function isAdmin(chatId: number): boolean {
  return String(chatId) === String(config.telegram.adminChatId);
}

function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digits = phone.replace(/\D/g, '');
  const isRussian = digits.startsWith('7') || digits.startsWith('8');
  if (isRussian && digits.length !== 11) {
    return { valid: false, error: `❌ Российский номер должен содержать 11 цифр.\nУ вас: ${digits.length} (${phone})\n\nПример: +79001234567` };
  }
  if (!isRussian && (digits.length < 10 || digits.length > 13)) {
    return { valid: false, error: `❌ Неверный номер: ${phone}\n\nПример: +79001234567` };
  }
  return { valid: true };
}

export function initTelegramBot(): TelegramBot {
  if (!config.telegram.botToken) throw new Error('Telegram bot token not configured');

  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  // ════════════════════════════════════
  // Команды
  // ════════════════════════════════════
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (text === '/start') {
      await bot?.sendMessage(chatId,
        '👋 Привет! Я бот для авто-обзвона.\n\n' +
        'Команды:\n' +
        '/stats — статистика\n' +
        '/calls — контакты на звонок\n' +
        '/status — состояние системы\n' +
        '/enable — включить автодозвон\n' +
        '/disable — выключить автодозвон\n' +
        '/add +79001234567 Имя — добавить контакт'
      );

    } else if (text === '/stats') {
      const stats = ContactRepository.getStats();
      const sm = stats.statusMap;
      const { activeCalls, enabled } = getAutoDialStatus();
      const answered = stats.logStats?.answered || 0;
      const totalLogs = stats.logStats?.total || 0;
      const dozoRate = totalLogs > 0 ? Math.round(answered / totalLogs * 100) : 0;

      await bot?.sendMessage(chatId,
        `📊 *Статистика*\n\n` +
        `${enabled ? '✅' : '⏸'} Автодозвон: *${enabled ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}*\n` +
        `📞 Активных: *${activeCalls}*\n\n` +
        `👥 Контактов: *${stats.total}*\n` +
        `🆕 Новых: *${sm['new'] || 0}*\n` +
        `🔄 В работе: *${(sm['call1'] || 0) + (sm['call2'] || 0) + (sm['call3'] || 0)}*\n` +
        `🎯 Лидов: *${sm['lead'] || 0}*\n` +
        `❌ Отказов: *${sm['reject'] || 0}*\n` +
        `📵 Нет ответа: *${sm['no_answer'] || 0}*\n\n` +
        `📋 Всего звонков: *${totalLogs}*\n` +
        `✅ Дозвонились: *${answered}* (${dozoRate}%)`,
        { parse_mode: 'Markdown' }
      );

    } else if (text === '/calls') {
      const due = ContactRepository.findDueForCall();
      if (due.length === 0) {
        await bot?.sendMessage(chatId, '📭 Нет контактов на звонок');
      } else {
        const list = due.slice(0, 10).map((c, i) =>
          `${i + 1}. ${c.name} — ${c.phone} (${c.attemptCount} поп.)`
        ).join('\n');
        await bot?.sendMessage(chatId,
          `📞 Ожидают звонка: *${due.length}*\n\n${list}`,
          { parse_mode: 'Markdown' }
        );
      }

    } else if (text === '/status') {
      const { activeCalls, enabled } = getAutoDialStatus();
      const stats = ContactRepository.getStats();
      await bot?.sendMessage(chatId,
        `🖥 *Система*\n\n` +
        `${enabled ? '✅' : '⏸'} Автодозвон: *${enabled ? 'ВКЛ' : 'ВЫКЛ'}*\n` +
        `📞 Активных звонков: *${activeCalls}*\n` +
        `👥 Контактов в базе: *${stats.total}*\n` +
        `⏰ Ожидают звонка: *${stats.dueCount}*`,
        { parse_mode: 'Markdown' }
      );

    } else if (text === '/enable') {
      if (!isAdmin(chatId)) { await bot?.sendMessage(chatId, '⛔ Нет доступа'); return; }
      enableAutoDial();
      await bot?.sendMessage(chatId, '✅ Автодозвон *ВКЛЮЧЁН*', { parse_mode: 'Markdown' });

    } else if (text === '/disable') {
      if (!isAdmin(chatId)) { await bot?.sendMessage(chatId, '⛔ Нет доступа'); return; }
      disableAutoDial();
      await bot?.sendMessage(chatId, '⏸ Автодозвон *ВЫКЛЮЧЕН*', { parse_mode: 'Markdown' });

    } else if (text.startsWith('/add')) {
      if (!isAdmin(chatId)) { await bot?.sendMessage(chatId, '⛔ Нет доступа'); return; }
      const parts = text.split(' ').filter(Boolean);
      if (parts.length < 2) {
        await bot?.sendMessage(chatId, '❌ Формат: /add +79001234567 Имя');
        return;
      }
      const rawPhone = parts[1];
      const name = parts.slice(2).join(' ') || 'Без имени';
      const check = validatePhone(rawPhone);
      if (!check.valid) { await bot?.sendMessage(chatId, check.error!); return; }

      const phone = formatPhoneForCall(rawPhone);
      const existing = ContactRepository.findByPhone(phone);
      if (existing) {
        await bot?.sendMessage(chatId, `⚠️ Номер уже есть в базе!\nИмя: ${existing.name}`);
        return;
      }

      const timezone = resolveTimezone(phone);
      const country = resolveCountry(phone) || 'RU';
      const contact = ContactRepository.create({ phone, name, timezone, country });
      await bot?.sendMessage(chatId,
        `✅ Контакт добавлен!\n👤 ${contact.name}\n📞 ${contact.phone}\n🌍 ${contact.timezone}`
      );

    } else if (text.startsWith('/')) {
      await bot?.sendMessage(chatId, '❓ Неизвестная команда. /start — список команд');
    }
  });

  // ════════════════════════════════════
  // ✅ Обработка кнопок (callback_query)
  // ════════════════════════════════════
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const data = query.data || '';

    if (!chatId || !isAdmin(chatId)) {
      await bot?.answerCallbackQuery(query.id, { text: '⛔ Нет доступа' });
      return;
    }

    // Формат: lead_action:contactId
    const [action, contactId] = data.split(':');

    if (!contactId) {
      await bot?.answerCallbackQuery(query.id, { text: '❌ Неверные данные' });
      return;
    }

    const contact = ContactRepository.findById(contactId);
    if (!contact) {
      await bot?.answerCallbackQuery(query.id, { text: '❌ Контакт не найден' });
      return;
    }

    if (action === 'lead_call') {
      // Открыть телефон для звонка
      await bot?.answerCallbackQuery(query.id, { text: `📞 Звоним ${contact.name}...` });
      await bot?.sendMessage(chatId,
        `📞 Звоним: *${contact.name}*\nНомер: \`${contact.phone}\``,
        { parse_mode: 'Markdown' }
      );

    } else if (action === 'lead_inwork') {
      // Перевести в работу
      ContactRepository.update(contactId, { status: ContactStatus.LEAD });
      await bot?.answerCallbackQuery(query.id, { text: '✅ Переведён в работу' });
      // Обновляем сообщение — убираем кнопки
      if (messageId) {
        await bot?.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '✅ В работе', callback_data: 'done' }]] },
          { chat_id: chatId, message_id: messageId }
        );
      }

    } else if (action === 'lead_reject') {
      // Отказ
      ContactRepository.update(contactId, { status: ContactStatus.REJECT });
      await bot?.answerCallbackQuery(query.id, { text: '❌ Помечен как отказ' });
      if (messageId) {
        await bot?.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '❌ Отказ', callback_data: 'done' }]] },
          { chat_id: chatId, message_id: messageId }
        );
      }

    } else if (action === 'lead_callback') {
      // Перезвонить позже
      ContactRepository.update(contactId, {
        callbackAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // +2 часа
        callbackReason: 'Запрошен перезвон из Telegram'
      });
      await bot?.answerCallbackQuery(query.id, { text: '⏰ Перезвоним через 2 часа' });

    } else {
      await bot?.answerCallbackQuery(query.id);
    }
  });

  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${JSON.stringify(err)}`);
  });

  logger.info('Telegram bot initialized with inline buttons');
  return bot;
}

export function getTelegramBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

// ════════════════════════════════════════════════
// ✅ Уведомление о новом лиде с кнопками
// ════════════════════════════════════════════════
export async function sendLeadNotification(lead: {
  name: string;
  phone: string;
  qualification?: any;
  contactId?: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;

  const q = lead.qualification || {};
  const lines = [
    `🎯 *Новый лид!*`,
    ``,
    `👤 *${lead.name}*`,
    `📞 \`${lead.phone}\``,
  ];

  // Данные квалификации военного контракта
  if (q.age) lines.push(`🎂 Возраст: ${q.age}`);
  if (q.city) lines.push(`🏙 Город: ${q.city}`);
  if (q.militaryRank) lines.push(`🎖 Звание: ${q.militaryRank}`);
  if (q.hasCombtExperience) lines.push(`⚔️ Боевой опыт: ${q.combatExperienceWhere || 'Да'}`);
  if (q.wasOnSVO !== undefined) lines.push(`🪖 Был на СВО: ${q.wasOnSVO ? 'Да' : 'Нет'}`);
  if (q.healthStatus) lines.push(`❤️ Здоровье: ${q.healthStatus}`);
  if (q.notes) lines.push(`📝 Заметки: ${q.notes}`);

  // ✅ Inline кнопки
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [[
      { text: '📞 Позвонить', callback_data: `lead_call:${lead.contactId}` },
      { text: '✅ В работу', callback_data: `lead_inwork:${lead.contactId}` },
    ], [
      { text: '⏰ Перезвонить', callback_data: `lead_callback:${lead.contactId}` },
      { text: '❌ Отказ', callback_data: `lead_reject:${lead.contactId}` },
    ]]
  };

  await bot.sendMessage(
    config.telegram.adminChatId,
    lines.join('\n'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// Уведомление о завершённом звонке
export async function sendCallNotification(contact: {
  name: string;
  phone: string;
  status: string;
}): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;

  const icons: Record<string, string> = {
    answered: '✅', lead: '🎯', reject: '❌',
    no_answer: '📵', busy: '🔔', hangup: '📴',
    answering_machine: '🤖', call1: '🔄', call2: '🔄', call3: '🔄',
  };

  const icon = icons[contact.status] || '📱';
  await bot.sendMessage(
    config.telegram.adminChatId,
    `${icon} *${contact.name}*\n📞 ${contact.phone}\nСтатус: ${contact.status}`,
    { parse_mode: 'Markdown' }
  );
}

export async function sendErrorNotification(error: string): Promise<void> {
  if (!bot || !config.telegram.adminChatId) return;
  await bot.sendMessage(config.telegram.adminChatId, `⚠️ *Ошибка:*\n${error}`, { parse_mode: 'Markdown' });
}
