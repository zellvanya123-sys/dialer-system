export interface PeriodData {
  metrics: {
    loaded: number
    reachRate: number
    qualRate: number
    escalationRate: number
  }
  deltas: {
    loaded: number
    reachRate: number
    qualRate: number
    escalationRate: number
  }
  chart: {
    labels: string[]
    calls: number[]
    qual: number[]
    noQual: number[]
  }
  donut: {
    qual: number
    noQual: number
    callback: number
  }
  funnel: {
    label: string
    value: number
  }[]
  reasons: {
    name: string
    count: number
  }[]
}

export type AgentStatus = 'active' | 'paused' | 'stopped'

export type Period = 'today' | '7days' | '30days'