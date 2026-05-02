// ═══ КАЛЬКУЛЯТОР ЭКОНОМИКИ ═══
function EconomicsTab() {
  const [totalCalls, setTotalCalls] = useState(1000)
  const [provider, setProvider] = useState<'exolve' | 'sipuni'>('exolve') // ✅ FIX #1
  const [conv, setConv] = useState(10)
  const [qual, setQual] = useState(25)
  const [dur, setDur] = useState(3)
  const [leadVal, setLeadVal] = useState(50000)

  // ✅ FIX #1: Тарифы по провайдерам
  const PROVIDERS = {
    exolve: { name: 'МТС Exolve', rate: 1.3, color: '#f87171' },
    sipuni: { name: 'Sipuni', rate: 2.15, color: '#818cf8' },
  }
  const prov = PROVIDERS[provider]
  const RATE = prov.rate
  const USD_RUB = 90

  const answered = Math.round(totalCalls * conv / 100)
  const notAnswered = totalCalls - answered
  const leads = Math.round(answered * qual / 100)

  // ✅ FIX #2: Недозвоны НЕ тарифицируются у обоих провайдеров
  // Тарификация начинается только с момента ответа
  const telAnswered = answered * dur * RATE
  const telRing = 0 // недозвоны = 0 ₽
  const telTotal = telAnswered + telRing

  // OpenAI (только дозвоны)
  const tokIn = 4000; const tokOut = 1200; const cheap = 0.7
  const openaiTotal = answered * (
    cheap * (tokIn * 0.00000015 * USD_RUB + tokOut * 0.0000006 * USD_RUB) +
    (1 - cheap) * (tokIn * 0.000005 * USD_RUB + tokOut * 0.000015 * USD_RUB)
  )

  // ✅ FIX #4+#5: Yandex TTS с НДС 20%, реальный тариф
  const ttsTotal = answered * 10 * 90 * (240 / 1_000_000) * 1.2

  // ✅ FIX #4+#5: Yandex STT — 15-сек блоки, ~1.6 ₽/мин с НДС
  const sttMins = answered * 10 * 8 / 60
  const sttTotal = sttMins * 1.6 * 1.2

  // ✅ FIX #3: Сервер — прогрессивная шкала по объёму
  const serverTotal = totalCalls <= 1000 ? 300
    : totalCalls <= 5000 ? 600
    : totalCalls <= 10000 ? 900
    : 1500

  const total = telTotal + openaiTotal + ttsTotal + sttTotal + serverTotal
  const perCall = total / totalCalls
  const perAnswered = answered > 0 ? total / answered : 0
  const perLead = leads > 0 ? total / leads : 0
  const revenue = leads * leadVal
  const profit = revenue - total
  const roi = total > 0 ? Math.round(profit / total * 100) : 0

  const fmtR = (n: number) => Math.round(n).toLocaleString('ru') + ' ₽'

  const bars = [
    { name: `${prov.name} (телефония)`, val: telTotal, color: prov.color },
    { name: 'Yandex STT (+НДС)', val: sttTotal, color: '#1D9E75' },
    { name: 'OpenAI GPT', val: openaiTotal, color: '#7F77DD' },
    { name: 'Yandex TTS (+НДС)', val: ttsTotal, color: '#EF9F27' },
    { name: 'Сервер', val: serverTotal, color: '#64748b' },
  ]
  const barMax = Math.max(...bars.map(b => b.val), 1)

  return (
    <div className="page">
      {/* Переключатель объёма */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1000, 5000, 10000, 50000].map(n => (
            <button key={n} onClick={() => setTotalCalls(n)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font)', fontWeight: totalCalls === n ? 600 : 400, background: totalCalls === n ? 'var(--bg3)' : 'var(--bg2)', color: totalCalls === n ? 'var(--text)' : 'var(--text3)', transition: 'all .15s' }}>
              {n.toLocaleString('ru')}
            </button>
          ))}
          <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>звонков</span>
        </div>

        {/* ✅ FIX #1: Переключатель провайдера */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {(['exolve', 'sipuni'] as const).map(p => (
            <button key={p} onClick={() => setProvider(p)}
              style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${provider === p ? PROVIDERS[p].color + '60' : 'var(--border)'}`, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)', fontWeight: provider === p ? 600 : 400, background: provider === p ? PROVIDERS[p].color + '15' : 'var(--bg2)', color: provider === p ? PROVIDERS[p].color : 'var(--text3)', transition: 'all .15s' }}>
              {PROVIDERS[p].name} {PROVIDERS[p].rate} ₽/мин
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <span>📞 {prov.name}: {RATE} ₽/мин · Недозвоны: 0 ₽ (тарифицируется с момента ответа)</span>
        <span>🎙 Yandex STT: 1.6 ₽/мин с НДС · TTS: 240 ₽/млн символов с НДС</span>
        <span>🤖 OpenAI: 70% mini / 30% gpt-4o</span>
      </div>

      {/* Ползунки */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Конверсия дозвона', val: conv, set: setConv, min: 3, max: 40, step: 1, fmt: (v: number) => v + '%', hint: 'реальная ~8-15%' },
          { label: 'Квалификация из дозвонов', val: qual, set: setQual, min: 5, max: 60, step: 1, fmt: (v: number) => v + '%', hint: 'от числа ответивших' },
          { label: 'Ср. длина разговора', val: dur, set: setDur, min: 1, max: 10, step: 0.5, fmt: (v: number) => v + ' мин', hint: 'влияет на телефонию' },
          { label: 'Ценность 1 лида', val: leadVal, set: setLeadVal, min: 10000, max: 500000, step: 5000, fmt: (v: number) => (v / 1000).toFixed(0) + 'к ₽', hint: 'ваш доход с лида' },
        ].map(ctrl => (
          <div key={ctrl.label} style={{ background: 'var(--bg3)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{ctrl.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{ctrl.hint}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.val}
                onChange={e => ctrl.set(+e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', minWidth: 56, textAlign: 'right', fontFamily: 'var(--mono)' }}>{ctrl.fmt(ctrl.val)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Метрики */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card" style={{ '--accent': '#818cf8' } as any}>
          <div className="stat-icon">◈</div>
          <div className="stat-value">{fmtR(total)}</div>
          <div className="stat-label">Итого расход</div>
          <div className="stat-sub">{totalCalls.toLocaleString('ru')} звонков</div>
          <div className="stat-glow" />
        </div>
        <div className="stat-card" style={{ '--accent': '#38bdf8' } as any}>
          <div className="stat-icon">◎</div>
          <div className="stat-value">{perCall.toFixed(2)} ₽</div>
          <div className="stat-label">За 1 звонок</div>
          <div className="stat-sub">~{fmtR(perAnswered)} за дозвон</div>
          <div className="stat-glow" />
        </div>
        <div className="stat-card" style={{ '--accent': '#34d399' } as any}>
          <div className="stat-icon">◆</div>
          <div className="stat-value">{fmtR(perLead)}</div>
          <div className="stat-label">Стоимость лида</div>
          <div className="stat-sub">{leads} квал. лидов</div>
          <div className="stat-glow" />
        </div>
        <div className="stat-card" style={{ '--accent': '#fb923c' } as any}>
          <div className="stat-icon">◷</div>
          <div className="stat-value">{answered}</div>
          <div className="stat-label">Дозвонились</div>
          <div className="stat-sub">из {totalCalls.toLocaleString('ru')}</div>
          <div className="stat-glow" />
        </div>
      </div>

      {/* Предупреждения о рисках */}
      {conv >= 15 && (
        <div style={{ background: '#fbbf2415', border: '1px solid #fbbf2430', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#fbbf24', marginBottom: 16 }}>
          ⚠️ Конверсия {conv}% — очень оптимистично. Реальная конверсия холодных звонков: 8-12%. Пересчитайте с 10%.
        </div>
      )}
      {totalCalls >= 10000 && (
        <div style={{ background: '#f8717115', border: '1px solid #f8717130', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#f87171', marginBottom: 16 }}>
          🚨 При {totalCalls.toLocaleString('ru')} звонков: операторы могут заблокировать номер. Используйте несколько номеров и начинайте с 50-100 звонков/день, постепенно наращивая.
        </div>
      )}

      {/* Расходы + ROI */}
      <div className="overview-grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Расходы</h2></div>
          <div style={{ padding: '12px 20px 18px' }}>
            {[
              { name: `${prov.name} ${RATE} ₽/мин`, val: telTotal, sub: `${answered} дозвонов × ${dur} мин × ${RATE} ₽ · недозвоны = 0 ₽` },
              { name: 'OpenAI GPT', val: openaiTotal, sub: '70% gpt-4o-mini + 30% gpt-4o' },
              { name: 'Yandex STT (с НДС)', val: sttTotal, sub: `${Math.round(sttMins)} мин × 1.6 ₽ × 1.2 НДС` },
              { name: 'Yandex TTS (с НДС)', val: ttsTotal, sub: '240 ₽/млн символов × 1.2 НДС' },
              { name: 'Сервер', val: serverTotal, sub: totalCalls <= 1000 ? 'базовый' : totalCalls <= 5000 ? 'средняя нагрузка' : 'высокая нагрузка' },
            ].map((row, i) => (
              <div key={i} style={{ borderBottom: i < 4 ? '1px solid var(--border)' : 'none', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>{row.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmtR(row.val)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.sub}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border2)' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Итого</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--mono)' }}>{fmtR(total)}</span>
            </div>
            {provider === 'exolve' && (
              <div style={{ fontSize: 11, color: '#34d399', marginTop: 8 }}>
                💡 Экономия vs Sipuni: {fmtR((2.15 - 1.3) * answered * dur)} на телефонии
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">ROI</h2></div>
            <div style={{ padding: '12px 20px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Лидов квалифицировано', val: String(leads), color: 'var(--text)' },
                { label: `Доход (${(leadVal / 1000).toFixed(0)}к ₽/лид)`, val: '+' + fmtR(revenue), color: 'var(--green)' },
                { label: 'Расход', val: '-' + fmtR(total), color: 'var(--red)' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text2)' }}>{row.label}</span>
                  <span style={{ fontWeight: 600, color: row.color, fontFamily: 'var(--mono)' }}>{row.val}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, color: 'var(--text2)', fontSize: 14 }}>Прибыль</span>
                <span style={{ fontWeight: 700, fontSize: 16, color: profit >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                  {profit >= 0 ? '+' : ''}{fmtR(profit)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text2)' }}>ROI</span>
                <span style={{ fontWeight: 700, color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi}%</span>
              </div>
              <div style={{ background: roi >= 0 ? '#34d39915' : '#f8717115', border: `1px solid ${roi >= 0 ? '#34d39930' : '#f8717130'}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: roi >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
                {roi >= 0
                  ? `Лид стоит ${fmtR(perLead)} — в ${Math.round(leadVal / Math.max(perLead, 1))}x дешевле его ценности`
                  : 'Убыточно — увеличь конверсию или ценность лида'}
              </div>
            </div>
          </div>

          {/* Предупреждения о рисках запуска */}
          <div className="card">
            <div className="card-header"><h2 className="card-title">⚠️ Риски запуска</h2></div>
            <div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '📵', risk: 'Блокировка номера', desc: 'Начинай с 30-50 зв/день, наращивай постепенно' },
                { icon: '🤖', risk: 'Метка "Спам"', desc: 'GetContact, Яндекс — помечают быстро. Нужна ротация номеров' },
                { icon: '⏰', risk: 'Время звонков', desc: 'Только 9:00-20:00 по TimeZone клиента, не Москвы' },
                { icon: '📋', risk: '152-ФЗ', desc: 'Нужно согласие на звонок и уведомление РКН' },
              ].map(r => (
                <div key={r.risk} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                  <span style={{ flexShrink: 0 }}>{r.icon}</span>
                  <div>
                    <div style={{ color: 'var(--text)', fontWeight: 500 }}>{r.risk}</div>
                    <div style={{ color: 'var(--text3)', marginTop: 2 }}>{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Бары */}
      <div className="card">
        <div className="card-header"><h2 className="card-title">Структура расходов</h2></div>
        <div style={{ padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bars.map(b => (
            <div key={b.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>
                <span>{b.name}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{fmtR(b.val)} ({total > 0 ? Math.round(b.val / total * 100) : 0}%)</span>
              </div>
              <div style={{ height: 8, background: 'var(--bg4)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${barMax > 0 ? Math.round(b.val / barMax * 100) : 0}%`, background: b.color, borderRadius: 4, transition: 'width .4s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
