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

const fmt = (n: number) => n.toLocaleString('ru')
const fmtDur = (sec: number) => { const m = Math.floor(sec/60), s = sec%60; return m > 0 ? `${m}м ${s}с` : `${s}с` }
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleString('ru', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'

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

function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: string }) {
  return (
    <div className="stat-card" style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 24, opacity: 0.15 }}>{icon}</div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, loading }: { checked: boolean; onChange: () => void; loading?: boolean }) {
  return (
    <button onClick={onChange} disabled={loading} style={{ width: 52, height: 28, borderRadius: 14, border: 'none', cursor: loading ? 'wait' : 'pointer', background: checked ? '#10b981' : '#d1d5db', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 27 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  )
}

function Badge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#6b7280'
  return <span style={{ background: color+'20', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{STATUS_LABELS[status] || status}</span>
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
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
  const [notification, setNotification] = useState<{text:string;type:'success'|'error'}|null>(null)
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsBatch, setSheetsBatch] = useState('500')
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsResult, setSheetsResult] = useState<any>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [csvResult, setCsvResult] = useState<any>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  const notify = (text: string, type: 'success'|'error' = 'success') => {
    setNotification({text, type}); setTimeout(() => setNotification(null), 4000)
  }

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/calls/stats')
      if (!res.ok) throw new Error()
      setStats(await res.json()); setApiError(false); setLastUpdated(new Date())
    } catch { setApiError(true) } finally { setLoading(false) }
  }, [])

  const fetchContacts = useCallback(async () => {
    try { const res = await fetch('/api/contacts'); if (res.ok) setContacts(await res.json()) } catch {}
  }, [])

  useEffect(() => { fetchStats(); fetchContacts() }, [fetchStats, fetchContacts])
  useEffect(() => {
    const iv = setInterval(() => { fetchStats(); if (tab === 'contacts') fetchContacts() }, 8000)
    return () => clearInterval(iv)
  }, [fetchStats, fetchContacts, tab])

  const toggleAutoDial = async () => {
    if (!stats || toggleLoading) return
    setToggleLoading(true)
    try {
      await fetch(stats.autoDialEnabled ? '/api/calls/auto/disable' : '/api/calls/auto/enable', {method:'POST'})
      await fetchStats()
      notify(stats.autoDialEnabled ? '⏸ Автодозвон выключен' : '✅ Автодозвон включён')
    } catch { notify('Ошибка', 'error') } finally { setToggleLoading(false) }
  }

  const initiateCall = async (contactId: string, name: string) => {
    setCallLoading(contactId)
    try {
      const res = await fetch(`/api/calls/initiate/${contactId}`, {method:'POST'})
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      notify(`📞 Звонок ${name} инициирован`); fetchStats()
    } catch (e: any) { notify(e.message, 'error') } finally { setCallLoading(null) }
  }

  const addContact = async () => {
    if (!addPhone.trim()) { setAddError('Введите номер'); return }
    setAddLoading(true); setAddError('')
    try {
      const res = await fetch('/api/contacts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phone:addPhone.trim(),name:addName.trim()||'Без имени'})})
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setAddPhone(''); setAddName(''); notify(`✅ Добавлен: ${d.name}`); fetchContacts(); fetchStats()
    } catch (e: any) { setAddError(e.message) } finally { setAddLoading(false) }
  }

  const deleteContact = async (id: string, name: string) => {
    if (!confirm(`Удалить "${name}"?`)) return
    try { await fetch(`/api/contacts/${id}`, {method:'DELETE'}); notify('🗑️ Удалён'); fetchContacts(); fetchStats() }
    catch { notify('Ошибка', 'error') }
  }

  const importFromSheets = async () => {
    if (!sheetsUrl.trim()) { notify('Вставьте ссылку на Google Sheets', 'error'); return }
    setSheetsLoading(true); setSheetsResult(null)
    try {
      const res = await fetch('/api/upload/google-sheets', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:sheetsUrl.trim(), batchSize:parseInt(sheetsBatch)||500})})
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setSheetsResult(d); notify(`✅ Импортировано ${d.imported} контактов`); fetchContacts(); fetchStats()
    } catch (e: any) { notify(e.message, 'error'); setSheetsResult({error: e.message}) } finally { setSheetsLoading(false) }
  }

  const importCsv = async (file: File) => {
    setCsvLoading(true); setCsvResult(null)
    const formData = new FormData(); formData.append('file', file)
    try {
      const res = await fetch('/api/upload/csv', {method:'POST', body:formData})
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setCsvResult(d); notify(`✅ Импортировано ${d.imported} контактов`); fetchContacts(); fetchStats()
    } catch (e: any) { notify(e.message, 'error'); setCsvResult({error: e.message}) } finally { setCsvLoading(false) }
  }

  const filtered = contacts.filter(c =>
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)) &&
    (statusFilter === 'all' || c.status === statusFilter)
  )

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>
      <div style={{textAlign:'center'}}><div style={{fontSize:40,marginBottom:16}}>⚡</div><div style={{color:'#64748b'}}>Загружаем дашборд...</div></div>
    </div>
  )

  const s = stats || {total:0,new:0,inProgress:0,leads:0,rejected:0,noAnswer:0,dueForCall:0,totalCalls:0,answeredCalls:0,totalDurationSec:0,conversionRate:0,activeCalls:0,autoDialEnabled:false}
  const lq = s.leadsByQualification || {withBudget:0,withTask:0,decisionMaker:0}
  const reachRate = s.totalCalls > 0 ? Math.round(s.answeredCalls/s.totalCalls*100) : 0
  const leadRate = s.answeredCalls > 0 ? Math.round(s.leads/s.answeredCalls*100) : 0
  const avgDur = s.answeredCalls > 0 ? Math.round(s.totalDurationSec/s.answeredCalls) : 0

  return (
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:'#f1f5f9',minHeight:'100vh'}}>

      {/* Уведомление */}
      {notification && (
        <div style={{position:'fixed',top:16,right:16,left:16,zIndex:1000,background:notification.type==='success'?'#10b981':'#ef4444',color:'#fff',padding:'12px 20px',borderRadius:12,boxShadow:'0 4px 20px rgba(0,0,0,0.15)',fontSize:14,fontWeight:500,textAlign:'center'}}>
          {notification.text}
        </div>
      )}

      {/* Шапка */}
      <div style={{background:'#0f172a',color:'#fff',padding:'0 16px'}}>
        <div className="header-top" style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,padding:'12px 0'}}>
          {/* Логотип */}
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>📞</span>
            <span style={{fontWeight:700,fontSize:15}}>AI Автодозвон</span>
            {apiError && <span style={{background:'#ef444420',color:'#f87171',border:'1px solid #ef444440',borderRadius:6,padding:'2px 8px',fontSize:11}}>⚠️ Нет связи</span>}
          </div>
          {/* Правая часть */}
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:12,color:'#94a3b8'}}>Автодозвон</span>
              <Toggle checked={s.autoDialEnabled} onChange={toggleAutoDial} loading={toggleLoading} />
              <span style={{fontSize:12,color:s.autoDialEnabled?'#10b981':'#94a3b8',fontWeight:600}}>{s.autoDialEnabled?'ВКЛ':'ВЫКЛ'}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,background:s.activeCalls>0?'#10b98120':'#ffffff10',borderRadius:8,padding:'5px 10px'}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:s.activeCalls>0?'#10b981':'#475569'}} />
              <span style={{fontSize:12,color:s.activeCalls>0?'#10b981':'#94a3b8'}}>{s.activeCalls} акт.</span>
            </div>
            {lastUpdated && <span className="hide-mobile" style={{fontSize:11,color:'#475569'}}>{lastUpdated.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
          </div>
        </div>

        {/* Табы */}
        <div style={{display:'flex',gap:0,overflowX:'auto'}}>
          {[['overview','📊 Обзор'],['contacts','👥 Контакты'],['logs','📋 История']].map(([key,label]) => (
            <button key={key} onClick={() => setTab(key as Tab)} style={{background:'none',border:'none',cursor:'pointer',padding:'10px 16px',color:tab===key?'#fff':'#64748b',fontWeight:tab===key?600:400,borderBottom:tab===key?'2px solid #6366f1':'2px solid transparent',fontSize:13,whiteSpace:'nowrap',flexShrink:0}}>{label}</button>
          ))}
        </div>
      </div>

      {/* Контент */}
      <div style={{maxWidth:1280,margin:'0 auto',padding:'16px'}}>

        {/* ===== ОБЗОР ===== */}
        {tab === 'overview' && (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>

            {/* Карточки статистики — 2 колонки на мобиле, 4 на десктопе */}
            <div className="stats-grid">
              <StatCard label="Всего контактов" value={fmt(s.total)} sub={`Ожидают: ${s.dueForCall}`} color="#6366f1" icon="👥" />
              <StatCard label="Всего звонков" value={fmt(s.totalCalls)} sub={`Дозвон: ${reachRate}%`} color="#3b82f6" icon="📞" />
              <StatCard label="Лидов" value={fmt(s.leads)} sub={`Конверсия: ${leadRate}%`} color="#10b981" icon="🎯" />
              <StatCard label="Ср. длительность" value={avgDur>0?fmtDur(avgDur):'—'} sub={`Всего: ${fmtDur(s.totalDurationSec)}`} color="#f59e0b" icon="⏱️" />
            </div>

            {/* Воронка + Статусы — стекаются на мобиле */}
            <div className="overview-grid">
              <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                <h3 style={{margin:'0 0 16px',fontSize:15,fontWeight:600}}>Воронка</h3>
                {[{label:'Загружено',value:s.total,color:'#6366f1'},{label:'Дозвонились',value:s.answeredCalls,color:'#3b82f6'},{label:'Квалифицировано',value:s.leads,color:'#10b981'},{label:'Отказ',value:s.rejected,color:'#ef4444'},{label:'Нет ответа',value:s.noAnswer,color:'#94a3b8'}].map(item => (
                  <div key={item.label} style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span style={{fontSize:13,color:'#374151'}}>{item.label}</span><span style={{fontSize:13,fontWeight:600}}>{fmt(item.value)}</span></div>
                    <MiniBar value={item.value} max={s.total||1} color={item.color} />
                  </div>
                ))}
              </div>

              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                  <h3 style={{margin:'0 0 14px',fontSize:15,fontWeight:600}}>Статусы</h3>
                  {[{label:'🆕 Новых',value:s.new,color:'#6366f1'},{label:'🔄 В работе',value:s.inProgress,color:'#f59e0b'},{label:'🎯 Лидов',value:s.leads,color:'#10b981'},{label:'❌ Отказов',value:s.rejected,color:'#ef4444'},{label:'📵 Нет ответа',value:s.noAnswer,color:'#6b7280'}].map(item => (
                    <div key={item.label} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:13}}>{item.label}</span><span style={{fontSize:14,fontWeight:700,color:item.color}}>{fmt(item.value)}</span></div>
                  ))}
                </div>
                <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                  <h3 style={{margin:'0 0 14px',fontSize:15,fontWeight:600}}>Квалификация лидов</h3>
                  {[{label:'💰 С бюджетом',value:lq.withBudget},{label:'✅ С задачей',value:lq.withTask},{label:'👔 ЛПР',value:lq.decisionMaker}].map(item => (
                    <div key={item.label} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:13}}>{item.label}</span><span style={{fontSize:14,fontWeight:700,color:'#10b981'}}>{item.value}</span></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Быстрые действия */}
            <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
              <h3 style={{margin:'0 0 14px',fontSize:15,fontWeight:600}}>Быстрые действия</h3>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <button onClick={toggleAutoDial} disabled={toggleLoading} className="action-btn" style={{padding:'10px 18px',borderRadius:10,border:'none',cursor:'pointer',fontWeight:600,fontSize:14,background:s.autoDialEnabled?'#fee2e2':'#d1fae5',color:s.autoDialEnabled?'#ef4444':'#10b981'}}>
                  {s.autoDialEnabled?'⏸ Остановить':'▶️ Запустить дозвон'}
                </button>
                <button onClick={() => setTab('contacts')} className="action-btn" style={{padding:'10px 18px',borderRadius:10,border:'none',cursor:'pointer',fontWeight:600,fontSize:14,background:'#ede9fe',color:'#7c3aed'}}>👥 Контакты</button>
                <button onClick={() => {fetchStats();fetchContacts();notify('🔄 Обновлено')}} className="action-btn" style={{padding:'10px 18px',borderRadius:10,border:'1px solid #e2e8f0',cursor:'pointer',fontWeight:600,fontSize:14,background:'#fff',color:'#64748b'}}>🔄 Обновить</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== КОНТАКТЫ ===== */}
        {tab === 'contacts' && (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>

            {/* Google Sheets */}
            <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',border:'2px solid #e0f2fe'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <span style={{fontSize:24}}>📊</span>
                <div>
                  <h3 style={{margin:0,fontSize:15,fontWeight:600}}>Импорт из Google Sheets</h3>
                  <p style={{margin:'3px 0 0',fontSize:12,color:'#64748b'}}>Загружайте базу пачками по 500–5000 контактов</p>
                </div>
              </div>
              <div style={{background:'#f0f9ff',borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#0369a1'}}>
                ℹ️ Сделайте таблицу публичной. Колонки: <b>Phone</b>, Name, Email
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <input value={sheetsUrl} onChange={e => setSheetsUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none',boxSizing:'border-box'}} />
                <div style={{display:'flex',gap:10}}>
                  <select value={sheetsBatch} onChange={e => setSheetsBatch(e.target.value)} style={{padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none',background:'#fff'}}>
                    <option value="100">100</option><option value="250">250</option>
                    <option value="500">500</option><option value="1000">1000</option><option value="5000">5000</option>
                  </select>
                  <button onClick={importFromSheets} disabled={sheetsLoading} style={{flex:1,padding:'10px 20px',borderRadius:10,border:'none',cursor:sheetsLoading?'wait':'pointer',background:'#0369a1',color:'#fff',fontWeight:600,fontSize:14}}>
                    {sheetsLoading ? '⏳ Загружаем...' : '📥 Импортировать'}
                  </button>
                </div>
              </div>
              {sheetsResult && !sheetsResult.error && (
                <div style={{marginTop:10,padding:'10px 14px',background:'#f0fdf4',borderRadius:10,fontSize:13,color:'#166534'}}>
                  ✅ Всего: <b>{sheetsResult.total}</b> | Импорт: <b>{sheetsResult.imported}</b> | Дубли: <b>{sheetsResult.duplicates}</b>
                </div>
              )}
              {sheetsResult?.error && <div style={{marginTop:10,padding:'10px 14px',background:'#fef2f2',borderRadius:10,fontSize:13,color:'#991b1b'}}>❌ {sheetsResult.error}</div>}
            </div>

            {/* CSV */}
            <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',border:'2px solid #fef3c7'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <span style={{fontSize:24}}>📄</span>
                <div>
                  <h3 style={{margin:0,fontSize:15,fontWeight:600}}>Импорт из CSV</h3>
                  <p style={{margin:'3px 0 0',fontSize:12,color:'#64748b'}}>Excel/CSV сохранённый в формате CSV (UTF-8)</p>
                </div>
              </div>
              <input ref={csvRef} type="file" accept=".csv,.txt" style={{display:'none'}} onChange={e => { if (e.target.files?.[0]) importCsv(e.target.files[0]) }} />
              <button onClick={() => csvRef.current?.click()} disabled={csvLoading} style={{width:'100%',padding:'12px 20px',borderRadius:10,border:'none',cursor:csvLoading?'wait':'pointer',background:'#d97706',color:'#fff',fontWeight:600,fontSize:14}}>
                {csvLoading ? '⏳ Загружаем...' : '📁 Выбрать CSV файл'}
              </button>
              {csvResult && !csvResult.error && (
                <div style={{marginTop:10,padding:'10px 14px',background:'#f0fdf4',borderRadius:10,fontSize:13,color:'#166534'}}>
                  ✅ Всего: <b>{csvResult.total}</b> | Импорт: <b>{csvResult.imported}</b> | Дубли: <b>{csvResult.duplicates}</b>
                </div>
              )}
              {csvResult?.error && <div style={{marginTop:10,padding:'10px 14px',background:'#fef2f2',borderRadius:10,fontSize:13,color:'#991b1b'}}>❌ {csvResult.error}</div>}
            </div>

            {/* Добавить вручную */}
            <div style={{background:'#fff',borderRadius:16,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
              <h3 style={{margin:'0 0 14px',fontSize:15,fontWeight:600}}>➕ Добавить вручную</h3>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <input value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="+79001234567" onKeyDown={e => e.key==='Enter' && addContact()} style={{padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none'}} />
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Имя (необязательно)" onKeyDown={e => e.key==='Enter' && addContact()} style={{padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none'}} />
                <button onClick={addContact} disabled={addLoading} style={{padding:'12px',borderRadius:10,border:'none',cursor:'pointer',background:'#6366f1',color:'#fff',fontWeight:600,fontSize:14}}>{addLoading?'...':'Добавить'}</button>
              </div>
              {addError && <div style={{color:'#ef4444',fontSize:13,marginTop:8}}>⚠️ {addError}</div>}
            </div>

            {/* Фильтры */}
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск по имени или телефону" style={{padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none'}} />
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{flex:1,padding:'10px 14px',borderRadius:10,border:'1.5px solid #e2e8f0',fontSize:14,outline:'none',background:'#fff'}}>
                  <option value="all">Все статусы</option>
                  {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <span style={{fontSize:13,color:'#64748b',whiteSpace:'nowrap'}}>{filtered.length} из {contacts.length}</span>
              </div>
            </div>

            {/* Карточки контактов на мобиле */}
            {filtered.length === 0 ? (
              <div style={{background:'#fff',borderRadius:16,padding:48,textAlign:'center',color:'#94a3b8',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                <div style={{fontSize:40,marginBottom:12}}>📭</div>
                <div>{search||statusFilter!=='all'?'Ничего не найдено':'Нет контактов. Добавьте или импортируйте!'}</div>
              </div>
            ) : (
              <>
                {/* Мобиль: карточки */}
                <div className="contacts-mobile">
                  {filtered.slice(0,100).map(c => (
                    <div key={c.id} style={{background:'#fff',borderRadius:14,padding:'14px 16px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)',display:'flex',alignItems:'center',gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:14,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                        <div style={{fontSize:13,color:'#64748b',fontFamily:'monospace',marginBottom:6}}>{c.phone}</div>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                          <Badge status={c.status} />
                          <span style={{fontSize:11,color:'#94a3b8'}}>{c.attemptCount} поп.</span>
                          {c.lastCallResult && <span style={{fontSize:11,color:'#94a3b8'}}>{RESULT_LABELS[c.lastCallResult]||''}</span>}
                        </div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
                        <button onClick={() => initiateCall(c.id,c.name)} disabled={callLoading===c.id} style={{padding:'8px 12px',borderRadius:8,border:'none',cursor:'pointer',background:'#d1fae5',color:'#10b981',fontWeight:600,fontSize:13}}>{callLoading===c.id?'...':'📞'}</button>
                        <button onClick={() => deleteContact(c.id,c.name)} style={{padding:'8px 12px',borderRadius:8,border:'none',cursor:'pointer',background:'#fee2e2',color:'#ef4444',fontWeight:600,fontSize:13}}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Десктоп: таблица */}
                <div className="contacts-desktop" style={{background:'#fff',borderRadius:16,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflow:'hidden'}}>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:700}}>
                      <thead>
                        <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                          {['Имя','Телефон','Статус','Попыток','Последний звонок','Результат','Действия'].map(h => (
                            <th key={h} style={{padding:'12px 16px',textAlign:'left',fontSize:12,color:'#64748b',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0,100).map((c,i) => (
                          <tr key={c.id} style={{borderBottom:'1px solid #f1f5f9',background:i%2===0?'#fff':'#fafafa'}}>
                            <td style={{padding:'12px 16px',fontWeight:500,fontSize:14}}>{c.name}</td>
                            <td style={{padding:'12px 16px',fontSize:14,fontFamily:'monospace'}}>{c.phone}</td>
                            <td style={{padding:'12px 16px'}}><Badge status={c.status} /></td>
                            <td style={{padding:'12px 16px',fontSize:14,color:'#64748b',textAlign:'center'}}>{c.attemptCount}</td>
                            <td style={{padding:'12px 16px',fontSize:13,color:'#64748b'}}>{fmtDate(c.lastCallAt)}</td>
                            <td style={{padding:'12px 16px',fontSize:13}}>{RESULT_LABELS[c.lastCallResult||'']||'—'}</td>
                            <td style={{padding:'12px 16px'}}>
                              <div style={{display:'flex',gap:8}}>
                                <button onClick={() => initiateCall(c.id,c.name)} disabled={callLoading===c.id} style={{padding:'6px 12px',borderRadius:8,border:'none',cursor:'pointer',background:'#d1fae5',color:'#10b981',fontWeight:600,fontSize:12}}>{callLoading===c.id?'...':'📞'}</button>
                                <button onClick={() => deleteContact(c.id,c.name)} style={{padding:'6px 12px',borderRadius:8,border:'none',cursor:'pointer',background:'#fee2e2',color:'#ef4444',fontWeight:600,fontSize:12}}>🗑️</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length > 100 && <div style={{padding:'12px 16px',textAlign:'center',fontSize:13,color:'#94a3b8',borderTop:'1px solid #f1f5f9'}}>Показано 100 из {filtered.length}. Используйте поиск.</div>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== ИСТОРИЯ ===== */}
        {tab === 'logs' && (
          <div style={{background:'#fff',borderRadius:16,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflow:'hidden'}}>
            <div style={{padding:'18px 20px',borderBottom:'1px solid #f1f5f9'}}><h3 style={{margin:0,fontSize:15,fontWeight:600}}>📋 История звонков</h3></div>
            <div style={{padding:48,textAlign:'center',color:'#94a3b8'}}>
              <div style={{fontSize:40,marginBottom:12}}>📋</div>
              <div>История появится после первых звонков</div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box }
        button:hover:not(:disabled) { opacity: 0.85 }
        input:focus, select:focus { border-color: #6366f1 !important }

        /* Статистика: 2 колонки всегда, 4 на широком экране */
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        /* Воронка + Статусы: стек на мобиле, 2 колонки на десктопе */
        .overview-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }

        /* Контакты: карточки на мобиле, таблица на десктопе */
        .contacts-mobile { display: flex; flex-direction: column; gap: 10px; }
        .contacts-desktop { display: none; }

        /* Скрыть время на мобиле */
        .hide-mobile { display: none; }

        /* Кнопки действий — растягиваются на мобиле */
        .action-btn { flex: 1; min-width: 120px; }

        @media (min-width: 640px) {
          .stats-grid { grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
          .overview-grid { grid-template-columns: 2fr 1fr; }
          .contacts-mobile { display: none; }
          .contacts-desktop { display: block; }
          .hide-mobile { display: inline; }
          .action-btn { flex: none; }
        }
      `}</style>
    </div>
  )
}
