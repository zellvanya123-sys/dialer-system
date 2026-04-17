interface Props {
  label: string
  value: number
  suffix?: string
  delta?: number
}

export function MetricCard({ label, value, suffix = '', delta }: Props) {
  const isPositive = (delta || 0) > 0
  const isNegative = (delta || 0) < 0
  const deltaColor = isPositive ? 'text-success' : isNegative ? 'text-danger' : 'text-gray-400'
  const arrow = isPositive ? '↑' : isNegative ? '↓' : ''
  
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-gray-900">
          {value.toLocaleString()}{suffix}
        </span>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-sm font-medium ${deltaColor}`}>
            {arrow} {Math.abs(delta || 0)}{suffix}
          </span>
        )}
      </div>
    </div>
  )
}