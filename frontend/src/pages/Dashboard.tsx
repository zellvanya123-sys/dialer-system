import { useState, useEffect, useCallback, useRef } from 'react'

interface Stats {
  total: number; new: number; inProgress: number; leads: number
  rejected: number; noAnswer: number; dueForCall: number
  totalCalls: number; answeredCalls: number; totalDurationSec: number
  conversionRate: number; activeCalls: number; autoDialEnabled: boolean
  leadsByQualification?: { withBudget: number; withTask: number; decisionMaker: number }
}
interface Contact {
  id: string; name: string; phone: string; status: string
  attemptCount: number; lastCallAt?: string; lastCallResult?: string
}
// ✅ FIX #3: Интерфейс истории звонков
interface CallLog {
  id: string; contactId: string
  contactName: string; contactPhone: string
  startedAt: string; duration?: number; result: string
}
type Tab = 'overview' | 'contacts' | 'logs'

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый', call1: 'Звонок 1', call2: 'Звонок 2', call3: 'Звонок 3',
  lead: 'Лид', reject: 'Отказ', no_answer: 'Нет ответа', dont_call: 'Не звонить'
}
const STATUS_COLORS: Record<string, string> = {
  new: '#818cf8', call1: '#fbbf24', call2: '#fbbf24', call3: '#fbbf24',
  lead: '#34d399', reject: '#f87171', no_answer: '#64748b', dont_call: '#475569'
}
const RESULT_LABELS: Record<string, string> = {
  answered: 'Ответил', no_answer: 'Нет ответа', busy: 'Занято',
  hangup: 'Сбросил', congested: 'Перегруз', answering_machine: 'Автоответчик'
}
const RESULT_COLORS: Record<string, string> = {
  answered: '#34d399', no_answer: '#f87171', busy: '#fbbf24',
  hangup: '#64748b', congested: '#f87171', answering_machine: '#818cf8'
}
const RESULT_ICONS: Record<string, string> = {
  answered: '✓', no_answer: '✗', busy: '~', hangup: '↩', congested: '!', answering_machine: '⊙'
}

const fmt = (n: number) => n.toLocaleString('ru')
const fmtDur = (sec: number) => { const m = Math.floor(sec / 60), s = sec % 60; return m > 0 ? `${m}м ${s}с` : `${s}с` }
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function FunnelBar({ value, max, color, label, count }: { value: number; max: number; color: string; label: string; count: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="funnel-row">
      <div className="funnel-label">
        <span>{label}</span>
        <span className="funnel-count">{fmt(count)}</span>
      </div>
      <div className="funnel-track">
        <div className="funnel-fill" style={{ width: `${pct}%`, background: color }} />
        <span className="funnel-pct">{pct}%</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent, icon }: { label: string; value: string | number; sub?: string; accent: string; icon: string }) {
  return (
    <div className="stat-card" style={{ '--accent': accent } as any}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      <div className="stat-glow" />
    </div>
  )
}

function Toggle({ checked, onChange, loading }: { checked: boolean; onChange: () => void; loading?: boolean }) {
  return (
    <button className={`toggle ${checked ? 'on' : ''}`} onClick={onChange} disabled={loading}>
      <div className="toggle-knob" />
    </button>
  )
}

function Badge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#64748b'
  return <span className="badge" style={{ '--bc': color } as any}>{STATUS_LABELS[status] || status}</span>
}

function ResultBadge({ result }: { result: string }) {
  const color = RESULT_COLORS[result] || '#64748b'
  const icon = RESULT_ICONS[result] || '?'
  const label = RESULT_LABELS[result] || result
  return (
    <span className="result-chip" style={{ '--rc': color } as any}>
      {icon} {label}
    </span>
  )
}

function Notification({ text, type }: { text: string; type: 'success' | 'error' }) {
  return (
    <div className={`notif ${type}`}>
      <span className="notif-dot" />
      {text}
    </div>
  )
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [logs, setLogs] = useState<CallLog[]>([])          // ✅ FIX #3
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [toggleLoading, setToggleLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [callLoading, setCallLoading] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [logSearch, setLogSearch] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addName, setAddName] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsBatch, setSheetsBatch] = useState('500')
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsResult, setSheetsResult] = useState<any>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [csvResult, setCsvResult] = useState<any>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type }); setTimeout(() => setNotification(null), 4000)
  }

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/calls/stats')
      if (!res.ok) throw new Error()
      setStats(await res.json()); setApiError(false); setLastUpdated(new Date())
    } catch { setApiError(true) } finally { setLoading(false) }
  }, [])

  const fetchContacts = useCallback(async () => {
    try { const res = await fetch('/api/contacts'); if (res.ok) setContacts(await res.json()) } catch { }
  }, [])

  // ✅ FIX #3: Загружаем историю звонков
  const fetchLogs = useCallback(async () => {
    try { const res = await fetch('/api/calls/logs'); if (res.ok) setLogs(await res.json()) } catch { }
  }, [])

  useEffect(() => { fetchStats(); fetchContacts(); fetchLogs() }, [fetchStats, fetchContacts, fetchLogs])

  useEffect(() => {
    const iv = setInterval(() => {
      fetchStats()
      if (tab === 'contacts') fetchContacts()
      if (tab === 'logs') fetchLogs()
    }, 8000)
    return () => clearInterval(iv)
  }, [fetchStats, fetchContacts, fetchLogs, tab])

  const toggleAutoDial = async () => {
    if (!stats || toggleLoading) return
    setToggleLoading(true)
    try {
      await fetch(stats.autoDialEnabled ? '/api/calls/auto/disable' : '/api/calls/auto/enable', { method: 'POST' })
      await fetchStats()
      notify(stats.autoDialEnabled ? 'Автодозвон остановлен' : 'Автодозвон запущен')
    } catch { notify('Ошибка', 'error') } finally { setToggleLoading(false) }
  }

  const initiateCall = async (contactId: string, name: string) => {
    setCallLoading(contactId)
    try {
      const res = await fetch(`/api/calls/initiate/${contactId}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      notify(`Звонок ${name} инициирован`); fetchStats()
    } catch (e: any) { notify(e.message, 'error') } finally { setCallLoading(null) }
  }

  const addContact = async () => {
    if (!addPhone.trim()) { setAddError('Введите номер'); return }
    setAddLoading(true); setAddError('')
    try {
      const res = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: addPhone.trim(), name: addName.trim() || 'Без имени' }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setAddPhone(''); setAddName(''); notify(`Добавлен: ${d.name}`); fetchContacts(); fetchStats()
    } catch (e: any) { setAddError(e.message) } finally { setAddLoading(false) }
  }

  const deleteContact = async (id: string, name: string) => {
    if (!confirm(`Удалить "${name}"?`)) return
    try { await fetch(`/api/contacts/${id}`, { method: 'DELETE' }); notify('Контакт удалён'); fetchContacts(); fetchStats() }
    catch { notify('Ошибка', 'error') }
  }

  const importFromSheets = async () => {
    if (!sheetsUrl.trim()) { notify('Вставьте ссылку на Google Sheets', 'error'); return }
    setSheetsLoading(true); setSheetsResult(null)
    try {
      const res = await fetch('/api/upload/google-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sheetsUrl.trim(), batchSize: parseInt(sheetsBatch) || 500 }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setSheetsResult(d); notify(`Импортировано ${d.imported} контактов`); fetchContacts(); fetchStats()
    } catch (e: any) { notify(e.message, 'error'); setSheetsResult({ error: e.message }) } finally { setSheetsLoading(false) }
  }

  const importCsv = async (file: File) => {
    setCsvLoading(true); setCsvResult(null)
    const formData = new FormData(); formData.append('file', file)
    try {
      const res = await fetch('/api/upload/csv', { method: 'POST', body: formData })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setCsvResult(d); notify(`Импортировано ${d.imported} контактов`); fetchContacts(); fetchStats()
    } catch (e: any) { notify(e.message, 'error'); setCsvResult({ error: e.message }) } finally { setCsvLoading(false) }
  }

  const filtered = contacts.filter(c =>
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)) &&
    (statusFilter === 'all' || c.status === statusFilter)
  )

  const filteredLogs = logs.filter(l =>
    l.contactName.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.contactPhone.includes(logSearch)
  )

  if (loading) return (
    <div className="splash">
      <div className="splash-inner">
        <div className="splash-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="23" stroke="#34d399" strokeWidth="1.5" strokeDasharray="4 2" />
            <path d="M16 18c0-1.1.9-2 2-2h2a2 2 0 012 2v3a2 2 0 01-2 2h-1c0 3.3 2.7 6 6 6v-1a2 2 0 012-2h3a2 2 0 012 2v2a2 2 0 01-2 2c-7.2 0-13-5.8-13-13z" fill="#34d399" />
          </svg>
        </div>
        <div className="splash-text">Загрузка системы...</div>
        <div className="splash-bar"><div className="splash-fill" /></div>
      </div>
    </div>
  )

  const s = stats || { total: 0, new: 0, inProgress: 0, leads: 0, rejected: 0, noAnswer: 0, dueForCall: 0, totalCalls: 0, answeredCalls: 0, totalDurationSec: 0, conversionRate: 0, activeCalls: 0, autoDialEnabled: false }
  const lq = s.leadsByQualification || { withBudget: 0, withTask: 0, decisionMaker: 0 }
  const reachRate = s.totalCalls > 0 ? Math.round(s.answeredCalls / s.totalCalls * 100) : 0
  const leadRate = s.answeredCalls > 0 ? Math.round(s.leads / s.answeredCalls * 100) : 0
  const avgDur = s.answeredCalls > 0 ? Math.round(s.totalDurationSec / s.answeredCalls) : 0

  return (
    <div className="app">
      {notification && <Notification text={notification.text} type={notification.type} />}

      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor" />
              </svg>
            </div>
            <span className="brand-name">AI Autodial</span>
            {apiError && <span className="error-badge">● Нет связи</span>}
          </div>
          <div className="header-controls">
            <div className="active-pill" data-active={s.activeCalls > 0}>
              <span className="pulse-dot" />
              <span>{s.activeCalls} активных</span>
            </div>
            <div className="autodial-control">
              <span className="control-label">Автодозвон</span>
              <Toggle checked={s.autoDialEnabled} onChange={toggleAutoDial} loading={toggleLoading} />
              <span className="control-status" data-on={s.autoDialEnabled}>{s.autoDialEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </div>
            {lastUpdated && <span className="update-time">{lastUpdated.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </div>
        </div>
        <nav className="nav">
          {([['overview', 'Обзор'], ['contacts', 'Контакты'], ['logs', `История ${logs.length > 0 ? `(${logs.length})` : ''}`]] as const).map(([key, label]) => (
            <button key={key} className={`nav-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}
              {tab === key && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">

        {/* ═══ ОБЗОР ═══ */}
        {tab === 'overview' && (
          <div className="page">
            <div className="stats-grid">
              <StatCard label="Контактов" value={fmt(s.total)} sub={`${s.dueForCall} ожидают`} accent="#818cf8" icon="◎" />
              <StatCard label="Звонков" value={fmt(s.totalCalls)} sub={`Дозвон ${reachRate}%`} accent="#38bdf8" icon="◈" />
              <StatCard label="Лидов" value={fmt(s.leads)} sub={`Конверсия ${leadRate}%`} accent="#34d399" icon="◆" />
              <StatCard label="Ср. время" value={avgDur > 0 ? fmtDur(avgDur) : '—'} sub={fmtDur(s.totalDurationSec)} accent="#fb923c" icon="◷" />
            </div>

            <div className="overview-grid">
              <div className="card">
                <div className="card-header"><h2 className="card-title">Воронка продаж</h2></div>
                <div className="funnel">
                  <FunnelBar value={s.total} max={s.total || 1} color="#818cf8" label="Загружено" count={s.total} />
                  <FunnelBar value={s.answeredCalls} max={s.total || 1} color="#38bdf8" label="Дозвонились" count={s.answeredCalls} />
                  <FunnelBar value={s.leads} max={s.total || 1} color="#34d399" label="Лиды" count={s.leads} />
                  <FunnelBar value={s.rejected} max={s.total || 1} color="#f87171" label="Отказ" count={s.rejected} />
                  <FunnelBar value={s.noAnswer} max={s.total || 1} color="#475569" label="Нет ответа" count={s.noAnswer} />
                </div>
              </div>

              <div className="right-col">
                <div className="card">
                  <div className="card-header"><h2 className="card-title">Статусы</h2></div>
                  <div className="status-list">
                    {[
                      { label: 'Новых', value: s.new, color: '#818cf8' },
                      { label: 'В работе', value: s.inProgress, color: '#fbbf24' },
                      { label: 'Лидов', value: s.leads, color: '#34d399' },
                      { label: 'Отказов', value: s.rejected, color: '#f87171' },
                      { label: 'Нет ответа', value: s.noAnswer, color: '#64748b' },
                    ].map(item => (
                      <div key={item.label} className="status-row">
                        <div className="status-dot" style={{ background: item.color }} />
                        <span className="status-name">{item.label}</span>
                        <span className="status-val" style={{ color: item.color }}>{fmt(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><h2 className="card-title">Квалификация</h2></div>
                  <div className="status-list">
                    {[
                      { label: 'С бюджетом', value: lq.withBudget },
                      { label: 'С задачей', value: lq.withTask },
                      { label: 'ЛПР', value: lq.decisionMaker },
                    ].map(item => (
                      <div key={item.label} className="status-row">
                        <div className="status-dot" style={{ background: '#34d399' }} />
                        <span className="status-name">{item.label}</span>
                        <span className="status-val" style={{ color: '#34d399' }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Управление</h2></div>
              <div className="actions-row">
                <button className={`action-btn primary ${s.autoDialEnabled ? 'danger' : 'success'}`} onClick={toggleAutoDial} disabled={toggleLoading}>
                  {s.autoDialEnabled ? '⏸ Остановить дозвон' : '▶ Запустить дозвон'}
                </button>
                <button className="action-btn secondary" onClick={() => setTab('contacts')}>Управление контактами</button>
                <button className="action-btn secondary" onClick={() => setTab('logs')}>История звонков</button>
                <button className="action-btn ghost" onClick={() => { fetchStats(); fetchContacts(); fetchLogs(); notify('Данные обновлены') }}>↻ Обновить</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ КОНТАКТЫ ═══ */}
        {tab === 'contacts' && (
          <div className="page">
            <div className="card import-card sheets">
              <div className="import-header">
                <div className="import-icon sheets-icon">GS</div>
                <div>
                  <h3 className="card-title">Google Sheets</h3>
                  <p className="card-sub">Пачками до 5000 контактов</p>
                </div>
              </div>
              <div className="import-hint">Сделайте таблицу публичной. Колонки: <strong>Phone</strong> (обязательно), Name, Email</div>
              <div className="import-form">
                <input className="field" value={sheetsUrl} onChange={e => setSheetsUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
                <div className="import-row">
                  <select className="field select" value={sheetsBatch} onChange={e => setSheetsBatch(e.target.value)}>
                    {['100', '250', '500', '1000', '5000'].map(v => <option key={v} value={v}>{v} строк</option>)}
                  </select>
                  <button className="action-btn primary" onClick={importFromSheets} disabled={sheetsLoading}>
                    {sheetsLoading ? '⏳ Загрузка...' : '↓ Импортировать'}
                  </button>
                </div>
              </div>
              {sheetsResult && !sheetsResult.error && <div className="import-result success">Импортировано <strong>{sheetsResult.imported}</strong> из {sheetsResult.total} · Дубли: {sheetsResult.duplicates}</div>}
              {sheetsResult?.error && <div className="import-result error">{sheetsResult.error}</div>}
            </div>

            <div className="card import-card csv">
              <div className="import-header">
                <div className="import-icon csv-icon">CSV</div>
                <div>
                  <h3 className="card-title">CSV файл</h3>
                  <p className="card-sub">Excel/CSV в кодировке UTF-8</p>
                </div>
              </div>
              <input ref={csvRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) importCsv(e.target.files[0]) }} />
              <button className="action-btn secondary full-width" onClick={() => csvRef.current?.click()} disabled={csvLoading}>
                {csvLoading ? '⏳ Загрузка...' : '↑ Выбрать файл'}
              </button>
              {csvResult && !csvResult.error && <div className="import-result success">Импортировано <strong>{csvResult.imported}</strong> из {csvResult.total} · Дубли: {csvResult.duplicates}</div>}
              {csvResult?.error && <div className="import-result error">{csvResult.error}</div>}
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Добавить контакт</h2></div>
              <div className="add-form">
                <input className="field" value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="+79001234567" onKeyDown={e => e.key === 'Enter' && addContact()} />
                <input className="field" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Имя (необязательно)" onKeyDown={e => e.key === 'Enter' && addContact()} />
                <button className="action-btn primary" onClick={addContact} disabled={addLoading}>{addLoading ? '...' : '+ Добавить'}</button>
              </div>
              {addError && <div className="field-error">{addError}</div>}
            </div>

            <div className="filters">
              <input className="field search-field" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." />
              <select className="field select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span className="count-badge">{filtered.length} / {contacts.length}</span>
            </div>

            {filtered.length === 0 ? (
              <div className="card"><div className="empty-state"><div className="empty-icon">◎</div><div>{search || statusFilter !== 'all' ? 'Ничего не найдено' : 'Нет контактов — добавьте или импортируйте'}</div></div></div>
            ) : (
              <>
                <div className="contact-cards">
                  {filtered.slice(0, 100).map(c => (
                    <div key={c.id} className="contact-card">
                      <div className="contact-info">
                        <div className="contact-name">{c.name}</div>
                        <div className="contact-phone">{c.phone}</div>
                        <div className="contact-meta">
                          <Badge status={c.status} />
                          <span className="attempt-count">{c.attemptCount} поп.</span>
                          {c.lastCallResult && <ResultBadge result={c.lastCallResult} />}
                        </div>
                      </div>
                      <div className="contact-actions">
                        <button className="icon-btn call" onClick={() => initiateCall(c.id, c.name)} disabled={callLoading === c.id}>{callLoading === c.id ? '…' : '↗'}</button>
                        <button className="icon-btn del" onClick={() => deleteContact(c.id, c.name)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card table-card">
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>{['Имя', 'Телефон', 'Статус', 'Попыток', 'Последний звонок', 'Результат', ''].map(h => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, 100).map(c => (
                          <tr key={c.id}>
                            <td className="td-name">{c.name}</td>
                            <td className="td-phone">{c.phone}</td>
                            <td><Badge status={c.status} /></td>
                            <td className="td-center">{c.attemptCount}</td>
                            <td className="td-muted">{fmtDate(c.lastCallAt)}</td>
                            <td>{c.lastCallResult && <ResultBadge result={c.lastCallResult} />}</td>
                            <td>
                              <div className="td-actions">
                                <button className="icon-btn call" onClick={() => initiateCall(c.id, c.name)} disabled={callLoading === c.id}>{callLoading === c.id ? '…' : '↗'}</button>
                                <button className="icon-btn del" onClick={() => deleteContact(c.id, c.name)}>✕</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length > 100 && <div className="table-footer">Показано 100 из {filtered.length} — уточните поиск</div>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ FIX #3: ИСТОРИЯ ЗВОНКОВ — РЕАЛЬНЫЕ ДАННЫЕ ═══ */}
        {tab === 'logs' && (
          <div className="page">
            {/* Мини-статистика по истории */}
            <div className="stats-grid">
              <StatCard label="Всего звонков" value={fmt(logs.length)} sub="в базе" accent="#818cf8" icon="◈" />
              <StatCard label="Отвечено" value={fmt(logs.filter(l => l.result === 'answered').length)} sub={`${logs.length > 0 ? Math.round(logs.filter(l => l.result === 'answered').length / logs.length * 100) : 0}%`} accent="#34d399" icon="✓" />
              <StatCard label="Нет ответа" value={fmt(logs.filter(l => l.result === 'no_answer').length)} sub="" accent="#f87171" icon="✗" />
              <StatCard label="Автоответчик" value={fmt(logs.filter(l => l.result === 'answering_machine').length)} sub="" accent="#818cf8" icon="⊙" />
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <h2 className="card-title">История звонков</h2>
                <input className="field search-field" style={{ maxWidth: 240 }} value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="Поиск по имени или номеру..." />
              </div>

              {filteredLogs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">◈</div>
                  <div>{logs.length === 0 ? 'История появится после первых звонков' : 'Ничего не найдено'}</div>
                </div>
              ) : (
                <>
                  {/* Мобиль: карточки */}
                  <div className="contact-cards" style={{ padding: '12px 0' }}>
                    {filteredLogs.slice(0, 50).map(log => (
                      <div key={log.id} className="contact-card">
                        <div className="contact-info">
                          <div className="contact-name">{log.contactName}</div>
                          <div className="contact-phone">{log.contactPhone}</div>
                          <div className="contact-meta">
                            <ResultBadge result={log.result} />
                            {log.duration !== undefined && log.duration > 0 && (
                              <span className="attempt-count">⏱ {fmtDur(log.duration)}</span>
                            )}
                            <span className="attempt-count">{fmtDate(log.startedAt)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Десктоп: таблица */}
                  <div className="table-card" style={{ display: 'none' }}>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>{['Имя', 'Телефон', 'Результат', 'Длительность', 'Дата и время'].map(h => <th key={h}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {filteredLogs.slice(0, 200).map(log => (
                            <tr key={log.id}>
                              <td className="td-name">{log.contactName}</td>
                              <td className="td-phone">{log.contactPhone}</td>
                              <td><ResultBadge result={log.result} /></td>
                              <td className="td-muted">{log.duration && log.duration > 0 ? fmtDur(log.duration) : '—'}</td>
                              <td className="td-muted">{fmtDate(log.startedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredLogs.length > 200 && <div className="table-footer">Показано 200 из {filteredLogs.length}</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #090d14; --bg2: #0e1520; --bg3: #131c2b; --bg4: #1a2438;
          --border: rgba(255,255,255,0.07); --border2: rgba(255,255,255,0.12);
          --text: #e2e8f0; --text2: #94a3b8; --text3: #475569;
          --green: #34d399; --blue: #38bdf8; --indigo: #818cf8;
          --orange: #fb923c; --red: #f87171; --yellow: #fbbf24;
          --font: 'Space Grotesk', sans-serif; --mono: 'JetBrains Mono', monospace;
          --r: 12px; --r2: 8px;
        }
        body { background: var(--bg); color: var(--text); font-family: var(--font); }
        .splash { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
        .splash-inner { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 20px; }
        .splash-logo { animation: spin 3s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .splash-text { color: var(--text2); font-size: 14px; letter-spacing: .1em; text-transform: uppercase; }
        .splash-bar { width: 200px; height: 2px; background: var(--bg4); border-radius: 2px; overflow: hidden; }
        .splash-fill { height: 100%; width: 40%; background: var(--green); border-radius: 2px; animation: loading 1.5s ease-in-out infinite; }
        @keyframes loading { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
        .app { min-height: 100vh; display: flex; flex-direction: column; }
        .header { background: var(--bg2); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; backdrop-filter: blur(20px); }
        .header-inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 56px; gap: 12px; flex-wrap: wrap; }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #34d39930, #34d39910); border: 1px solid #34d39940; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--green); flex-shrink: 0; }
        .brand-name { font-weight: 700; font-size: 15px; letter-spacing: -.02em; }
        .error-badge { font-size: 11px; color: var(--red); background: #f8717115; border: 1px solid #f8717130; border-radius: 4px; padding: 2px 8px; }
        .header-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .active-pill { display: flex; align-items: center; gap: 6px; background: var(--bg3); border: 1px solid var(--border); border-radius: 20px; padding: 5px 12px; font-size: 12px; color: var(--text2); }
        .active-pill[data-active="true"] { border-color: #34d39940; color: var(--green); background: #34d39910; }
        .pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text3); flex-shrink: 0; }
        .active-pill[data-active="true"] .pulse-dot { background: var(--green); animation: pulse 2s ease-out infinite; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 #34d39960; } 70% { box-shadow: 0 0 0 6px #34d39900; } 100% { box-shadow: 0 0 0 0 #34d39900; } }
        .autodial-control { display: flex; align-items: center; gap: 8px; }
        .control-label { font-size: 12px; color: var(--text3); }
        .control-status { font-size: 12px; font-weight: 600; color: var(--text3); min-width: 32px; }
        .control-status[data-on="true"] { color: var(--green); }
        .update-time { font-size: 11px; color: var(--text3); font-family: var(--mono); display: none; }
        @media (min-width: 640px) { .update-time { display: block; } }
        .toggle { width: 44px; height: 24px; border-radius: 12px; border: none; background: var(--bg4); cursor: pointer; position: relative; transition: background .2s; flex-shrink: 0; outline: 1px solid var(--border); }
        .toggle.on { background: #34d39920; outline-color: #34d39960; }
        .toggle-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--text3); transition: left .2s, background .2s; }
        .toggle.on .toggle-knob { left: 23px; background: var(--green); }
        .nav { max-width: 1400px; margin: 0 auto; display: flex; padding: 0 16px; gap: 2px; overflow-x: auto; }
        .nav-btn { background: none; border: none; cursor: pointer; padding: 10px 14px; font-size: 13px; font-weight: 500; color: var(--text3); position: relative; transition: color .15s; white-space: nowrap; flex-shrink: 0; font-family: var(--font); }
        .nav-btn:hover { color: var(--text2); }
        .nav-btn.active { color: var(--text); }
        .nav-indicator { position: absolute; bottom: 0; left: 10px; right: 10px; height: 2px; background: var(--green); border-radius: 2px 2px 0 0; }
        .main { flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; padding: 16px; }
        .page { display: flex; flex-direction: column; gap: 16px; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (min-width: 640px) { .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; } }
        .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--r); padding: 20px; position: relative; overflow: hidden; transition: border-color .2s, transform .2s; }
        .stat-card:hover { border-color: var(--border2); transform: translateY(-1px); }
        .stat-icon { font-size: 18px; color: var(--accent, var(--indigo)); margin-bottom: 12px; display: block; }
        .stat-value { font-size: 28px; font-weight: 700; color: var(--text); line-height: 1; font-variant-numeric: tabular-nums; margin-bottom: 6px; }
        .stat-label { font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: .06em; }
        .stat-sub { font-size: 12px; color: var(--text3); margin-top: 4px; }
        .stat-glow { position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; border-radius: 50%; background: var(--accent, var(--indigo)); opacity: .06; filter: blur(20px); pointer-events: none; }
        .overview-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 900px) { .overview-grid { grid-template-columns: 1.5fr 1fr; } }
        .right-col { display: flex; flex-direction: column; gap: 16px; }
        .card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
        .card-header { padding: 18px 20px 0; }
        .card-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--text2); }
        .card-sub { font-size: 12px; color: var(--text3); margin-top: 2px; }
        .funnel { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 14px; }
        .funnel-label { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .funnel-label span:first-child { font-size: 13px; color: var(--text2); }
        .funnel-count { font-size: 13px; font-weight: 600; color: var(--text); font-family: var(--mono); }
        .funnel-track { height: 6px; background: var(--bg4); border-radius: 3px; overflow: visible; position: relative; }
        .funnel-fill { height: 100%; border-radius: 3px; transition: width .6s cubic-bezier(.4,0,.2,1); min-width: 2px; }
        .funnel-pct { position: absolute; right: 0; top: -18px; font-size: 11px; color: var(--text3); font-family: var(--mono); }
        .status-list { padding: 14px 20px 18px; display: flex; flex-direction: column; gap: 10px; }
        .status-row { display: flex; align-items: center; gap: 10px; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .status-name { font-size: 13px; color: var(--text2); flex: 1; }
        .status-val { font-size: 14px; font-weight: 700; font-family: var(--mono); }
        .actions-row { padding: 14px 20px 20px; display: flex; gap: 10px; flex-wrap: wrap; }
        .action-btn { padding: 9px 18px; border-radius: var(--r2); border: none; cursor: pointer; font-size: 13px; font-weight: 600; font-family: var(--font); transition: all .15s; white-space: nowrap; }
        .action-btn:disabled { opacity: .5; cursor: not-allowed; }
        .action-btn.primary { background: var(--green); color: #0a1a12; }
        .action-btn.primary:hover:not(:disabled) { background: #5eead4; }
        .action-btn.primary.danger { background: var(--red); color: #1a0a0a; }
        .action-btn.primary.danger:hover:not(:disabled) { background: #fca5a5; }
        .action-btn.primary.success { background: var(--green); color: #0a1a12; }
        .action-btn.secondary { background: var(--bg4); color: var(--text); border: 1px solid var(--border2); }
        .action-btn.secondary:hover:not(:disabled) { background: var(--bg3); }
        .action-btn.ghost { background: transparent; color: var(--text2); border: 1px solid var(--border); }
        .action-btn.ghost:hover:not(:disabled) { color: var(--text); border-color: var(--border2); }
        .action-btn.full-width { width: 100%; }
        .import-card { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .import-card.sheets { border-color: #38bdf830; }
        .import-card.csv { border-color: #fbbf2430; }
        .import-header { display: flex; align-items: center; gap: 14px; }
        .import-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: var(--mono); flex-shrink: 0; }
        .sheets-icon { background: #38bdf815; color: var(--blue); border: 1px solid #38bdf830; }
        .csv-icon { background: #fbbf2415; color: var(--yellow); border: 1px solid #fbbf2430; }
        .import-hint { font-size: 12px; color: var(--text3); background: var(--bg3); padding: 10px 14px; border-radius: var(--r2); line-height: 1.6; }
        .import-hint strong { color: var(--text2); }
        .import-form { display: flex; flex-direction: column; gap: 10px; }
        .import-row { display: flex; gap: 10px; }
        .import-result { font-size: 12px; padding: 10px 14px; border-radius: var(--r2); }
        .import-result.success { background: #34d39915; color: var(--green); border: 1px solid #34d39930; }
        .import-result.error { background: #f8717115; color: var(--red); border: 1px solid #f8717130; }
        .field { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--r2); padding: 9px 14px; font-size: 13px; color: var(--text); font-family: var(--font); outline: none; transition: border-color .15s; width: 100%; }
        .field::placeholder { color: var(--text3); }
        .field:focus { border-color: #34d39960; }
        .select { width: auto; min-width: 120px; flex-shrink: 0; cursor: pointer; }
        .field-error { font-size: 12px; color: var(--red); padding: 0 20px 16px; }
        .add-form { padding: 16px 20px 20px; display: flex; gap: 10px; flex-wrap: wrap; }
        .add-form .field { flex: 1; min-width: 140px; }
        .filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .search-field { flex: 1; min-width: 180px; }
        .count-badge { font-size: 12px; color: var(--text3); font-family: var(--mono); white-space: nowrap; }
        .empty-state { padding: 60px 20px; text-align: center; color: var(--text3); display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .empty-icon { font-size: 32px; opacity: .4; }
        .badge { display: inline-block; background: color-mix(in srgb, var(--bc) 15%, transparent); color: var(--bc); border: 1px solid color-mix(in srgb, var(--bc) 30%, transparent); border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .result-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rc, var(--text3)); background: color-mix(in srgb, var(--rc, #475569) 12%, transparent); border: 1px solid color-mix(in srgb, var(--rc, #475569) 25%, transparent); border-radius: 4px; padding: 2px 8px; white-space: nowrap; font-weight: 500; }
        .contact-cards { display: flex; flex-direction: column; gap: 8px; }
        .contact-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--r); padding: 14px 16px; display: flex; align-items: center; gap: 12px; transition: border-color .15s; }
        .contact-card:hover { border-color: var(--border2); }
        .contact-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
        .contact-name { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .contact-phone { font-size: 12px; color: var(--text3); font-family: var(--mono); }
        .contact-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .attempt-count { font-size: 11px; color: var(--text3); font-family: var(--mono); }
        .contact-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .icon-btn { width: 32px; height: 32px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; transition: all .15s; font-weight: 700; }
        .icon-btn:disabled { opacity: .4; cursor: not-allowed; }
        .icon-btn.call { background: #34d39915; color: var(--green); border: 1px solid #34d39930; }
        .icon-btn.call:hover:not(:disabled) { background: #34d39930; }
        .icon-btn.del { background: #f8717115; color: var(--red); border: 1px solid #f8717130; }
        .icon-btn.del:hover { background: #f8717130; }
        .table-card { display: none; }
        @media (min-width: 640px) {
          .contact-cards { display: none; }
          .table-card { display: block; }
        }
        .table-wrap { overflow-x: auto; }
        .table { width: 100%; border-collapse: collapse; min-width: 600px; }
        .table thead tr { border-bottom: 1px solid var(--border); }
        .table th { padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
        .table tbody tr { border-bottom: 1px solid var(--border); transition: background .1s; }
        .table tbody tr:hover { background: var(--bg3); }
        .table tbody tr:last-child { border-bottom: none; }
        .table td { padding: 12px 16px; font-size: 13px; vertical-align: middle; }
        .td-name { font-weight: 500; color: var(--text); }
        .td-phone { font-family: var(--mono); color: var(--text2); }
        .td-center { text-align: center; color: var(--text2); font-family: var(--mono); }
        .td-muted { color: var(--text3); font-size: 12px; }
        .td-actions { display: flex; gap: 6px; }
        .table-footer { padding: 12px 16px; text-align: center; font-size: 12px; color: var(--text3); border-top: 1px solid var(--border); }
        .notif { position: fixed; top: 16px; right: 16px; left: 16px; z-index: 9999; padding: 12px 18px; border-radius: var(--r); font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 10px; animation: slideIn .2s ease; max-width: 420px; margin: 0 auto; }
        @media (min-width: 640px) { .notif { left: auto; right: 20px; top: 20px; margin: 0; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .notif.success { background: #0f2a1e; border: 1px solid #34d39940; color: var(--green); }
        .notif.error { background: #2a0f0f; border: 1px solid #f8717140; color: var(--red); }
        .notif-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        @media (min-width: 640px) {
          .contact-cards { display: none; }
          .table-card { display: block !important; }
        }
      `}</style>
    </div>
  )
}
