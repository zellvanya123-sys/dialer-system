import { getOpenAI } from '../../integrations/openai/openai.service';
import { getYandexTTS } from '../../integrations/yandex/tts.service';
import { getYandexSTT } from '../../integrations/yandex/stt.service';
import { getDialer } from '../dialer/dialer.module';
import { Contact, CallResult } from '../contacts/contact.model';
import { ContactRepository } from '../contacts/contact.repository';
import { onCallCompleted } from '../scheduler/scheduler.service';
import { createCallLog } from '../dialer/dialer.module';
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
  maxTurns: number;        // макс количество реплик
  timeoutMs: number;       // таймаут всего разговора
  turnTimeoutMs: number;   // таймаут одной реплики
  maxHistoryTurns: number; // сколько реплик держать в контексте GPT
}

export interface CallSession {
  id: string;
  contactId: string;
  phone: string;
  startTime: string;
  turns: ConversationTurn[];
  status: 'initiated' | 'in_progress' | 'completed' | 'failed';
  transcript: string;
  callTimeoutTimer?: NodeJS.Timeout; // ✅ таймер для принудительного завершения
}

export interface ConversationTurn {
  role: 'ai' | 'user';
  content: string;
  timestamp: string;
  audioFile?: string;
}

// ✅ Filler-фразы — бот говорит пока GPT думает
const FILLER_PHRASES = [
  'Хм, понял...',
  'Секунду...',
  'Хорошо...',
  'Позвольте уточнить...',
];

// ✅ Fallback-фразы — если клиент молчит или STT не распознал
const FALLBACK_PHRASES = [
  'Не расслышал вас, повторите пожалуйста.',
  'Простите, можете повторить?',
  'Кажется связь прервалась, вы меня слышите?',
];

// ✅ Быстрые ответы без GPT — для частых слов
const QUICK_RESPONSES: Record<string, string> = {
  'да': 'Отлично! Тогда давайте я расскажу подробнее.',
  'нет': 'Понял вас. Может быть, у вас есть вопросы?',
  'не интересует': 'Хорошо, не буду вас беспокоить. Спасибо за уделённое время!',
  'не интересно': 'Понял, спасибо за честность. Хорошего дня!',
  'занят': 'Хорошо, перезвоним вам позже. Удобно в другое время?',
  'перезвоните': 'Конечно! Когда вам удобно, чтобы я перезвонил?',
};

const defaultConfig: AIVoiceConfig = {
  systemPrompt: `Ты вежливый менеджер по продажам. Ты звонишь клиенту с предложением услуги. 
Правила:
- Отвечай кратко — максимум 2-3 предложения
- Не упоминай что ты AI
- Будь дружелюбным и естественным
- Если клиент отказывает — поблагодари и попрощайся`,
  welcomeMessage: 'Здравствуйте! Это компания XYZ. У нас для вас есть интересное предложение. У вас есть минута?',
  maxTurns: 10,
  timeoutMs: 3 * 60 * 1000,    // 3 минуты максимум на весь разговор
  turnTimeoutMs: 10 * 1000,     // 10 секунд на одну реплику
  maxHistoryTurns: 6,           // держим только последние 6 реплик в контексте
};

class AIVoiceService {
  private config: AIVoiceConfig;
  // ✅ Сессии хранятся в Map, но с лимитом и очисткой
  private sessions: Map<string, CallSession> = new Map();
  private audioDir: string;

  constructor(config?: Partial<AIVoiceConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.audioDir = path.join(__dirname, '../../../data/audio');

    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }

    // ✅ Очищаем старые сессии каждые 10 минут
    setInterval(() => this.cleanupOldSessions(), 10 * 60 * 1000);

    logger.info('AI Voice Service initialized');
  }

  // ✅ Очистка завершённых сессий из памяти
  private cleanupOldSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      const age = now - new Date(session.startTime).getTime();
      if (session.status !== 'in_progress' || age > 30 * 60 * 1000) {
        if (session.callTimeoutTimer) clearTimeout(session.callTimeoutTimer);
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) logger.info(`Cleaned up ${cleaned} old sessions`);
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
    await dialer.makeCall(contact.id);

    session.status = 'in_progress';

    // ✅ Таймаут всего разговора — принудительно завершаем через 3 минуты
    session.callTimeoutTimer = setTimeout(async () => {
      if (session.status === 'in_progress') {
        logger.warn(`Session ${sessionId} timed out after ${this.config.timeoutMs / 1000}s`);
        await this.endCall(sessionId, CallResult.HANGUP);
      }
    }, this.config.timeoutMs);

    // Даём 3 секунды на соединение, потом произносим приветствие
    setTimeout(() => {
      this.sendWelcome(sessionId, contact).catch(err => {
        logger.error(`AI welcome error: ${err.message}`);
      });
    }, 3000);

    return sessionId;
  }

  // ✅ Отправляем приветственное сообщение
  private async sendWelcome(sessionId: string, contact: Contact): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return;

    const welcome = this.config.welcomeMessage;

    session.turns.push({
      role: 'ai',
      content: welcome,
      timestamp: new Date().toISOString(),
    });
    session.transcript += `AI: ${welcome}\n`;

    await this.synthesizeAndSend(sessionId, welcome);
  }

  // ✅ Обрабатываем ответ клиента (вызывается из webhook когда получаем аудио)
  async handleUserSpeech(sessionId: string, audioBuffer: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return;

    // ✅ Проверяем лимит реплик
    if (session.turns.length >= this.config.maxTurns * 2) {
      logger.info(`Session ${sessionId} reached maxTurns`);
      await this.endCall(sessionId, CallResult.ANSWERED);
      return;
    }

    const stt = getYandexSTT();
    let userText = '';

    try {
      userText = await stt.recognize(audioBuffer);
    } catch (err: any) {
      logger.error(`STT error: ${err.message}`);
    }

    // ✅ Fallback если клиент молчит или STT не распознал
    if (!userText || userText.trim().length < 2) {
      const fallback = FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)];
      logger.info(`Session ${sessionId}: STT empty, using fallback`);
      await this.synthesizeAndSend(sessionId, fallback);
      return;
    }

    logger.info(`Session ${sessionId} user said: ${userText}`);

    session.turns.push({
      role: 'user',
      content: userText,
      timestamp: new Date().toISOString(),
    });
    session.transcript += `Клиент: ${userText}\n`;

    // ✅ Быстрый ответ без GPT для частых слов
    const quickKey = userText.toLowerCase().trim();
    if (QUICK_RESPONSES[quickKey]) {
      const quickResponse = QUICK_RESPONSES[quickKey];
      logger.info(`Session ${sessionId}: quick response used`);
      session.turns.push({
        role: 'ai',
        content: quickResponse,
        timestamp: new Date().toISOString(),
      });
      session.transcript += `AI: ${quickResponse}\n`;
      await this.synthesizeAndSend(sessionId, quickResponse);

      // Если отказ — завершаем звонок
      if (['не интересует', 'не интересно'].includes(quickKey)) {
        setTimeout(() => this.endCall(sessionId, CallResult.ANSWERED), 3000);
      }
      return;
    }

    // ✅ Filler-фраза пока GPT думает
    const filler = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
    this.synthesizeAndSend(sessionId, filler).catch(() => {});

    // ✅ Ограничиваем историю — только последние N реплик
    const recentTurns = session.turns.slice(-this.config.maxHistoryTurns);

    const messages: any[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...recentTurns.map(t => ({
        role: t.role === 'ai' ? 'assistant' : 'user',
        content: t.content,
      })),
    ];

    // ✅ Таймаут на ответ GPT
    const openai = getOpenAI();
    let aiResponse = '';

    try {
      const responsePromise = openai.chat(messages);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('GPT timeout')), this.config.turnTimeoutMs)
      );

      aiResponse = await Promise.race([responsePromise, timeoutPromise]);
    } catch (err: any) {
      logger.error(`GPT error: ${err.message}`);
      aiResponse = 'Простите, не расслышал. Можете повторить?';
    }

    session.turns.push({
      role: 'ai',
      content: aiResponse,
      timestamp: new Date().toISOString(),
    });
    session.transcript += `AI: ${aiResponse}\n`;

    await this.synthesizeAndSend(sessionId, aiResponse);
  }

  // ✅ TTS — синтез и отправка аудио
  private async synthesizeAndSend(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const tts = getYandexTTS();
      const audioFile = path.join(this.audioDir, `${sessionId}_${Date.now()}.mp3`);
      await tts.synthesizeToFile({ text }, audioFile);
      logger.info(`TTS synthesized: ${audioFile}`);
    } catch (err: any) {
      logger.error(`TTS error: ${err.message}`);
    }
  }

  // ✅ Завершаем звонок и чистим ресурсы
  async endCall(sessionId: string, result: CallResult): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';

    // Останавливаем таймер
    if (session.callTimeoutTimer) {
      clearTimeout(session.callTimeoutTimer);
    }

    // Уменьшаем счётчик активных звонков
    onCallCompleted();

    // Сохраняем лог звонка в БД
    try {
      await createCallLog(session.contactId, result);
    } catch (err: any) {
      logger.error(`Error saving call log: ${err.message}`);
    }

    // Обновляем контакт
    const contact = ContactRepository.findById(session.contactId);
    if (contact) {
      ContactRepository.update(session.contactId, {
        lastCallAt: session.startTime,
        attemptCount: (contact.attemptCount || 0) + 1,
      });
    }

    // Удаляем аудио файлы сессии (освобождаем место)
    try {
      const files = fs.readdirSync(this.audioDir);
      files
        .filter(f => f.startsWith(sessionId))
        .forEach(f => fs.unlinkSync(path.join(this.audioDir, f)));
    } catch (err) {}

    logger.info(`Call completed: ${sessionId} | result: ${result} | turns: ${session.turns.length}`);
    logger.info(`Transcript:\n${session.transcript}`);
  }

  getSession(sessionId: string): CallSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): CallSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): CallSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'in_progress');
  }

  updateConfig(newConfig: Partial<AIVoiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`AI Voice config updated`);
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
