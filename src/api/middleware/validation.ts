import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ✅ Простая API авторизация через заголовок X-API-Key
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;

  // Если API_KEY не задан в .env — пропускаем (для совместимости)
  if (!apiKey) {
    next();
    return;
  }

  const provided = req.headers['x-api-key'] || req.query.api_key;

  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }

  next();
}

export const contactSchema = z.object({
  phone: z.string().min(10, 'Phone required'),
  name: z.string().min(1, 'Name required'),
  email: z.string().email().optional(),
  timezone: z.string().optional(),
  country: z.string().optional(),
  externalId: z.string().optional(),
  sheetRowId: z.number().optional(),
});

export const callResultSchema = z.object({
  contactId: z.string(),
  result: z.enum(['answered', 'no_answer', 'busy', 'congested', 'invalid_number', 'answering_machine', 'hangup']),
  qualification: z.object({
    hasTask: z.boolean(),
    hasBudget: z.boolean(),
    decisionMaker: z.string(),
    launchDate: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
});

export function validateContact(data: any): { success: boolean; error?: string } {
  const result = contactSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.errors[0].message };
  }
  return { success: true };
}

export function validateCallResult(data: any): { success: boolean; error?: string } {
  const result = callResultSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.errors[0].message };
  }
  return { success: true };
}

// ✅ Валидация телефона с понятной ошибкой
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digits = phone.replace(/\D/g, '');
  const isRussian = digits.startsWith('7') || digits.startsWith('8');

  if (isRussian && digits.length !== 11) {
    return {
      valid: false,
      error: `Российский номер должен содержать 11 цифр. У вас: ${digits.length} (${phone})`
    };
  }

  if (!isRussian && (digits.length < 10 || digits.length > 13)) {
    return {
      valid: false,
      error: `Неверный номер телефона: ${phone}. Цифр: ${digits.length} (нужно 10-13)`
    };
  }

  return { valid: true };
}
