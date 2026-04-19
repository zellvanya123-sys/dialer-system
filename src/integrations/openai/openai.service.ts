import OpenAI from 'openai';
import { config } from '../../config/index';
import logger from '../../utils/logger';

// ✅ FIX #15: Exponential backoff для retry
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error?.status === 429 || error?.message?.includes('rate limit');
      const isOverload = error?.status === 503 || error?.status === 500;

      if ((isRateLimit || isOverload) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        logger.warn(`OpenAI retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (${error.status || error.message})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

class OpenAIService {
  private client: OpenAI;
  private model: string;
  private cheapModel: string; // ✅ FIX #49: дешёвая модель для простых ответов

  constructor() {
    if (!config.openai.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    });

    this.model = config.openai.model; // gpt-4o для сложного
    this.cheapModel = process.env.OPENAI_CHEAP_MODEL || 'gpt-4o-mini'; // для простого
    logger.info(`OpenAI initialized: ${this.model} / ${this.cheapModel}`);
  }

  // ✅ Основной чат с retry
  async chat(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    useCheapModel = false
  ): Promise<string> {
    const model = useCheapModel ? this.cheapModel : this.model;

    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 300, // для звонков достаточно короткого ответа
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');

      logger.info(`OpenAI [${model}]: ${content.substring(0, 80)}...`);
      return content;
    });
  }

  // ✅ FIX #60/#67: Анализ тональности/эмоций клиента (дешёвая модель)
  async analyzeSentiment(text: string): Promise<{
    emotion: 'positive' | 'negative' | 'neutral' | 'angry' | 'interested';
    shouldEnd: boolean;
    confidence: number;
  }> {
    try {
      const result = await withRetry(() =>
        this.client.chat.completions.create({
          model: this.cheapModel,
          messages: [
            {
              role: 'system',
              content: `Анализируй эмоцию клиента в звонке продаж. Отвечай ТОЛЬКО JSON без пояснений:
{"emotion":"positive|negative|neutral|angry|interested","shouldEnd":true|false,"confidence":0.0-1.0}
shouldEnd=true если клиент явно отказывается, злится или просит не звонить.`
            },
            { role: 'user', content: `Фраза клиента: "${text}"` }
          ],
          temperature: 0,
          max_tokens: 80,
        })
      );

      const raw = result.choices[0]?.message?.content || '{}';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        emotion: parsed.emotion || 'neutral',
        shouldEnd: parsed.shouldEnd || false,
        confidence: parsed.confidence || 0.5,
      };
    } catch (err: any) {
      logger.warn(`Sentiment analysis failed: ${err.message}`);
      return { emotion: 'neutral', shouldEnd: false, confidence: 0 };
    }
  }

  // ✅ Определяем заинтересован ли клиент (для квалификации)
  async classifyIntent(text: string): Promise<'agree' | 'refuse' | 'question' | 'other'> {
    const lower = text.toLowerCase();

    // Быстрые правила без GPT
    if (/^(да|конечно|хорошо|ок|интересно|расскажите)/.test(lower)) return 'agree';
    if (/^(нет|не надо|не интересует|не интересно|хватит|уберите|отстаньте)/.test(lower)) return 'refuse';
    if (/\?/.test(text) || /как|что|когда|сколько|почему|зачем/.test(lower)) return 'question';

    return 'other';
  }

  async chatWithFunctions(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    functions: OpenAI.FunctionDefinition[]
  ): Promise<{ content: string; functionCall?: string; arguments?: any }> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 500,
      });

      const message = response.choices[0]?.message;
      const content = message?.content || '';

      if (message?.function_call) {
        return {
          content,
          functionCall: message.function_call.name,
          arguments: JSON.parse(message.function_call.arguments || '{}'),
        };
      }
      return { content };
    });
  }
}

let openaiService: OpenAIService;

export function initOpenAI(): OpenAIService {
  openaiService = new OpenAIService();
  return openaiService;
}

export function getOpenAI(): OpenAIService {
  if (!openaiService) throw new Error('OpenAI not initialized. Call initOpenAI() first.');
  return openaiService;
}

export default OpenAIService;
