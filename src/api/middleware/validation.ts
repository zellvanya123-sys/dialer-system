import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ✅ FIX #1: requireApiKey теперь также принимает Basic Auth
// Это позволяет дашборду (защищённому Basic Auth) работать без отдельного API ключа
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;
  const login = process.env.DASHBOARD_LOGIN || 'admin';
  const password = process.env.DASHBOARD_PASSWORD || 'dialer123';

  // Проверяем Basic Auth заголовок (дашборд)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      const user = decoded.slice(0, colonIndex);
      const pass = decoded.slice(colonIndex + 1);
      if (user === login && pass === password) {
        next();
        return;
      }
    } catch {}
  }

  // Проверяем API ключ (внешние интеграции)
  if (apiKey) {
    const provided = req.headers['x-api-key'] || req.query.api_key;
    if (provided && provided === apiKey) {
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }

  // Если API_KEY не задан — пропускаем (режим разработки)
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
