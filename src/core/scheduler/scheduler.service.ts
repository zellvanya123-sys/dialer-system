import { Contact, ContactStatus, CallResult } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { getNextCallTime, RETRY_STRATEGIES, shouldCallContact } from './retry-strategies';
import { getDialer } from '../dialer/dialer.module';
import { isWithinWorkingHours } from './timezone';
import logger from '../../utils/logger';

let callSchedulerInterval: NodeJS.Timeout | null = null;
let isAutoDialEnabled = false;
let activeCalls = 0;
const MAX_CONCURRENT_CALLS = 3;

export function enableAutoDial() {
  isAutoDialEnabled = true;
  logger.info('Auto-dial enabled');
}

export function disableAutoDial() {
  isAutoDialEnabled = false;
  logger.info('Auto-dial disabled');
}

export function getAutoDialStatus() {
  return {
    enabled: isAutoDialEnabled,
    activeCalls,
  };
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
  
  // ✅ ИСПРАВЛЕНИЕ: часовой пояс Europe/Moscow вместо UTC
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
        logger.info(`Auto-dialing contact: ${contact.name} (${contact.phone})`);
        const dialer = getDialer();
        await dialer.makeCall(contact.id);

        // ✅ ИСПРАВЛЕНИЕ: увеличиваем счётчик и уменьшаем после завершения
        activeCalls++;
        logger.info(`Active calls: ${activeCalls}`);

        ContactRepository.update(contact.id, {
          lastCallAt: new Date().toISOString(),
          status: ContactStatus.CALL_1,
        });

        // Через 60 сек считаем звонок завершённым и уменьшаем счётчик
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

  // ✅ ИСПРАВЛЕНИЕ: берём стратегию из контакта, а не всегда 'short'
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

    logger.info(`Scheduled retry ${nextAttempt} for contact ${contactId} at ${nextCallAt}`);
    return;
  }

  ContactRepository.update(contactId, {
    status: ContactStatus.REJECT,
    lastCallResult: result,
    lastCallAt: new Date().toISOString(),
  });
  
  logger.info(`Contact ${contactId} marked as REJECT: ${result}`);
}

// ✅ Уменьшаем счётчик активных звонков
export function onCallCompleted() {
  if (activeCalls > 0) {
    activeCalls--;
    logger.info(`Call completed. Active calls now: ${activeCalls}`);
  }
}
