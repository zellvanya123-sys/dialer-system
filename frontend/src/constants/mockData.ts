import { PeriodData } from '../types/dashboard'

export const mockData: Record<string, PeriodData> = {
  today: {
    metrics: {
      loaded: 312,
      reachRate: 67,
      qualRate: 23,
      escalationRate: 8
    },
    deltas: {
      loaded: 45,
      reachRate: 5,
      qualRate: -2,
      escalationRate: 1
    },
    chart: {
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'],
      calls: [28, 45, 52, 38, 41, 55, 48, 32, 18],
      qual: [5, 12, 15, 8, 11, 18, 14, 6, 3],
      noQual: [23, 33, 37, 30, 30, 37, 34, 26, 15]
    },
    donut: {
      qual: 72,
      noQual: 137,
      callback: 103
    },
    funnel: [
      { label: 'Загружено', value: 312 },
      { label: 'Дозвон', value: 209 },
      { label: 'Разговор', value: 156 },
      { label: 'Квалифицировано', value: 72 },
      { label: 'В CRM', value: 25 }
    ],
    reasons: [
      { name: 'Нет бюджета', count: 45 },
      { name: 'Не готов к покупке', count: 38 },
      { name: 'Уже купили', count: 29 },
      { name: 'Нужно больше времени', count: 22 },
      { name: 'Конкурент дешевле', count: 18 }
    ]
  },
  '7days': {
    metrics: {
      loaded: 1847,
      reachRate: 71,
      qualRate: 28,
      escalationRate: 6
    },
    deltas: {
      loaded: 312,
      reachRate: 4,
      qualRate: 3,
      escalationRate: -1
    },
    chart: {
      labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
      calls: [245, 312, 287, 356, 298, 124, 225],
      qual: [62, 89, 78, 102, 85, 31, 58],
      noQual: [183, 223, 209, 254, 213, 93, 167]
    },
    donut: {
      qual: 517,
      noQual: 797,
      callback: 533
    },
    funnel: [
      { label: 'Загружено', value: 1847 },
      { label: 'Дозвон', value: 1311 },
      { label: 'Разговор', value: 942 },
      { label: 'Квалифицировано', value: 517 },
      { label: 'В CRM', value: 181 }
    ],
    reasons: [
      { name: 'Нет бюджета', count: 267 },
      { name: 'Не готов к покупке', count: 198 },
      { name: 'Уже купили', count: 156 },
      { name: 'Нужно больше времени', count: 134 },
      { name: 'Конкурент дешевле', count: 98 }
    ]
  },
  '30days': {
    metrics: {
      loaded: 8934,
      reachRate: 69,
      qualRate: 25,
      escalationRate: 7
    },
    deltas: {
      loaded: 1245,
      reachRate: 2,
      qualRate: 1,
      escalationRate: 0
    },
    chart: {
      labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      calls: [245, 312, 287, 356, 298, 245, 312, 356, 287, 398, 356, 312, 287, 245, 198],
      qual: [62, 89, 78, 102, 85, 62, 89, 102, 78, 115, 102, 89, 78, 62, 48],
      noQual: [183, 223, 209, 254, 213, 183, 223, 254, 209, 283, 254, 223, 209, 183, 150]
    },
    donut: {
      qual: 2233,
      noQual: 3931,
      callback: 2770
    },
    funnel: [
      { label: 'Загружено', value: 8934 },
      { label: 'Дозвон', value: 6165 },
      { label: 'Разговор', value: 4456 },
      { label: 'Квалифицировано', value: 2233 },
      { label: 'В CRM', value: 625 }
    ],
    reasons: [
      { name: 'Нет бюджета', count: 1234 },
      { name: 'Не готов к покупке', count: 987 },
      { name: 'Уже купили', count: 756 },
      { name: 'Нужно больше времени', count: 543 },
      { name: 'Конкурент дешевле', count: 432 }
    ]
  }
}