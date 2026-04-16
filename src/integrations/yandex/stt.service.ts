import axios from 'axios';
import FormData from 'form-data';
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';
import fs from 'fs';

interface STTOptions {
  audioData: Buffer | string;
  format?: 'mp3' | 'wav' | 'ogg' | 'opus';
  sampleRate?: number;
}

interface STTResult {
  text: string;
  confidence: number;
}

class YandexSTTService {
  private iamToken: string;
  private folderId: string;
  private sttUrl: string;

  constructor() {
    if (!config.yandex.iamToken || !config.yandex.folderId) {
      throw new Error('Yandex IAM token or Folder ID not configured');
    }

    this.iamToken = config.yandex.iamToken;
    this.folderId = config.yandex.folderId;
    this.sttUrl = config.yandex.sttUrl;
    logger.info('Yandex STT initialized');
  }

  private async refreshToken(): Promise<void> {
    const iamToken = process.env.YANDEX_IAM_TOKEN;
    if (iamToken && iamToken !== this.iamToken) {
      this.iamToken = iamToken;
      logger.info('Yandex IAM token refreshed');
    }
  }

  async recognize(options: STTOptions): Promise<STTResult> {
    await this.refreshToken();

    const format = options.format || 'mp3';
    const sampleRate = options.sampleRate || 48000;

    const form = new FormData();
    
    if (typeof options.audioData === 'string' && fs.existsSync(options.audioData)) {
      form.append('file', fs.createReadStream(options.audioData), {
        filename: `audio.${format}`,
        contentType: `audio/${format}`,
      });
    } else {
      const buffer = Buffer.isBuffer(options.audioData) ? options.audioData : Buffer.from(options.audioData);
      form.append('file', buffer, {
        filename: `audio.${format}`,
        contentType: `audio/${format}`,
      });
    }

    form.append('format', format);
    form.append('sampleRate', sampleRate);
    form.append('lang', 'ru-RU');

    try {
      const response = await axios.post(
        `${this.sttUrl}/recognize?folderId=${this.folderId}`,
        form,
        {
          headers: {
            'Authorization': `Bearer ${this.iamToken}`,
            ...form.getHeaders(),
          },
        }
      );

      const result = response.data;
      const text = result.result?.alternatives?.[0]?.transcript || '';
      const confidence = result.result?.alternatives?.[0]?.confidence || 0;

      logger.info(`Yandex STT recognized: "${text.substring(0, 50)}..." (confidence: ${confidence})`);

      return { text, confidence };
    } catch (error: any) {
      logger.error(`Yandex STT error: ${error.message}`);
      throw error;
    }
  }

  async recognizeFromUrl(audioUrl: string): Promise<STTResult> {
    try {
      const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);
      return this.recognize({ audioData: audioBuffer, format: 'mp3' });
    } catch (error: any) {
      logger.error(`Yandex STT URL fetch error: ${error.message}`);
      throw error;
    }
  }
}

let sttService: YandexSTTService;

export function initYandexSTT(): YandexSTTService {
  sttService = new YandexSTTService();
  return sttService;
}

export function getYandexSTT(): YandexSTTService {
  if (!sttService) {
    throw new Error('Yandex STT not initialized. Call initYandexSTT() first.');
  }
  return sttService;
}

export default YandexSTTService;