interface Props {
  items: { label: string; value: number }[]
}

export function FunnelBar({ items }: Props) {
  const max = items[0]?.value || 1

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const percent = Math.round((item.value / max) * 100)
        return (
          <div key={item.label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">{item.label}</span>
              <span className="font-medium">{item.value.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{percent}%</p>
          </div>
        )
      })}
    </div>
  )
}