import { Contact, ContactStatus, CallResult } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { getNextCallTime, RETRY_STRATEGIES, shouldCallContact } from './retry-strategies';
import { getDialer } from '../dialer/dialer.module';
import { isWithinWorkingHours } from './timezone';
import { config } from '../../config/index';
import logger from '../../utils/logger';
import fs from 'fs';

let callSchedulerInterval: NodeJS.Timeout | null = null;
let isAutoDialEnabled = false;
let activeCalls = 0;
const STATE_FILE = './data/scheduler-state.json';

// ✅ Сохраняем состояние в файл — переживает pm2 restart
function saveState(): void {
  try {
    const state = { activeCalls, isAutoDialEnabled };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e: any) {
    logger.warn(`Failed to save scheduler state: ${e.message}`);
  }
}

// ✅ Загружаем состояние при старте
function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      activeCalls = 0; // При рестарте сбрасываем — звонки уже завершились
      isAutoDialEnabled = state.isAutoDialEnabled ?? false;
      logger.info(`Scheduler state loaded: autoDialEnabled=${isAutoDialEnabled}`);
      saveState();
    }
  } catch (e: any) {
    logger.warn(`Failed to load scheduler state: ${e.message}`);
  }
}

loadState();

export function enableAutoDial() {
  isAutoDialEnabled = true;
  saveState();
  logger.info('Auto-dial enabled');
}

export function disableAutoDial() {
  isAutoDialEnabled = false;
  saveState();
  logger.info('Auto-dial disabled');
}

export function getAutoDialStatus() {
  return { enabled: isAutoDialEnabled, activeCalls };
}

// ✅ FIX #2: Явный инкремент для ручных звонков с дашборда
export function incrementActiveCalls() {
  activeCalls++;
  saveState();
  logger.info(`Active calls incremented: ${activeCalls}`);
}

export async function startScheduler(): Promise<void> {
  if (callSchedulerInterval) return;

  callSchedulerInterval = setInterval(async () => {
    if (isAutoDialEnabled) {
      await processDueCalls();
    }
  }, 30000);

  logger.info('Scheduler started');
}

export async function stopScheduler(): Promise<void> {
  if (callSchedulerInterval) {
    clearInterval(callSchedulerInterval);
    callSchedulerInterval = null;
  }
  logger.info('Scheduler stopped');
}

async function processDueCalls(): Promise<void> {
  if (!isAutoDialEnabled) return;

  // ✅ FIX #48: MAX_CONCURRENT_CALLS из config (настраивается через .env)
  const MAX_CONCURRENT = config.maxConcurrentCalls;
  if (activeCalls >= MAX_CONCURRENT) return;

  // ✅ FIX #9/#22: Проверяем рабочее время по московскому времени (основа)
  if (!isWithinWorkingHours('Europe/Moscow')) {
    logger.info('Outside working hours (Moscow), skipping');
    return;
  }

  const contacts = ContactRepository.findDueForCall();
  const now = new Date().toISOString();

  // ✅ FIX #29: Фильтруем только те у кого nextCallAt уже прошёл
  const readyContacts = contacts.filter(c =>
    !c.nextCallAt || c.nextCallAt <= now
  );

  const contactsToCall = readyContacts.slice(0, MAX_CONCURRENT - activeCalls);

  for (const contact of contactsToCall) {
    if (activeCalls >= MAX_CONCURRENT) break;

    if (shouldCallContact(contact)) {
      try {
        logger.info(`Auto-dialing: ${contact.name} (${contact.phone})`);
        const dialer = getDialer();
        await dialer.makeCall(contact.id);

        activeCalls++;
        saveState();
        logger.info(`Active calls: ${activeCalls}`);

        ContactRepository.update(contact.id, {
          lastCallAt: new Date().toISOString(),
          status: ContactStatus.CALL_1,
        });

        // ✅ FIX #2: Fallback 5 минут для авто-звонков
        setTimeout(() => {
          if (activeCalls > 0) {
            activeCalls--;
            saveState();
            logger.warn(`Auto-dial fallback timer: decremented activeCalls to ${activeCalls}`);
          }
        }, 5 * 60 * 1000);

      } catch (error: any) {
        logger.error(`Error auto-dialing: ${error.message}`);
      }
    }
  }
}

export async function scheduleAllDueCalls(): Promise<number> {
  const contacts = ContactRepository.findDueForCall();
  return contacts.length;
}

export async function handleCallResult(
  contactId: string,
  result: CallResult,
  qualification?: Contact['qualification']
): Promise<void> {
  const contact = ContactRepository.findById(contactId);
  if (!contact) {
    logger.error(`Contact not found: ${contactId}`);
    return;
  }

  const strategyName = (contact as any).retryStrategy || 'short';
  const strategy = RETRY_STRATEGIES[strategyName] || RETRY_STRATEGIES['short'];

  // Лид с квалификацией
  if (result === CallResult.ANSWERED && qualification) {
    ContactRepository.update(contactId, {
      status: ContactStatus.LEAD,
      lastCallResult: result,
      lastCallAt: new Date().toISOString(),
      qualification,
    });
    logger.info(`Contact ${contactId} converted to LEAD`);
    return;
  }

  // Ответил но без квалификации — просто фиксируем
  if (result === CallResult.ANSWERED) {
    ContactRepository.update(contactId, {
      lastCallResult: result,
      lastCallAt: new Date().toISOString(),
      attemptCount: contact.attemptCount + 1,
    });
    return;
  }

  // Нет ответа / занято — retry
  if (result === CallResult.NO_ANSWER || result === CallResult.BUSY || result === CallResult.MACHINE) {
    const nextAttempt = contact.attemptCount + 1;

    if (nextAttempt >= strategy.maxAttempts) {
      ContactRepository.update(contactId, {
        status: ContactStatus.NO_ANSWER,
        attemptCount: nextAttempt,
        lastCallResult: result,
        lastCallAt: new Date().toISOString(),
        nextCallAt: undefined,
      });
      logger.info(`Contact ${contactId} maxAttempts reached → NO_ANSWER`);
      return;
    }

    const nextCallAt = getNextCallTime(strategy, contact.attemptCount, contact.timezone);
    const statusKey = `CALL_${nextAttempt}` as keyof typeof ContactStatus;
    const newStatus = ContactStatus[statusKey] || ContactStatus.CALL_1;

    ContactRepository.update(contactId, {
      status: newStatus,
      attemptCount: nextAttempt,
      lastCallResult: result,
      lastCallAt: new Date().toISOString(),
      nextCallAt: nextCallAt.toISOString(),
    });

    logger.info(`Retry ${nextAttempt} for ${contactId} at ${nextCallAt}`);
    return;
  }

  // Отказ (сбросил, перегруз и т.д.)
  ContactRepository.update(contactId, {
    status: ContactStatus.REJECT,
    lastCallResult: result,
    lastCallAt: new Date().toISOString(),
  });
  logger.info(`Contact ${contactId} → REJECT: ${result}`);
}

// ✅ FIX #2: onCallCompleted не уходит в минус
export function onCallCompleted() {
  if (activeCalls > 0) {
    activeCalls--;
    saveState();
    logger.info(`Call completed. Active calls: ${activeCalls}`);
  } else {
    logger.warn('onCallCompleted called but activeCalls already 0 — ignoring');
  }
}
