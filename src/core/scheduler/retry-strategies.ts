import { ContactStatus } from '../contacts/contact.model';

export interface RetryStrategy {
  name: string;
  intervals: number[];
  maxAttempts: number;
}

export const RETRY_STRATEGIES: Record<string, RetryStrategy> = {
  short: {
    name: 'short',
    intervals: [2, 2, 24],
    maxAttempts: 4,
  },
  aggressive: {
    name: 'aggressive',
    intervals: [0.5, 2, 4],
    maxAttempts: 4,
  },
  soft: {
    name: 'soft',
    intervals: [3, 24, 48],
    maxAttempts: 4,
  },
  workday: {
    name: 'workday',
    intervals: [4, 4, 24],
    maxAttempts: 4,
  },
};

export function getNextCallTime(
  strategy: RetryStrategy,
  attemptCount: number,
  timezone: string
): Date {
  if (attemptCount >= strategy.maxAttempts) {
    return new Date(0);
  }

  const intervalHours = strategy.intervals[attemptCount] || strategy.intervals[strategy.intervals.length - 1];
  const nextDate = new Date();
  
  nextDate.setHours(nextDate.getHours() + intervalHours);
  
  const hour = nextDate.getHours();
  if (hour < 9) {
    nextDate.setHours(9, 0, 0, 0);
  } else if (hour >= 20) {
    nextDate.setHours(20, 0, 0, 0);
  }

  return nextDate;
}

export function isWithinWorkingHours(date: Date, timezone: string): boolean {
  const hour = date.getHours();
  return hour >= 9 && hour < 20;
}

export function shouldCallContact(
  contact: { timezone: string; status: ContactStatus; attemptCount: number }
): boolean {
  if (contact.status === ContactStatus.LEAD) return false;
  if (contact.status === ContactStatus.REJECT) return false;
  if (contact.status === ContactStatus.DONT_CALL) return false;
  
  return true;
}