import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { Contact, CallResult, CallLog } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { formatPhoneForCall } from '../scheduler/timezone';
import { config } from '../../config/index';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface DialerConfig {
  provider: 'sipuni';
}

class SipuniDialer {
  private http: AxiosInstance;
  private user: string;
  private secret: string;
  private sipNumber: string;
  private host: string;

  constructor() {
    this.user = config.sipuni.user || '';
    this.secret = config.sipuni.secret || '';
    this.sipNumber = config.sipuni.sipNumber || '';
    this.host = config.sipuni.host || 'voip.sipuni.ru';

    if (!this.user || !this.secret || !this.sipNumber) {
      throw new Error('Sipuni credentials not configured');
    }

    const proxyConfig = config.proxy.https
      ? (() => {
          const url = new URL(config.proxy.https);
          return {
            protocol: 'http',
            host: url.hostname,
            port: parseInt(url.port || '80'),
            auth: url.username && url.password
              ? { username: url.username, password: url.password }
              : undefined,
          };
        })()
      : undefined;

    this.http = axios.create({
      proxy: proxyConfig,
    });
  }

  private generateHash(params: Record<string, string>): string {
    const ordered = Object.keys(params)
      .sort()
      .map(key => params[key]);
    ordered.push(this.secret);
    const hashString = ordered.join('+');
    return crypto.createHash('md5').update(hashString).digest('hex');
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const to = formatPhoneForCall(contact.phone);

    logger.info(`Initiating call via Sipuni to ${to}`);

    const params: Record<string, string> = {
      antiaon: '0',
      phone: to.replace('+', ''),
      reverse: '0',
      sipnumber: this.sipNumber,
      user: this.user,
    };

    const hash = this.generateHash(params);

    try {
      const response = await this.http.post(
        `https://${this.host}/api/callback/call_number`,
        new URLSearchParams({ ...params, hash }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const callId = response.data?.order_id || response.data?.call_id || uuidv4();
      logger.info(`Call initiated: ${callId}`);
      return callId;
    } catch (error: any) {
      logger.error(`Sipuni API error: ${error.message}`);
      throw error;
    }
  }

  async getCallStatus(callId: string): Promise<any> {
    const params: Record<string, string> = {
      call_id: callId,
      user: this.user,
    };
    const hash = this.generateHash(params);

    const response = await this.http.get(`https://${this.host}/api/statistic/get`, {
      params: { ...params, hash },
    });
    return response.data;
  }
}

let dialer: SipuniDialer;

export function initDialer(provider: 'sipuni' = 'sipuni'): SipuniDialer {
  dialer = new SipuniDialer();
  logger.info(`Dialer initialized: ${provider}`);
  return dialer;
}

export function getDialer(): SipuniDialer {
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
