import { getOpenAI } from '../../integrations/openai/openai.service';
import { getYandexTTS } from '../../integrations/yandex/tts.service';
import { getYandexSTT } from '../../integrations/yandex/stt.service';
import { getDialer } from '../dialer/dialer.module';
import { Contact, CallResult } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AIVoiceConfig {
  systemPrompt: string;
  welcomeMessage: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface CallSession {
  id: string;
  contactId: string;
  phone: string;
  startTime: string;
  turns: ConversationTurn[];
  status: 'initiated' | 'in_progress' | 'completed' | 'failed';
  transcript: string;
}

export interface ConversationTurn {
  role: 'ai' | 'user';
  content: string;
  timestamp: string;
  audioFile?: string;
}

const defaultConfig: AIVoiceConfig = {
  systemPrompt: 'Ты вежливый менеджер по продажам. Ты звонишь клиенту с предложением услуги. Отвечай кратко и по делу. Не упоминай что ты AI.',
  welcomeMessage: 'Здравствуйте! Это компания XYZ. У нас для вас есть интересное предложение. У вас есть минута?',
  maxTurns: 10,
  timeoutMs: 30000,
};

class AIVoiceService {
  private config: AIVoiceConfig;
  private sessions: Map<string, CallSession> = new Map();
  private audioDir: string;

  constructor(config?: Partial<AIVoiceConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.audioDir = path.join(__dirname, '../../../data/audio');
    
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
    
    logger.info('AI Voice Service initialized');
  }

  async startCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const sessionId = uuidv4();
    const session: CallSession = {
      id: sessionId,
      contactId,
      phone: contact.phone,
      startTime: new Date().toISOString(),
      turns: [],
      status: 'initiated',
      transcript: '',
    };

    this.sessions.set(sessionId, session);
    logger.info(`AI Voice call started: ${sessionId} to ${contact.phone}`);

    const dialer = getDialer();
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL || 'http://localhost:3000'}/api/webhooks/sipuni`;
    
    await dialer.makeCall(contact.id);

    session.status = 'in_progress';
    
    setTimeout(() => {
      this.processCallStep(sessionId, contact).catch(err => {
        logger.error(`AI call error: ${err.message}`);
      });
    }, 3000);

    return sessionId;
  }

  private async processCallStep(sessionId: string, contact: Contact): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return;

    const openai = getOpenAI();
    const tts = getYandexTTS();

    const messages: any[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...session.turns.map(t => ({
        role: t.role === 'ai' ? 'assistant' : 'user',
        content: t.content,
      })),
    ];

    if (session.turns.length === 0) {
      const response = this.config.welcomeMessage;
      await this.sendAudioAndWait(sessionId, response);
      return;
    }

    const response = await openai.chat(messages);
    
    session.turns.push({
      role: 'ai',
      content: response,
      timestamp: new Date().toISOString(),
    });

    session.transcript += `AI: ${response}\n`;

    await this.sendAudioAndWait(sessionId, response);
  }

  private async sendAudioAndWait(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const tts = getYandexTTS();
    const audioFile = path.join(this.audioDir, `${sessionId}_${session.turns.length}.mp3`);
    
    await tts.synthesizeToFile({ text }, audioFile);
    
    session.turns[session.turns.length - 1].audioFile = audioFile;

    logger.info(`AI audio sent: ${audioFile}`);
  }

  async handleMangoWebhook(event: any): Promise<void> {
    const callId = event.call_id;
    const status = event.status;
    
    logger.info(`Mango webhook: callId=${callId}, status=${status}`);

    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'in_progress') {
        if (status === 'answered') {
          logger.info(`Call answered for session ${sessionId}`);
        } else if (status === 'completed' || status === 'hangup') {
          session.status = 'completed';
          await this.endCall(sessionId);
        }
      }
    }
  }

  private async endCall(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const contact = ContactRepository.findById(session.contactId);
    if (contact) {
      ContactRepository.update(session.contactId, {
        lastCallAt: session.startTime,
        callCount: (contact.callCount || 0) + 1,
      });
    }

    logger.info(`Call completed: ${sessionId}, turns: ${session.turns.length}`);
  }

  getSession(sessionId: string): CallSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): CallSession[] {
    return Array.from(this.sessions.values());
  }

  updateConfig(newConfig: Partial<AIVoiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`AI Voice config updated: ${JSON.stringify(newConfig)}`);
  }
}

let aiVoiceService: AIVoiceService;

export function initAIVoice(config?: Partial<AIVoiceConfig>): AIVoiceService {
  aiVoiceService = new AIVoiceService(config);
  return aiVoiceService;
}

export function getAIVoice(): AIVoiceService {
  if (!aiVoiceService) {
    throw new Error('AI Voice not initialized. Call initAIVoice() first.');
  }
  return aiVoiceService;
}

export default AIVoiceService;