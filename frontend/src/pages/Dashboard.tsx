import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import { Period, PeriodData } from '../types/dashboard'
import { mockData } from '../constants/mockData'
import { AgentHeader } from '../components/AgentHeader'
import { MetricCard } from '../components/MetricCard'
import { FunnelBar } from '../components/FunnelBar'

const COLORS = ['#639922', '#E24B4A', '#EF9F27']

const periods: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: '7days', label: '7 дней' },
  { key: '30days', label: '30 дней' }
]

export function Dashboard() {
  const [period, setPeriod] = useState<Period>('today')
  const data: PeriodData = mockData[period]

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

          {/* Reasons */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-4">Топ причин отказа</h3>
            <div className="space-y-3">
              {data.reasons.map((r, i) => (
                <div key={r.name} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-gray-600">{r.name}</span>
                  <span className="font-medium">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}