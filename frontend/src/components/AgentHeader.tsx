import { AgentStatus } from '../types/dashboard'

interface Props {
  name: string
  campaign: string
  status: AgentStatus
}

const statusConfig = {
  active: { label: 'Активен', color: 'bg-success' },
  paused: { label: 'Пауза', color: 'bg-warning' },
  stopped: { label: 'Остановлен', color: 'bg-danger' }
}

export function AgentHeader({ name, campaign, status }: Props) {
  const s = statusConfig[status]
  const initials = name.split(' ').map(n => n[0]).join('')

  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm">
      <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
        {initials}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">{name}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs text-white ${s.color}`}>
            {s.label}
          </span>
        </div>
        <p className="text-sm text-gray-500">{campaign}</p>
      </div>
    </div>
  )
}