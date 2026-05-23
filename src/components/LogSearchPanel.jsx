import { useState, useEffect, useRef, useCallback } from 'react'

// 검색어 위치를 찾아 <mark>로 감싸는 JS 하이라이팅
function highlight(text, query) {
  if (!text || !query) return [{ t: text || '', b: false }]
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return [{ t: text, b: false }]
  const pat = new RegExp(
    `(${terms.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi'
  )
  const parts = []
  let last = 0, m
  while ((m = pat.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), b: false })
    parts.push({ t: m[0], b: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: text.slice(last), b: false })
  return parts
}

function Snippet({ text, query, fallback = '' }) {
  if (!text) return <span className="log-snippet-empty">{fallback}</span>
  const parts = highlight(text, query)
  return (
    <span className="log-snippet">
      {parts.map((p, i) => p.b ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>)}
    </span>
  )
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)      return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function LogSearchPanel({ logId, sessionLabel, onClose }) {
  const [query,         setQuery]         = useState('')
  const [results,       setResults]       = useState([])
  const [loading,       setLoading]       = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)
  const [dbCount,       setDbCount]       = useState(null)   // 진단용
  const inputRef = useRef(null)

  // 설정 로드 + DB 레코드 수 조회
  useEffect(() => {
    window.electronAPI?.getSettings().then(s => {
      if (s.logRetentionDays) setRetentionDays(s.logRetentionDays)
    })
    inputRef.current?.focus()
    window.electronAPI?.logCount({ sessionId: logId }).then(n => setDbCount(n))
  }, [logId])

  const search = useCallback(async (q = query) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const rows = await window.electronAPI?.logSearch({
        query: q.trim(),
        sessionId: logId || undefined,
      }) ?? []
      // ID 기준 중복 제거
      const seen = new Set()
      setResults(rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true }))
    } catch (e) {
      console.error('[LogSearch]', e)
      setResults([])
    } finally {
      setLoading(false)
      window.electronAPI?.logCount({ sessionId: logId }).then(n => setDbCount(n))
    }
  }, [query, logId])

  const handleKey = (e) => {
    if (e.key === 'Enter') search()
    if (e.key === 'Escape') onClose()
  }

  const saveRetention = (days) => {
    setRetentionDays(days)
    window.electronAPI?.saveSettings({ logRetentionDays: days })
  }

  const purge = async () => {
    if (!window.confirm(`Delete log entries older than ${retentionDays} days?`)) return
    await window.electronAPI?.logPurge({ retentionDays })
    search()
  }

  // 패널 외부 클릭 닫기
  const panelRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const modeLabel = { command: '', app: '⬜ app', stream: '∞ stream' }

  return (
    <div className="log-panel-backdrop">
      <div className="log-panel" ref={panelRef}>

        {/* 헤더 */}
        <div className="log-panel-header">
          <span>
            Log Search
            {sessionLabel && <span className="log-panel-session-badge">{sessionLabel}</span>}
          </span>
          <span className="log-panel-dbcount">
            {dbCount === null ? '' : dbCount === 0 ? '⚠ 0 records' : `${dbCount} records`}
          </span>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>

        {/* 검색 입력 */}
        <div className="log-panel-search">
          <input
            ref={inputRef}
            className="log-search-input"
            placeholder="Search terminal history…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <button className="btn-primary" onClick={() => search()} disabled={loading}>
            {loading ? '…' : 'Search'}
          </button>
        </div>

        {/* 보관 기간 */}
        <div className="log-panel-filters">
          <div className="log-retention">
            <span>Retention:</span>
            <input
              type="number"
              className="size-input"
              value={retentionDays}
              min={1} max={365}
              onChange={e => saveRetention(Math.max(1, Math.min(365, +e.target.value)))}
            />
            <span>days</span>
            <button className="btn-ghost small" onClick={purge} title="Delete old entries">Purge</button>
          </div>
        </div>

        {/* 결과 */}
        <div className="log-results">
          {results.length === 0 && !loading && query.trim() && (
            <p className="log-results-empty">No results for "{query}"</p>
          )}
          {results.map(r => (
            <div key={r.id} className="log-result-item">
              <div className="log-result-meta">
                <span className="log-result-time">{timeAgo(r.timestamp)}</span>
                {r.mode !== 'command' && (
                  <span className="log-result-mode">{modeLabel[r.mode] ?? r.mode}</span>
                )}
              </div>
              {r.command && r.command !== '[interactive app]' && (
                <div className="log-result-command">
                  <span className="log-result-prompt">$</span>
                  <Snippet text={r.command} query={query} />
                </div>
              )}
              <div className="log-result-output">
                <Snippet text={r.out_snip} query={query} fallback="(no output captured)" />
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
