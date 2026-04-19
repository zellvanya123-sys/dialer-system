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
  maxTurns: number;
  timeoutMs: number;
  turnTimeoutMs: number;
  maxHistoryTurns: number;
}

export interface CallSession {
  id: string;
  contactId: string;
  contactName: string;   // ✅ FIX #63: персонализация — имя клиента
  phone: string;
  startTime: string;
  turns: ConversationTurn[];
  status: 'initiated' | 'in_progress' | 'completed' | 'failed';
  transcript: string;
  isSpeaking: boolean;   // ✅ FIX #61: флаг — AI сейчас говорит
  negativeCount: number; // ✅ FIX #60: счётчик негатива
  callTimeoutTimer?: NodeJS.Timeout;
}

export interface ConversationTurn {
  role: 'ai' | 'user';
  content: string;
  timestamp: string;
  sentiment?: string;    // ✅ FIX #60: эмоция клиента
}

// Filler-фразы — бот говорит пока GPT думает
const FILLER_PHRASES = [
  'Хм, понял...',
  'Секунду...',
  'Хорошо...',
  'Дайте подумаю...',
  'Понял вас...',
];

// Fallback — клиент молчит или STT не распознал
const FALLBACK_PHRASES = [
  'Не расслышал вас, повторите пожалуйста.',
  'Простите, можете повторить?',
  'Кажется связь прервалась, вы меня слышите?',
];

// ✅ FIX #60: Фразы при обнаружении негатива/злости
const ANGRY_RESPONSES = [
  'Понимаю вас, простите что побеспокоил. Больше не буду звонить!',
  'Извините за беспокойство. Хорошего дня!',
  'Прошу прощения за неудобство. Удачного дня!',
];

// Быстрые ответы без GPT
const QUICK_RESPONSES: Record<string, { reply: string; shouldEnd?: boolean }> = {
  'да': { reply: 'Отлично! Тогда давайте расскажу подробнее.' },
  'нет': { reply: 'Понял вас. Может быть, есть вопросы?' },
  'не интересует': { reply: 'Хорошо, не буду беспокоить. Спасибо за время!', shouldEnd: true },
  'не интересно': { reply: 'Понял, спасибо за честность. Хорошего дня!', shouldEnd: true },
  'занят': { reply: 'Хорошо, перезвоним позже. В какое время удобнее?' },
  'перезвоните': { reply: 'Конечно! Когда вам удобно перезвонить?' },
  'не звоните': { reply: 'Извините за беспокойство, больше не буду звонить!', shouldEnd: true },
  'стоп': { reply: 'Хорошо, извините. Хорошего дня!', shouldEnd: true },
};

const defaultConfig: AIVoiceConfig = {
  systemPrompt: `Ты вежливый менеджер по продажам. Ты звонишь клиенту с предложением.
Правила:
- Отвечай кратко — МАКСИМУМ 2 предложения
- Обращайся к клиенту по имени если знаешь
- Не говори что ты AI или робот
- Будь естественным и дружелюбным
- Если клиент раздражён — сразу вежливо прощайся
- Если клиент задаёт вопрос — отвечай конкретно`,
  welcomeMessage: 'Здравствуйте! Это компания XYZ, у нас для вас есть предложение. Есть минутка?',
  maxTurns: 10,
  timeoutMs: 3 * 60 * 1000,
  turnTimeoutMs: 10 * 1000,
  maxHistoryTurns: 6,
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

    // Очистка сессий каждые 10 минут
    setInterval(() => this.cleanupOldSessions(), 10 * 60 * 1000);

    // ✅ FIX #14: Очистка старых аудиофайлов раз в час
    setInterval(() => this.cleanupOldAudioFiles(), 60 * 60 * 1000);

    logger.info('AI Voice Service initialized');
  }

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

  // ✅ FIX #14: Чистим аудиофайлы старше 2 часов
  private cleanupOldAudioFiles(): void {
    try {
      const files = fs.readdirSync(this.audioDir);
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      let deleted = 0;
      for (const file of files) {
        const filePath = path.join(this.audioDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < twoHoursAgo) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
      if (deleted > 0) logger.info(`Cleaned up ${deleted} old audio files`);
    } catch (err: any) {
      logger.warn(`Audio cleanup error: ${err.message}`);
    }
  }

  async startCall(contactId: string): Promise<string> {
    const contact = ContactRepository.findById(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const sessionId = uuidv4();

    // ✅ FIX #63: Персонализированное приветствие по имени
    const firstName = contact.name?.split(' ')[0] || '';
    const personalWelcome = firstName && firstName !== 'Без имени'
      ? this.config.welcomeMessage.replace('Здравствуйте!', `Здравствуйте, ${firstName}!`)
      : this.config.welcomeMessage;

    const session: CallSession = {
      id: sessionId,
      contactId,
      contactName: firstName,
      phone: contact.phone,
      startTime: new Date().toISOString(),
      turns: [],
      status: 'initiated',
      transcript: '',
      isSpeaking: false,
      negativeCount: 0,
    };

    this.sessions.set(sessionId, session);

    const dialer = getDialer();
    await dialer.makeCall(contact.id);

    session.status = 'in_progress';

    // Таймаут всего разговора
    session.callTimeoutTimer = setTimeout(async () => {
      if (session.status === 'in_progress') {
        logger.warn(`Session ${sessionId} timed out`);
        await this.endCall(sessionId, CallResult.HANGUP);
      }
    }, this.config.timeoutMs);

    // Приветствие через 3 сек
    setTimeout(() => {
      this.speakAndRecord(sessionId, personalWelcome).catch(err =>
        logger.error(`Welcome error: ${err.message}`)
      );
    }, 3000);

    logger.info(`AI Voice session ${sessionId} → ${contact.name} (${contact.phone})`);
    return sessionId;
  }

  // ✅ FIX #61: Говорим и записываем реплику
  private async speakAndRecord(sessionId: string, text: string, sentiment?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return;

    session.isSpeaking = true;
    session.turns.push({ role: 'ai', content: text, timestamp: new Date().toISOString(), sentiment });
    session.transcript += `AI: ${text}\n`;

    await this.synthesizeAndSend(sessionId, text);
    session.isSpeaking = false;
  }

  async handleUserSpeech(sessionId: string, audioBuffer: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return;

    // ✅ FIX #61: Если AI сейчас говорит — клиент перебивает, останавливаемся
    if (session.isSpeaking) {
      logger.info(`Session ${sessionId}: interruption detected — stopping AI speech`);
      session.isSpeaking = false;
      // Небольшая пауза перед ответом
      await new Promise(r => setTimeout(r, 300));
    }

    if (session.turns.length >= this.config.maxTurns * 2) {
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

    if (!userText || userText.trim().length < 2) {
      const fallback = FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)];
      await this.speakAndRecord(sessionId, fallback);
      return;
    }

    logger.info(`Session ${sessionId}: user said: "${userText}"`);

    // ✅ FIX #60: Анализируем эмоции параллельно с подготовкой ответа
    const openai = getOpenAI();
    const sentimentPromise = openai.analyzeSentiment(userText);

    session.turns.push({ role: 'user', content: userText, timestamp: new Date().toISOString() });
    session.transcript += `Клиент: ${userText}\n`;

    // ✅ FIX #63: Быстрый intent без GPT
    const intent = await openai.classifyIntent(userText);

    // Быстрые ответы
    const quickKey = userText.toLowerCase().trim();
    const quickMatch = QUICK_RESPONSES[quickKey] ||
      (intent === 'refuse' ? QUICK_RESPONSES['не интересует'] : null) ||
      (intent === 'agree' ? QUICK_RESPONSES['да'] : null);

    if (quickMatch) {
      await this.speakAndRecord(sessionId, quickMatch.reply);
      if (quickMatch.shouldEnd) {
        setTimeout(() => this.endCall(sessionId, CallResult.ANSWERED), 2000);
      }
      return;
    }

    // ✅ FIX #60: Проверяем результат sentiment analysis
    const sentiment = await sentimentPromise;
    logger.info(`Session ${sessionId}: sentiment = ${sentiment.emotion} (shouldEnd=${sentiment.shouldEnd})`);

    if (sentiment.shouldEnd || sentiment.emotion === 'angry') {
      session.negativeCount++;
      if (session.negativeCount >= 1 || sentiment.emotion === 'angry') {
        const angryReply = ANGRY_RESPONSES[Math.floor(Math.random() * ANGRY_RESPONSES.length)];
        await this.speakAndRecord(sessionId, angryReply, sentiment.emotion);
        setTimeout(() => this.endCall(sessionId, CallResult.ANSWERED), 2000);
        return;
      }
    }

    // ✅ Filler пока GPT думает
    const filler = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
    this.synthesizeAndSend(sessionId, filler).catch(() => {});

    // ✅ FIX #63: Персонализированный промпт с именем клиента
    const recentTurns = session.turns.slice(-this.config.maxHistoryTurns);
    const personalPrompt = session.contactName
      ? `${this.config.systemPrompt}\n\nИмя клиента: ${session.contactName}. Обращайся по имени 1-2 раза за разговор.`
      : this.config.systemPrompt;

    // ✅ FIX #49: Используем дешёвую модель для простых вопросов
    const useCheapModel = sentiment.emotion === 'neutral' && intent !== 'question';

    const messages: any[] = [
      { role: 'system', content: personalPrompt },
      ...recentTurns.map(t => ({
        role: t.role === 'ai' ? 'assistant' : 'user',
        content: t.content,
      })),
    ];

    let aiResponse = '';
    try {
      const responsePromise = openai.chat(messages, useCheapModel);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('GPT timeout')), this.config.turnTimeoutMs)
      );
      aiResponse = await Promise.race([responsePromise, timeoutPromise]);
    } catch (err: any) {
      logger.error(`GPT error: ${err.message}`);
      aiResponse = 'Простите, не расслышал. Можете повторить?';
    }

    await this.speakAndRecord(sessionId, aiResponse, sentiment.emotion);
  }

  private async synthesizeAndSend(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      const tts = getYandexTTS();
      const audioFile = path.join(this.audioDir, `${sessionId}_${Date.now()}.mp3`);
      await tts.synthesizeToFile({ text }, audioFile);
      logger.info(`TTS: "${text.substring(0, 40)}..."`);
    } catch (err: any) {
      logger.error(`TTS error: ${err.message}`);
    }
  }

  async endCall(sessionId: string, result: CallResult): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';
    if (session.callTimeoutTimer) clearTimeout(session.callTimeoutTimer);

    onCallCompleted();

    try {
      await createCallLog(session.contactId, result);
    } catch (err: any) {
      logger.error(`Error saving call log: ${err.message}`);
    }

    const contact = ContactRepository.findById(session.contactId);
    if (contact) {
      ContactRepository.update(session.contactId, {
        lastCallAt: session.startTime,
        attemptCount: (contact.attemptCount || 0) + 1,
      });
    }

    // Чистим аудио этой сессии
    try {
      const files = fs.readdirSync(this.audioDir);
      files.filter(f => f.startsWith(sessionId))
        .forEach(f => fs.unlinkSync(path.join(this.audioDir, f)));
    } catch {}

    logger.info(`Session ${sessionId} ended | result: ${result} | turns: ${session.turns.length}`);
    logger.info(`Transcript:\n${session.transcript}`);
  }

  getSession(id: string) { return this.sessions.get(id); }
  getAllSessions() { return Array.from(this.sessions.values()); }
  getActiveSessions() { return Array.from(this.sessions.values()).filter(s => s.status === 'in_progress'); }
  updateConfig(c: Partial<AIVoiceConfig>) { this.config = { ...this.config, ...c }; }
}

let aiVoiceService: AIVoiceService;

export function initAIVoice(config?: Partial<AIVoiceConfig>): AIVoiceService {
  aiVoiceService = new AIVoiceService(config);
  return aiVoiceService;
}

export function getAIVoice(): AIVoiceService {
  if (!aiVoiceService) throw new Error('AI Voice not initialized');
  return aiVoiceService;
}

export default AIVoiceService;
