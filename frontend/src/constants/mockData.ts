import { PeriodData } from '../types/dashboard'

export const mockData: Record<string, PeriodData> = {
  today: {
    metrics: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    deltas: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    chart: { labels: [], calls: [], qual: [], noQual: [] },
    donut: { qual: 0, noQual: 0, callback: 0 },
    funnel: [
      { label: 'Загружено', value: 0 },
      { label: 'Дозвон', value: 0 },
      { label: 'Разговор', value: 0 },
      { label: 'Квалифицировано', value: 0 },
      { label: 'В CRM', value: 0 }
    ],
    reasons: []
  },
  '7days': {
    metrics: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    deltas: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    chart: { labels: [], calls: [], qual: [], noQual: [] },
    donut: { qual: 0, noQual: 0, callback: 0 },
    funnel: [
      { label: 'Загружено', value: 0 },
      { label: 'Дозвон', value: 0 },
      { label: 'Разговор', value: 0 },
      { label: 'Квалифицировано', value: 0 },
      { label: 'В CRM', value: 0 }
    ],
    reasons: []
  },
  '30days': {
    metrics: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    deltas: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    chart: { labels: [], calls: [], qual: [], noQual: [] },
    donut: { qual: 0, noQual: 0, callback: 0 },
    funnel: [
      { label: 'Загружено', value: 0 },
      { label: 'Дозвон', value: 0 },
      { label: 'Разговор', value: 0 },
      { label: 'Квалифицировано', value: 0 },
      { label: 'В CRM', value: 0 }
    ],
    reasons: []
  }
}