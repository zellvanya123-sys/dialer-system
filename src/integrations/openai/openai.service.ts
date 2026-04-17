import OpenAI from 'openai';
import { config } from '../../config/index';
import logger from '../../utils/logger';

class OpenAIService {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (!config.openai.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    });

    this.model = config.openai.model;
    logger.info(`OpenAI initialized with model: ${this.model}`);
  }

  async chat(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      logger.info(`OpenAI response: ${content.substring(0, 100)}...`);
      return content;
    } catch (error: any) {
      logger.error(`OpenAI error: ${error.message}`);
      throw error;
    }
  }

  async chatWithFunctions(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    functions: OpenAI.FunctionDefinition[]
  ): Promise<{ content: string; functionCall?: string; arguments?: any }> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 1000,
      });

      const message = response.choices[0]?.message;
      const content = message?.content || '';

      if (message?.function_call) {
        const fn = message.function_call;
        return {
          content,
          functionCall: fn.name,
          arguments: JSON.parse(fn.arguments || '{}'),
        };
      }

      return { content };
    } catch (error: any) {
      logger.error(`OpenAI function call error: ${error.message}`);
      throw error;
    }
  }

  async transcript(audioUrl: string): Promise<string> {
    try {
      const response = await this.client.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioUrl as any,
        language: 'ru',
      });

      return response.text;
    } catch (error: any) {
      logger.error(`OpenAI transcript error: ${error.message}`);
      throw error;
    }
  }
}

let openaiService: OpenAIService;

export function initOpenAI(): OpenAIService {
  openaiService = new OpenAIService();
  return openaiService;
}

export function getOpenAI(): OpenAIService {
  if (!openaiService) {
    throw new Error('OpenAI not initialized. Call initOpenAI() first.');
  }
  return openaiService;
}

export default OpenAIService;