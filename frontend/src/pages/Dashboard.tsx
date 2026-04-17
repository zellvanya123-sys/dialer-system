import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import { Period } from '../types/dashboard'
import { AgentHeader } from '../components/AgentHeader'
import { MetricCard } from '../components/MetricCard'
import { FunnelBar } from '../components/FunnelBar'

const COLORS = ['#639922', '#E24B4A', '#EF9F27']

const periods: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: '7days', label: '7 дней' },
  { key: '30days', label: '30 дней' }
]

interface StatsData {
  total: number
  new: number
  inProgress: number
  leads: number
  rejected: number
  noAnswer: number
  dueForCall: number
  totalCalls: number
  answeredCalls: number
  totalDurationSec: number
  conversionRate: number
  leadsByQualification: { withBudget: number; withTask: number; decisionMaker: number }
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>('today')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/calls/stats')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => setStats({ total: 0, new: 0, inProgress: 0, leads: 0, rejected: 0, noAnswer: 0, dueForCall: 0, totalCalls: 0, answeredCalls: 0, totalDurationSec: 0, conversionRate: 0, leadsByQualification: { withBudget: 0, withTask: 0, decisionMaker: 0 } }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/calls/stats')
        .then(r => r.json())
        .then(d => setStats(d))
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  if (loading || !stats) return <div className="p-6">Загрузка...</div>

  const reachRate = stats.totalCalls > 0 ? Math.round((stats.answeredCalls / stats.totalCalls) * 100) : 0
  const qualRate = stats.leads > 0 && stats.totalCalls > 0 ? Math.round((stats.leads / stats.totalCalls) * 100) : 0
  const reach = stats.total - stats.new - stats.inProgress - stats.rejected - stats.noAnswer
  const qual = stats.leads
  const noQual = stats.rejected + stats.noAnswer
  const callback = stats.dueForCall

  const data = {
    metrics: {
      loaded: stats.total,
      reachRate,
      qualRate,
      escalationRate: 0
    },
    deltas: { loaded: 0, reachRate: 0, qualRate: 0, escalationRate: 0 },
    chart: {
      labels: [],
      calls: [],
      qual: [],
      noQual: []
    },
    donut: { qual, noQual, callback },
    funnel: [
      { label: 'Загружено', value: stats.total },
      { label: 'Дозвон', value: reach },
      { label: 'Разговор', value: stats.answeredCalls },
      { label: 'Квалифицировано', value: qual },
      { label: 'В CRM', value: 0 }
    ],
    reasons: []
  }

  const chartData = data.chart.labels.map((label, i) => ({
    name: label,
    Звонков: data.chart.calls[i],
    Квалифицировано: data.chart.qual[i],
    'Не квалифицировано': data.chart.noQual[i]
  }))

  const donutData = [
    { name: 'Квалифицировано', value: data.donut.qual },
    { name: 'Не квалифицировано', value: data.donut.noQual },
    { name: 'Перезвонить', value: data.donut.callback }
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <AgentHeader name="Агент 1" campaign="ТехноСтрой — Ремонт квартир" status="active" />

        {/* Period Switcher */}
        <div className="flex gap-2">
          {periods.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                period === p.key
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Загружено лидов"
            value={data.metrics.loaded}
            delta={data.deltas.loaded}
          />
          <MetricCard
            label="Дозвон %"
            value={data.metrics.reachRate}
            suffix="%"
            delta={data.deltas.reachRate}
          />
          <MetricCard
            label="Квалифицировано %"
            value={data.metrics.qualRate}
            suffix="%"
            delta={data.deltas.qualRate}
          />
          <MetricCard
            label="Эскалаций %"
            value={data.metrics.escalationRate}
            suffix="%"
            delta={data.deltas.escalationRate}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Bar Chart */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-4">Звонки по дням</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Звонков" fill="#378ADD" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Квалифицировано" fill="#639922" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Не квалифицировано" fill="#E24B4A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Donut Chart */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-4">Распределение</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Funnel */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-4">Воронка квалификации</h3>
            <FunnelBar items={data.funnel} />
          </div>

          {/* Reasons - пока пусто, заполнится при звонках */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-4">Топ причин отказа</h3>
            <p className="text-gray-400 text-sm">Нет данных пока</p>
          </div>
        </div>
      </div>
    </div>
  )
}