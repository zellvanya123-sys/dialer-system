import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  total: number; new: number; inProgress: number; leads: number
  rejected: number; noAnswer: number; dueForCall: number
  totalCalls: number; answeredCalls: number; totalDurationSec: number
  conversionRate: number; activeCalls: number; autoDialEnabled: boolean
  leadsByQualification: { withBudget: number; withTask: number; decisionMaker: number }
}

interface Contact {
  id: string; name: string; phone: string; status: string
  attemptCount: number; lastCallAt?: string; lastCallResult?: string
  timezone: string; country?: string
}

interface CallLog {
  id: string; contactId: string; phone: string
  startedAt: string; result: string; duration?: number
}

type Tab = 'overview' | 'contacts' | 'logs'

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый', call1: 'Звонок 1', call2: 'Звонок 2', call3: 'Звонок 3',
  lead: 'Лид', reject: 'Отказ', no_answer: 'Нет ответа', dont_call: 'Не звонить'
}
const STATUS_COLORS: Record<string, string> = {
  new: '#6366f1', call1: '#f59e0b', call2: '#f59e0b', call3: '#f59e0b',
  lead: '#10b981', reject: '#ef4444', no_answer: '#6b7280', dont_call: '#374151'
}
const RESULT_LABELS: Record<string, string> = {
  answered: '✅ Ответил', no_answer: '📵 Нет ответа', busy: '🔔 Занято',
  hangup: '📴 Сбросил', congested: '⚡ Перегруз', answering_machine: '🤖 Автоответчик'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString('ru') }
function fmtDur(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60
  return m > 0 ? `${m}м ${s}с` : `${s}с`
}
function fmtDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ─── Mini Bar Chart ───────────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 12, color: '#64748b', minWidth: 30, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 28, opacity: 0.15 }}>{icon}</div>
      </div>
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, loading }: { checked: boolean; onChange: () => void; loading?: boolean }) {
  return (
    <button onClick={onChange} disabled={loading} style={{
      width: 52, height: 28, borderRadius: 14, border: 'none', cursor: loading ? 'wait' : 'pointer',
      background: checked ? '#10b981' : '#d1d5db', position: 'relative', transition: 'background 0.2s', flexShrink: 0
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3, left: checked ? 27 : 3,
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
      }} />
    </button>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#6b7280'
  const label = STATUS_LABELS[status] || status
  return (
    <span style={{ background: color + '20', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [logs, setLogs] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [toggleLoading, setToggleLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [callLoading, setCallLoading] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [addPhone, setAddPhone] = useState('')
  const [addName, setAddName] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type })
    setTimeout(() => setNotification(null), 3500)
  }

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/calls/stats')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setStats(d)
      setApiError(false)
      setLastUpdated(new Date())
    } catch {
      setApiError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts')
      if (res.ok) setContacts(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchStats()
    fetchContacts()
  }, [fetchStats, fetchContacts])

  // Авто-обновление каждые 8 секунд
  useEffect(() => {
    const iv = setInterval(() => { fetchStats(); if (tab === 'contacts') fetchContacts() }, 8000)
    return () => clearInterval(iv)
  }, [fetchStats, fetchContacts, tab])

  const toggleAutoDial = async () => {
    if (!stats || toggleLoading) return
    setToggleLoading(true)
    try {
      const url = stats.autoDialEnabled ? '/api/calls/auto/disable' : '/api/calls/auto/enable'
      await fetch(url, { method: 'POST' })
      await fetchStats()
      notify(stats.autoDialEnabled ? '⏸ Автодозвон выключен' : '✅ Автодозвон включён')
    } catch {
      notify('Ошибка при переключении', 'error')
    } finally {
      setToggleLoading(false)
    }
  }

  const initiateCall = async (contactId: string, name: string) => {
    setCallLoading(contactId)
    try {
      const res = await fetch(`/api/calls/initiate/${contactId}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      notify(`📞 Звонок ${name} инициирован`)
      fetchStats()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setCallLoading(null)
    }
  }

  const addContact = async () => {
    if (!addPhone.trim()) { setAddError('Введите номер телефона'); return }
    setAddLoading(true)
    setAddError('')
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: addPhone.trim(), name: addName.trim() || 'Без имени' })
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setAddPhone(''); setAddName('')
      notify(`✅ Контакт добавлен: ${d.name}`)
      fetchContacts(); fetchStats()
    } catch (e: any) {
      setAddError(e.message)
    } finally {
      setAddLoading(false)
    }
  }

  const deleteContact = async (id: string, name: string) => {
    if (!confirm(`Удалить контакт "${name}"?`)) return
    try {
      await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      notify(`🗑️ Контакт удалён`)
      fetchContacts(); fetchStats()
    } catch {
      notify('Ошибка при удалении', 'error')
    }
  }

  const filteredContacts = contacts.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    return matchSearch && matchStatus
  })

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
        <div style={{ color: '#64748b', fontSize: 16 }}>Загружаем дашборд...</div>
      </div>
    </div>
  )

  const s = stats || { total: 0, new: 0, inProgress: 0, leads: 0, rejected: 0, noAnswer: 0, dueForCall: 0, totalCalls: 0, answeredCalls: 0, totalDurationSec: 0, conversionRate: 0, activeCalls: 0, autoDialEnabled: false, leadsByQualification: { withBudget: 0, withTask: 0, decisionMaker: 0 } }

  const reachRate = s.totalCalls > 0 ? Math.round((s.answeredCalls / s.totalCalls) * 100) : 0
  const leadRate = s.answeredCalls > 0 ? Math.round((s.leads / s.answeredCalls) * 100) : 0
  const avgDur = s.answeredCalls > 0 ? Math.round(s.totalDurationSec / s.answeredCalls) : 0

  const funnelItems = [
    { label: 'Загружено в базу', value: s.total, color: '#6366f1' },
    { label: 'Дозвонились', value: s.answeredCalls, color: '#3b82f6' },
    { label: 'Квалифицировано', value: s.leads, color: '#10b981' },
    { label: 'Отказ', value: s.rejected, color: '#ef4444' },
    { label: 'Нет ответа', value: s.noAnswer, color: '#94a3b8' },
  ]

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", background: '#f1f5f9', minHeight: '100vh' }}>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          background: notification.type === 'success' ? '#10b981' : '#ef4444',
          color: '#fff', padding: '12px 20px', borderRadius: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', fontSize: 14, fontWeight: 500,
          animation: 'fadeIn 0.2s ease'
        }}>
          {notification.text}
        </div>
      )}

      {/* Top Bar */}
      <div style={{ background: '#0f172a', color: '#fff', padding: '0 24px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>📞</span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>AI Автодозвон</span>
            {apiError && <span style={{ background: '#ef444420', color: '#f87171', border: '1px solid #ef444440', borderRadius: 6, padding: '2px 10px', fontSize: 12 }}>⚠️ Нет связи с API</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Автодозвон тоггл */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Автодозвон</span>
              <Toggle checked={s.autoDialEnabled} onChange={toggleAutoDial} loading={toggleLoading} />
              <span style={{ fontSize: 13, color: s.autoDialEnabled ? '#10b981' : '#94a3b8', fontWeight: 600 }}>
                {s.autoDialEnabled ? 'ВКЛ' : 'ВЫКЛ'}
              </span>
            </div>
            {/* Активные звонки */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: s.activeCalls > 0 ? '#10b98120' : '#ffffff10', borderRadius: 8, padding: '6px 12px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.activeCalls > 0 ? '#10b981' : '#475569', animation: s.activeCalls > 0 ? 'pulse 1.5s infinite' : 'none' }} />
              <span style={{ fontSize: 13, color: s.activeCalls > 0 ? '#10b981' : '#94a3b8' }}>
                {s.activeCalls} активных звонков
              </span>
            </div>
            {lastUpdated && (
              <span style={{ fontSize: 12, color: '#475569' }}>
                Обновлено {lastUpdated.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', gap: 4 }}>
          {[['overview', '📊 Обзор'], ['contacts', '👥 Контакты'], ['logs', '📋 История']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key as Tab)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '12px 20px',
              color: tab === key ? '#fff' : '#64748b', fontWeight: tab === key ? 600 : 400,
              borderBottom: tab === key ? '2px solid #6366f1' : '2px solid transparent',
              fontSize: 14, transition: 'all 0.15s'
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24 }}>

        {/* ── ОБЗОР ── */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <StatCard label="Всего контактов" value={fmt(s.total)} sub={`Ожидают: ${s.dueForCall}`} color="#6366f1" icon="👥" />
              <StatCard label="Всего звонков" value={fmt(s.totalCalls)} sub={`Дозвон: ${reachRate}%`} color="#3b82f6" icon="📞" />
              <StatCard label="Лидов" value={fmt(s.leads)} sub={`Конверсия: ${leadRate}%`} color="#10b981" icon="🎯" />
              <StatCard label="Средняя длительность" value={avgDur > 0 ? fmtDur(avgDur) : '—'} sub={`Всего: ${fmtDur(s.totalDurationSec)}`} color="#f59e0b" icon="⏱️" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>

              {/* Воронка */}
              <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>Воронка квалификации</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {funnelItems.map(item => (
                    <div key={item.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: '#374151' }}>{item.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{fmt(item.value)}</span>
                      </div>
                      <MiniBar value={item.value} max={s.total || 1} color={item.color} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Статусы + Квалификация */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>Статусы</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { label: '🆕 Новых', value: s.new, color: '#6366f1' },
                      { label: '🔄 В работе', value: s.inProgress, color: '#f59e0b' },
                      { label: '🎯 Лидов', value: s.leads, color: '#10b981' },
                      { label: '❌ Отказов', value: s.rejected, color: '#ef4444' },
                      { label: '📵 Нет ответа', value: s.noAnswer, color: '#6b7280' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#374151' }}>{item.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{fmt(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>Квалификация лидов</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { label: '💰 С бюджетом', value: s.leadsByQualification.withBudget },
                      { label: '✅ С задачей', value: s.leadsByQualification.withTask },
                      { label: '👔 ЛПР', value: s.leadsByQualification.decisionMaker },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, color: '#374151' }}>{item.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Быстрые действия */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>Быстрые действия</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={toggleAutoDial} disabled={toggleLoading} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  background: s.autoDialEnabled ? '#fee2e2' : '#d1fae5', color: s.autoDialEnabled ? '#ef4444' : '#10b981'
                }}>
                  {s.autoDialEnabled ? '⏸ Остановить дозвон' : '▶️ Запустить дозвон'}
                </button>
                <button onClick={() => setTab('contacts')} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  background: '#ede9fe', color: '#7c3aed'
                }}>
                  👥 Управление контактами
                </button>
                <button onClick={() => setTab('logs')} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  background: '#e0f2fe', color: '#0369a1'
                }}>
                  📋 История звонков
                </button>
                <button onClick={() => { fetchStats(); fetchContacts(); notify('🔄 Данные обновлены') }} style={{
                  padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  background: '#fff', color: '#64748b'
                }}>
                  🔄 Обновить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── КОНТАКТЫ ── */}
        {tab === 'contacts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Добавить контакт */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>➕ Добавить контакт</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="+79001234567"
                  onKeyDown={e => e.key === 'Enter' && addContact()}
                  style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', width: 180 }} />
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Имя (необязательно)"
                  onKeyDown={e => e.key === 'Enter' && addContact()}
                  style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', width: 200 }} />
                <button onClick={addContact} disabled={addLoading} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14
                }}>
                  {addLoading ? '...' : 'Добавить'}
                </button>
              </div>
              {addError && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>⚠️ {addError}</div>}
            </div>

            {/* Фильтры */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск по имени или телефону"
                style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', width: 260 }} />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', background: '#fff' }}>
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span style={{ fontSize: 13, color: '#64748b' }}>{filteredContacts.length} из {contacts.length}</span>
            </div>

            {/* Таблица */}
            <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
              {filteredContacts.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <div>{search || statusFilter !== 'all' ? 'Ничего не найдено' : 'Нет контактов. Добавьте первый!'}</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {['Имя', 'Телефон', 'Статус', 'Попыток', 'Последний звонок', 'Результат', 'Действия'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.slice(0, 100).map((c, i) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 500, fontSize: 14 }}>{c.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: 14, color: '#374151', fontFamily: 'monospace' }}>{c.phone}</td>
                        <td style={{ padding: '12px 16px' }}><Badge status={c.status} /></td>
                        <td style={{ padding: '12px 16px', fontSize: 14, color: '#64748b', textAlign: 'center' }}>{c.attemptCount}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>{fmtDate(c.lastCallAt)}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>{RESULT_LABELS[c.lastCallResult || ''] || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => initiateCall(c.id, c.name)} disabled={callLoading === c.id || c.status === 'dont_call'}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#d1fae5', color: '#10b981', fontWeight: 600, fontSize: 12 }}>
                              {callLoading === c.id ? '...' : '📞'}
                            </button>
                            <button onClick={() => deleteContact(c.id, c.name)}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#ef4444', fontWeight: 600, fontSize: 12 }}>
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {filteredContacts.length > 100 && (
                <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: '#94a3b8', borderTop: '1px solid #f1f5f9' }}>
                  Показано 100 из {filteredContacts.length}. Используйте поиск для уточнения.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ИСТОРИЯ ── */}
        {tab === 'logs' && (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>📋 История звонков</h3>
              <button onClick={async () => {
                try {
                  const res = await fetch('/api/contacts')
                  const data = await res.json()
                  const allLogs: CallLog[] = []
                  // собираем из contacts.json через отдельный эндпоинт если есть
                  setLogs(allLogs)
                  notify('История обновлена')
                } catch { notify('Ошибка загрузки', 'error') }
              }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                🔄 Обновить
              </button>
            </div>
            {logs.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ marginBottom: 8 }}>История звонков пока пуста</div>
                <div style={{ fontSize: 13 }}>После первых звонков здесь появятся записи</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {['Телефон', 'Начало', 'Длительность', 'Результат'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 14 }}>{log.phone}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>{fmtDate(log.startedAt)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 14 }}>{log.duration ? fmtDur(log.duration) : '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13 }}>{RESULT_LABELS[log.result] || log.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }
        * { box-sizing: border-box }
        button:hover:not(:disabled) { opacity: 0.85 }
        input:focus { border-color: #6366f1 !important }
      `}</style>
    </div>
  )
}
