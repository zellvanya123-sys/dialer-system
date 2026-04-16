import { z } from 'zod';

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
    return {
      success: false,
      error: result.error.errors[0].message
    };
  }
  return { success: true };
}

export function validateCallResult(data: any): { success: boolean; error?: string } {
  const result = callResultSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors[0].message
    };
  }
  return { success: true };
}