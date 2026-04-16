export interface ScriptQuestion {
  id: string;
  text: string;
  options?: { value: string; label: string }[];
  type: 'yesno' | 'choice' | 'text' | 'budget';
  nextOn?: Record<string, string>;
}

export interface QualificationScript {
  id: string;
  name: string;
  questions: ScriptQuestion[];
}

export const DEFAULT_QUALIFICATION_SCRIPT: QualificationScript = {
  id: 'default',
  name: 'Квалификация лида',
  questions: [
    {
      id: 'q1',
      text: 'Добрый день! У вас актуальна задача по...?',
      type: 'yesno',
      nextOn: {
        'yes': 'q2',
        'no': 'reject'
      }
    },
    {
      id: 'q2',
      text: 'Есть ли бюджет на реализацию?',
      type: 'choice',
      options: [
        { value: 'yes', label: 'Да' },
        { value: 'no', label: 'Пока нет' },
        { value: 'thinking', label: 'В процессе' }
      ],
      nextOn: {
        'yes': 'q3',
        'no': 'q3',
        'thinking': 'q3'
      }
    },
    {
      id: 'q3',
      text: 'Кто принимает решение о покупке?',
      type: 'text',
      nextOn: {
        'default': 'q4'
      }
    },
    {
      id: 'q4',
      text: 'Когда планируете запуск?',
      type: 'choice',
      options: [
        { value: 'immediate', label: 'Сразу' },
        { value: 'month', label: 'В течение месяца' },
        { value: 'quarter', label: 'В течение квартала' },
        { value: 'unknown', label: 'Пока не знаю' }
      ]
    }
  ]
};

export interface QualificationResult {
  hasTask: boolean;
  hasBudget: boolean;
  decisionMaker: string;
  launchDate?: string;
  notes?: string;
}

export function parseQualification(
  answers: Record<string, string>
): QualificationResult {
  return {
    hasTask: answers['q1'] === 'yes',
    hasBudget: answers['q2'] === 'yes',
    decisionMaker: answers['q3'] || 'unknown',
    launchDate: answers['q4'],
    notes: JSON.stringify(answers)
  };
}

export function isQualifiedLead(qualification: QualificationResult): boolean {
  return qualification.hasTask === true;
}