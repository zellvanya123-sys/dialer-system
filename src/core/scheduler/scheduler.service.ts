import { Contact, ContactStatus, CallResult } from '../contacts/contact.model.js';
import { ContactRepository } from '../contacts/contact.repository.js';
import { getNextCallTime, RETRY_STRATEGIES, shouldCallContact } from './retry-strategies.js';
import logger from '../../utils/logger.js';

let callSchedulerInterval: NodeJS.Timeout | null = null;

export async function startScheduler(): Promise<void> {
  if (callSchedulerInterval) return;
  
  callSchedulerInterval = setInterval(async () => {
    await processDueCalls();
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
  const contacts = ContactRepository.findDueForCall();
  
  for (const contact of contacts) {
    if (shouldCallContact(contact)) {
      try {
        logger.info(`Processing call for contact: ${contact.name} (${contact.phone})`);
      } catch (error: any) {
        logger.error(`Error processing call: ${error.message}`);
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

  const strategy = RETRY_STRATEGIES['short'];
  
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