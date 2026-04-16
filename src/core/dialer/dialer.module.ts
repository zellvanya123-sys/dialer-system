import axios from 'axios';
import { Contact, CallResult, CallLog } from '../contacts/contact.model.js';
import { ContactRepository } from '../contacts/contact.repository.js';
import { formatPhoneForCall } from '../scheduler/timezone.js';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface DialerConfig {
  provider: 'ringostat';
}

class RingostatDialer {
  private apiKey: string;
  private phone: string;

  constructor() {
    this.apiKey = process.env.RINGOSTAT_API_KEY || '';
    this.phone = process.env.RINGOSTAT_PHONE || '';
    
    if (!this.apiKey || !this.phone) {
      throw new Error('Ringostat credentials not configured');
    }
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const to = formatPhoneForCall(contact.phone);
    
    logger.info(`Initiating call via Ringostat to ${to}`);

    try {
      const response = await axios.post('https://api.ringostat.net/v2/call/make', {
        phone_from: this.phone,
        phone_to: to,
        api_key: this.apiKey,
      });

      logger.info(`Call initiated: ${response.data.call_id}`);
      return response.data.call_id;
    } catch (error: any) {
      logger.error(`Ringostat API error: ${error.message}`);
      throw error;
    }
  }

  async hangup(callId: string): Promise<void> {
    await axios.post('https://api.ringostat.net/v2/call/hangup', {
      call_id: callId,
      api_key: this.apiKey,
    });
    logger.info(`Call ended: ${callId}`);
  }

  async getCallStatus(callId: string): Promise<any> {
    const response = await axios.get(`https://api.ringostat.net/v2/call/${callId}`, {
      params: { api_key: this.apiKey },
    });
    return response.data;
  }
}

let dialer: RingostatDialer;

export function initDialer(provider: 'ringostat' = 'ringostat'): RingostatDialer {
  dialer = new RingostatDialer();
  logger.info(`Dialer initialized: ${provider}`);
  return dialer;
}

export function getDialer(): RingostatDialer {
  if (!dialer) {
    throw new Error('Dialer not initialized. Call initDialer() first.');
  }
  return dialer;
}

export async function createCallLog(
  contactId: string,
  result: CallResult,
  duration?: number
): Promise<CallLog> {
  const contact = ContactRepository.findById(contactId);
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const log: CallLog = {
    id: uuidv4(),
    contactId,
    phone: contact.phone,
    startedAt: new Date().toISOString(),
    result,
    duration,
  };

  return log;
}