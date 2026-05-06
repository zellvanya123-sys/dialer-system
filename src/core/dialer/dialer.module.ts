import axios, { AxiosInstance } from 'axios';
import { ContactRepository } from '../contacts/contact.repository';
import { formatPhoneForCall } from '../scheduler/timezone';
import { config } from '../../config/index';
import { CallResult, CallLog } from '../contacts/contact.model';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════
// МТС Exolve VATS Dialer
// API: https://exolve508698.vats.exolve.ru/crmapi/v1
// Документация: https://vpbxdocs.exolve.ru/
// ═══════════════════════════════════════════
class VATSDialer {
  private http: AxiosInstance;
  private apiKey: string;
  private fromNumber: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.vats.apiKey || '';
    this.fromNumber = config.vats.phoneNumber || '';
    this.baseUrl = config.vats.apiUrl || 'https://exolve508698.vats.exolve.ru/crmapi/v1';

    if (!this.apiKey) throw new Error('VATS API key not configured (VATS_API_KEY)');
    if (!this.fromNumber) throw new Error('VATS phone number not configured (VATS_PHONE_NUMBER)');

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-VATS-Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    logger.info(`VATS Dialer initialized. From: ${this.fromNumber}`);
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const to = formatPhoneForCall(contact.phone);
    logger.info(`Initiating call via VATS to ${to}`);

    try {
      // VATS makeCall API — исходящий звонок
      // Документация: https://vpbxdocs.exolve.ru/management-api
      const response = await this.http.post('/makeCall', {
        from: this.fromNumber,
        to: to,
      });

      const callId = response.data?.call_id
        || response.data?.callId
        || response.data?.id
        || uuidv4();

      logger.info(`VATS call initiated: callId=${callId} to=${to}`);
      return String(callId);

    } catch (error: any) {
      const errMsg = error.response?.data?.message
        || error.response?.data?.error
        || error.message;
      logger.error(`VATS API error: ${errMsg}`);
      logger.error(`VATS response: ${JSON.stringify(error.response?.data)}`);
      throw new Error(`VATS call failed: ${errMsg}`);
    }
  }

  async hangupCall(callId: string): Promise<void> {
    try {
      await this.http.post('/hangup', { call_id: callId });
      logger.info(`VATS call hung up: ${callId}`);
    } catch (error: any) {
      logger.error(`VATS hangupCall error: ${error.message}`);
    }
  }

  // Тест подключения
  async testConnection(): Promise<boolean> {
    try {
      await this.http.get('/accounts');
      logger.info('VATS connection test: OK');
      return true;
    } catch (error: any) {
      logger.warn(`VATS connection test failed: ${error.message}`);
      return false;
    }
  }
}

// ═══════════════════════════════════════════
// Exolve API Dialer (dev.exolve.ru)
// ═══════════════════════════════════════════
class ExolveDialer {
  private http: AxiosInstance;
  private apiKey: string;
  private fromNumber: string;

  constructor() {
    this.apiKey = config.exolve.apiKey || '';
    this.fromNumber = config.exolve.phoneNumber || '';

    if (!this.apiKey) throw new Error('Exolve API key not configured (EXOLVE_API_KEY)');

    this.http = axios.create({
      baseURL: 'https://api.exolve.ru',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const to = formatPhoneForCall(contact.phone);

    try {
      const response = await this.http.post('/voice/v1/MakeCall', {
        number: to,
        from_number: this.fromNumber,
      });

      const callId = response.data?.call_id || response.data?.CallId || uuidv4();
      logger.info(`Exolve call initiated: callId=${callId}`);
      return String(callId);
    } catch (error: any) {
      logger.error(`Exolve API error: ${error.message}`);
      throw error;
    }
  }
}

// ═══════════════════════════════════════════
// Sipuni Dialer (fallback)
// ═══════════════════════════════════════════
import crypto from 'crypto';

class SipuniDialer {
  private user: string;
  private secret: string;
  private sipNumber: string;
  private host: string;
  private port: string;

  constructor() {
    this.user = config.sipuni.user || '';
    this.secret = config.sipuni.secret || '';
    this.sipNumber = config.sipuni.sipNumber || '';
    this.host = config.sipuni.host || 'voip.sipuni.ru';
    this.port = config.sipuni.port || '443';
  }

  private generateHash(params: Record<string, string>): string {
    const ordered = Object.keys(params).sort().map(key => params[key]);
    ordered.push(this.secret);
    return crypto.createHash('md5').update(ordered.join('+')).digest('hex');
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const to = formatPhoneForCall(contact.phone).replace('+', '');
    const params: Record<string, string> = {
      antiaon: '0', phone: to, reverse: '0',
      sipnumber: this.sipNumber, user: this.user,
    };
    const hash = this.generateHash(params);

    const protocol = this.port === '443' ? 'https' : 'http';
    const response = await axios.post(
      `${protocol}://${this.host}:${this.port}/api/callback/call_number`,
      new URLSearchParams({ ...params, hash }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data?.order_id || response.data?.call_id || uuidv4();
  }
}

// ═══════════════════════════════════════════
// Фабрика — автовыбор провайдера
// ═══════════════════════════════════════════
type AnyDialer = VATSDialer | ExolveDialer | SipuniDialer;
let dialer: AnyDialer;

export function initDialer(provider?: string): AnyDialer {
  const resolved = provider
    || (config.vats.apiKey ? 'vats' : null)
    || (config.exolve.apiKey ? 'exolve' : null)
    || 'sipuni';

  if (resolved === 'vats') {
    dialer = new VATSDialer();
    logger.info('✓ Dialer: МТС VATS (300 номеров)');
  } else if (resolved === 'exolve') {
    dialer = new ExolveDialer();
    logger.info('✓ Dialer: МТС Exolve API');
  } else {
    dialer = new SipuniDialer();
    logger.info('✓ Dialer: Sipuni');
  }

  return dialer;
}

export function getDialer(): AnyDialer {
  if (!dialer) throw new Error('Dialer not initialized');
  return dialer;
}

export async function createCallLog(
  contactId: string,
  result: CallResult,
  duration?: number
): Promise<CallLog> {
  const contact = ContactRepository.findById(contactId);
  if (!contact) throw new Error(`Contact not found: ${contactId}`);

  const log: CallLog = {
    id: uuidv4(),
    contactId,
    phone: contact.phone,
    startedAt: new Date().toISOString(),
    result,
    duration,
  };

  ContactRepository.addCallLog(log);
  return log;
}
