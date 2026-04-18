import { Contact, ContactStatus, CallResult } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { getNextCallTime, RETRY_STRATEGIES, shouldCallContact } from './retry-strategies';
import { getDialer } from '../dialer/dialer.module';
import { isWithinWorkingHours } from './timezone';
import logger from '../../utils/logger';
import fs from 'fs';

let callSchedulerInterval: NodeJS.Timeout | null = null;
let isAutoDialEnabled = false;
let activeCalls = 0;
const MAX_CONCURRENT_CALLS = 3;
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
      // При рестарте activeCalls сбрасываем в 0 — звонки уже завершились
      activeCalls = 0;
      isAutoDialEnabled = state.isAutoDialEnabled ?? false;
      logger.info(`Scheduler state loaded: autoDialEnabled=${isAutoDialEnabled}`);
      // Сразу сохраняем с нулевым activeCalls
      saveState();
    }
  } catch (e: any) {
    logger.warn(`Failed to load scheduler state: ${e.message}`);
  }
}

// Загружаем при старте модуля
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
  if (activeCalls >= MAX_CONCURRENT_CALLS) return;

  if (!isWithinWorkingHours('Europe/Moscow')) {
    logger.info('Outside working hours, skipping');
    return;
  }

  const contacts = ContactRepository.findDueForCall();
  const contactsToCall = contacts.slice(0, MAX_CONCURRENT_CALLS - activeCalls);

  for (const contact of contactsToCall) {
    if (activeCalls >= MAX_CONCURRENT_CALLS) break;

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

        setTimeout(() => {
          onCallCompleted();
        }, 60000);

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

  if (result === CallResult.NO_ANSWER || result === CallResult.BUSY) {
    const nextAttempt = contact.attemptCount + 1;

    if (nextAttempt >= strategy.maxAttempts) {
      ContactRepository.update(contactId, {
        status: ContactStatus.NO_ANSWER,
        attemptCount: nextAttempt,
        lastCallResult: result,
        lastCallAt: new Date().toISOString(),
        nextCallAt: undefined,
      });
      logger.info(`Contact ${contactId} marked as NO_ANSWER after ${nextAttempt} attempts`);
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

    logger.info(`Scheduled retry ${nextAttempt} for ${contactId} at ${nextCallAt}`);
    return;
  }

  ContactRepository.update(contactId, {
    status: ContactStatus.REJECT,
    lastCallResult: result,
    lastCallAt: new Date().toISOString(),
  });
  logger.info(`Contact ${contactId} marked as REJECT: ${result}`);
}

export function onCallCompleted() {
  if (activeCalls > 0) {
    activeCalls--;
    saveState();
    logger.info(`Call completed. Active calls now: ${activeCalls}`);
  }
}
