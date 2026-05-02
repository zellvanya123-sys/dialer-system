import axios, { AxiosInstance } from 'axios';
import { Contact, CallResult, CallLog } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { formatPhoneForCall } from '../scheduler/timezone';
import { config } from '../../config/index';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface DialerConfig {
  provider: 'exolve' | 'sipuni';
}

// ═══════════════════════════════════════════
// МТС Exolve Dialer
// Документация: https://exolve.ru/docs/
// ═══════════════════════════════════════════
class ExolveDialer {
  private http: AxiosInstance;
  private apiKey: string;
  private fromNumber: string;
  private baseUrl = 'https://api.exolve.ru';

  constructor() {
    this.apiKey = config.exolve.apiKey || '';
    this.fromNumber = config.exolve.phoneNumber || '';

    if (!this.apiKey) {
      throw new Error('Exolve API key not configured (EXOLVE_API_KEY)');
    }
    if (!this.fromNumber) {
      throw new Error('Exolve phone number not configured (EXOLVE_PHONE_NUMBER)');
    }

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    logger.info(`Exolve dialer initialized. From: ${this.fromNumber}`);
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const to = formatPhoneForCall(contact.phone);
    logger.info(`Initiating call via Exolve to ${to}`);

    try {
      // МТС Exolve API: инициировать исходящий звонок
      // Документация: https://exolve.ru/docs/voice/MakeCall/
      const response = await this.http.post('/voice/v1/MakeCall', {
        number: to,           // Номер клиента
        from_number: this.fromNumber, // Наш виртуальный номер
      });

      const callId = response.data?.call_id || response.data?.CallId || uuidv4();
      logger.info(`Exolve call initiated: callId=${callId} to=${to}`);
      return callId;

    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message;
      logger.error(`Exolve API error: ${errMsg}`);
      throw new Error(`Exolve call failed: ${errMsg}`);
    }
  }

  // Получить статус звонка
  async getCallStatus(callId: string): Promise<any> {
    try {
      const response = await this.http.post('/voice/v1/GetCallHistory', {
        call_id: callId,
      });
      return response.data;
    } catch (error: any) {
      logger.error(`Exolve getCallStatus error: ${error.message}`);
      return null;
    }
  }

  // Завершить активный звонок
  async hangupCall(callId: string): Promise<void> {
    try {
      await this.http.post('/voice/v1/HangupCall', { call_id: callId });
      logger.info(`Exolve call hung up: ${callId}`);
    } catch (error: any) {
      logger.error(`Exolve hangupCall error: ${error.message}`);
    }
  }
}

// ═══════════════════════════════════════════
// Sipuni Dialer (оставлен для совместимости)
// ═══════════════════════════════════════════
import crypto from 'crypto';

class SipuniDialer {
  private http: AxiosInstance;
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

    if (!this.user || !this.secret || !this.sipNumber) {
      throw new Error('Sipuni credentials not configured');
    }

    this.http = axios.create();
  }

  private generateHash(params: Record<string, string>): string {
    const ordered = Object.keys(params).sort().map(key => params[key]);
    ordered.push(this.secret);
    return crypto.createHash('md5').update(ordered.join('+')).digest('hex');
  }

  async makeCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const to = formatPhoneForCall(contact.phone);
    const params: Record<string, string> = {
      antiaon: '0',
      phone: to.replace('+', ''),
      reverse: '0',
      sipnumber: this.sipNumber,
      user: this.user,
    };
    const hash = this.generateHash(params);

    try {
      const protocol = this.port === '443' ? 'https' : 'http';
      const response = await this.http.post(
        `${protocol}://${this.host}:${this.port}/api/callback/call_number`,
        new URLSearchParams({ ...params, hash }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const callId = response.data?.order_id || response.data?.call_id || uuidv4();
      logger.info(`Sipuni call initiated: ${callId}`);
      return callId;
    } catch (error: any) {
      logger.error(`Sipuni API error: ${error.message}`);
      throw error;
    }
  }
}

// ═══════════════════════════════════════════
// Фабрика — выбираем провайдера из .env
// ═══════════════════════════════════════════
type AnyDialer = ExolveDialer | SipuniDialer;
let dialer: AnyDialer;

export function initDialer(provider?: 'exolve' | 'sipuni'): AnyDialer {
  // Автоопределение провайдера по наличию ключей в .env
  const resolvedProvider = provider
    || (config.exolve.apiKey ? 'exolve' : 'sipuni');

  if (resolvedProvider === 'exolve') {
    dialer = new ExolveDialer();
    logger.info('✓ Dialer: МТС Exolve');
  } else {
    dialer = new SipuniDialer();
    logger.info('✓ Dialer: Sipuni');
  }

  return dialer;
}

export function getDialer(): AnyDialer {
  if (!dialer) throw new Error('Dialer not initialized. Call initDialer() first.');
  return dialer;
}

// Сохранить лог звонка в БД
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
