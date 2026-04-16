import axios from 'axios';
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';
import { formatPhoneForCall } from '../scheduler/timezone.js';

interface MangoCallOptions {
  phone: string;
  callerId?: string;
  webhookUrl?: string;
}

interface MangoCallResult {
  callId: string;
  status: string;
}

class MangoSIPService {
  private host: string;
  private login: string;
  private password: string;
  private sipNumber: string;

  constructor() {
    if (!config.mango.login || !config.mango.password) {
      throw new Error('Mango credentials not configured');
    }

    this.host = config.mango.host || 'gw1.mangosip.ru';
    this.login = config.mango.login;
    this.password = config.mango.password;
    this.sipNumber = config.mango.sipNumber || '';
    
    logger.info(`Mango SIP initialized: ${this.host}, SIP: ${this.sipNumber}`);
  }

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.login}:${this.password}`).toString('base64');
  }

  async makeCall(options: MangoCallOptions): Promise<MangoCallResult> {
    const to = formatPhoneForCall(options.phone).replace('+', '');
    const callerId = options.callerId || this.sipNumber;

    logger.info(`Mango: initiating call to ${to} from ${callerId}`);

    try {
      const response = await axios.post(
        `https://${this.host}/api/v1/calls`,
        {
          from': callerId,
          to,
          webhook_url: options.webhookUrl || '',
        },
        {
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
        }
      );

      const callId = response.data?.call_id || response.data?.id;
      logger.info(`Mango call initiated: ${callId}`);

      return {
        callId: String(callId),
        status: response.data?.status || 'initiated',
      };
    } catch (error: any) {
      logger.error(`Mango API error: ${error.message}`);
      throw error;
    }
  }

  async getCallStatus(callId: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://${this.host}/api/v1/calls/${callId}`,
        {
          headers: {
            'Authorization': this.getAuthHeader(),
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error(`Mango status error: ${error.message}`);
      throw error;
    }
  }

  async hangupCall(callId: string): Promise<void> {
    try {
      await axios.delete(
        `https://${this.host}/api/v1/calls/${callId}`,
        {
          headers: {
            'Authorization': this.getAuthHeader(),
          },
        }
      );

      logger.info(`Mango call terminated: ${callId}`);
    } catch (error: any) {
      logger.error(`Mango hangup error: ${error.message}`);
      throw error;
    }
  }

  async getBalance(): Promise<number> {
    try {
      const response = await axios.get(
        `https://${this.host}/api/v1/account/balance`,
        {
          headers: {
            'Authorization': this.getAuthHeader(),
          },
        }
      );

      return parseFloat(response.data?.balance || '0');
    } catch (error: any) {
      logger.error(`Mango balance error: ${error.message}`);
      return 0;
    }
  }
}

let mangoService: MangoSIPService;

export function initMangoSIP(): MangoSIPService {
  mangoService = new MangoSIPService();
  return mangoService;
}

export function getMangoSIP(): MangoSIPService {
  if (!mangoService) {
    throw new Error('Mango SIP not initialized. Call initMangoSIP() first.');
  }
  return mangoService;
}

export default MangoSIPService;