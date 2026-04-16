export enum ContactStatus {
  NEW = 'new',
  CALL_1 = 'call1',
  CALL_2 = 'call2',
  CALL_3 = 'call3',
  LEAD = 'lead',
  REJECT = 'reject',
  NO_ANSWER = 'no_answer',
  DONT_CALL = 'dont_call'
}

export enum CallResult {
  ANSWERED = 'answered',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy',
  CONGESTED = 'congested',
  INVALID_NUMBER = 'invalid_number',
  MACHINE = 'answering_machine',
  HANGUP = 'hangup'
}

export interface Contact {
  id: string;
  phone: string;
  name: string;
  email?: string;
  timezone: string;
  country?: string;
  status: ContactStatus;
  attemptCount: number;
  lastCallAt?: string;
  nextCallAt?: string;
  lastCallResult?: CallResult;
  lastCallDuration?: number;
  qualification?: {
    hasTask: boolean;
    hasBudget: boolean;
    decisionMaker: string;
    launchDate?: string;
    notes?: string;
  };
  createdAt: string;
  updatedAt: string;
  externalId?: string;
  sheetRowId?: number;
}

export interface CallLog {
  id: string;
  contactId: string;
  phone: string;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  duration?: number;
  result: CallResult;
  recordingUrl?: string;
  scriptId?: string;
  notes?: string;
}