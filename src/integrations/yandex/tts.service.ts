import axios from 'axios';
import { config } from '../../config/index';
import logger from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  format?: 'mp3' | 'ogg' | 'wav';
}

class YandexTTSService {
  private apiKey: string;
  private folderId: string;
  private voice: string;
  private format: string;
  private lang: string;

  constructor() {
    if (!config.yandex.apiKey && !config.yandex.iamToken) {
      throw new Error('Yandex API key or IAM token not configured');
    }
    if (!config.yandex.folderId) {
      throw new Error('Yandex Folder ID not configured');
    }

    this.apiKey = config.yandex.apiKey || config.yandex.iamToken!;
    this.folderId = config.yandex.folderId;
    this.voice = config.yandex.voice || 'oksana';
    this.format = config.yandex.format || 'mp3';
    this.lang = config.yandex.lang || 'ru-RU';
    logger.info(`Yandex TTS initialized with voice: ${this.voice}`);
  }

  async synthesize(options: TTSOptions): Promise<Buffer> {
    const text = options.text;
    const voice = options.voice || this.voice;
    const speed = options.speed ?? 1.0;
    const pitch = options.pitch ?? 0;
    const format = options.format || this.format as 'mp3' | 'ogg' | 'wav';

    const requestBody = {
      text,
      lang: this.lang,
      voice,
      speed,
      pitch,
      format,
      emotion: 'neutral',
    };

    try {
      const response = await axios.post(
        `${config.yandex.ttsUrl}/synthesize`,
        requestBody,
        {
          headers: {
            'Authorization': `Api-Key ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      logger.info(`Yandex TTS synthesized ${text.length} characters`);
      return Buffer.from(response.data);
    } catch (error: any) {
      logger.error(`Yandex TTS error: ${error.message}`);
      throw error;
    }
  }

  async synthesizeToFile(options: TTSOptions, filePath: string): Promise<string> {
    const audioBuffer = await this.synthesize(options);
    
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, audioBuffer);
    logger.info(`Yandex TTS saved to: ${filePath}`);

    return filePath;
  }

  async synthesizeStream(options: TTSOptions): Promise<NodeJS.ReadableStream> {
    const audioBuffer = await this.synthesize(options);
    return require('stream').Readable.from(audioBuffer);
  }
}

let ttsService: YandexTTSService;

export function initYandexTTS(): YandexTTSService {
  ttsService = new YandexTTSService();
  return ttsService;
}

export function getYandexTTS(): YandexTTSService {
  if (!ttsService) {
    throw new Error('Yandex TTS not initialized. Call initYandexTTS() first.');
  }
  return ttsService;
}

export default YandexTTSService;