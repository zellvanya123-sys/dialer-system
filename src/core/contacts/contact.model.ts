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
  callbackAt?: string;       // ✅ Дата перезвона (для "пока не актуально")
  callbackReason?: string;   // ✅ Причина отложенного звонка
  lastCallResult?: CallResult;
  lastCallDuration?: number;

  // ✅ Квалификация для военного контракта
  qualification?: {
    // Базовые данные
    age?: number;                    // Возраст
    city?: string;                   // Город проживания
    militaryRank?: string;           // Звание в военном билете
    militaryService?: string;        // Срочная/контракт/не служил
    hasCombtExperience?: boolean;    // Есть боевой опыт
    combatExperienceWhere?: string;  // Где служил (СВО, ЧВК, Чечня...)
    healthStatus?: string;           // Состояние здоровья
    wasOnSVO?: boolean;              // Был ли уже на СВО
    svoDismissed?: boolean;          // Комиссован или нет
    svoDismissCategory?: string;     // Категория комиссования (В, Д...)

    // Поля общей квалификации (для совместимости)
    hasTask?: boolean;
    hasBudget?: boolean;
    decisionMaker?: string;
    launchDate?: string;
    notes?: string;                  // Доп. заметки из разговора
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
  transcript?: string;       // ✅ Текст разговора
  recordingUrl?: string;
  scriptId?: string;
  notes?: string;
}
