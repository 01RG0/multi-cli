import { useStore } from '../store/useStore'

export default function StatsBar() {
  const stats = useStore((s) => s.stats)
  const wsConnected = useStore((s) => s.wsConnected)

  const items = [
    { label: 'Pending', value: stats.pending, color: '#94a3b8' },
    { label: 'Running', value: stats.running, color: '#facc15' },
    { label: 'Suspended', value: stats.suspended, color: '#fb923c' },
    { label: 'Completed', value: stats.completed, color: '#4ade80' },
    { label: 'Failed', value: stats.failed, color: '#f87171' },
  ]

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: '#1e293b',
            borderRadius: 8,
            padding: '8px 14px',
            minWidth: 80,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{item.label}</div>
        </div>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: wsConnected ? '#4ade80' : '#f87171',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {wsConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>
    </div>
  )
}
