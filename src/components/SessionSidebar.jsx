import { useState } from 'react'

const SAVED_KEY = 'wterm_saved_sessions'

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') } catch { return [] }
}
function saveSessions(list) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list))
}

export default function SessionSidebar({ onConnect, onClose }) {
  const [mode, setMode] = useState('local')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(loadSaved)

  const handleConnect = () => {
    setError('')

    if (mode === 'local') {
      onConnect({ type: 'local', label: 'local' })
      onClose()
      return
    }

    if (!host || !username) {
      setError('Host와 Username을 입력하세요')
      return
    }

    const session = {
      type: 'ssh',
      label: sessionName || `${username}@${host}`,
      host, port: parseInt(port) || 22,
      username, password, privateKey,
    }

    // 이름 입력 시 저장
    if (sessionName) {
      const updated = [...saved.filter(s => s.name !== sessionName), { name: sessionName, ...session }]
      setSaved(updated)
      saveSessions(updated)
    }

    onConnect(session)
    onClose()
  }

  const loadSavedSession = (s) => {
    setMode('ssh')
    setHost(s.host)
    setPort(String(s.port || 22))
    setUsername(s.username)
    setPassword(s.password || '')
    setPrivateKey(s.privateKey || '')
    setSessionName(s.name || '')
  }

  const deleteSaved = (e, name) => {
    e.stopPropagation()
    const updated = saved.filter(s => s.name !== name)
    setSaved(updated)
    saveSessions(updated)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>새 터미널</span>
        <button className="btn-ghost" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={onClose}>닫기</button>
      </div>

      <div className="sidebar-content">
        {/* 연결 타입 탭 */}
        <div className="form-tabs">
          <div className={`form-tab ${mode === 'local' ? 'active' : ''}`} onClick={() => setMode('local')}>로컬</div>
          <div className={`form-tab ${mode === 'ssh' ? 'active' : ''}`} onClick={() => setMode('ssh')}>SSH</div>
        </div>

        {mode === 'local' && (
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            현재 PC의 PowerShell을 실행합니다.<br />
            한글 IME가 개선된 환경으로 시작됩니다.
          </p>
        )}

        {mode === 'ssh' && (
          <>
            <div className="form-group">
              <label>세션 이름 (저장용)</label>
              <input value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="my-server" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Host</label>
                <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.0.83" />
              </div>
              <div className="form-group short">
                <label>Port</label>
                <input value={port} onChange={e => setPort(e.target.value)} placeholder="22" />
              </div>
            </div>
            <div className="form-group">
              <label>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="ubuntu" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호 (또는 아래 키 사용)" />
            </div>
            <div className="form-group">
              <label>Private Key (선택)</label>
              <textarea value={privateKey} onChange={e => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
            </div>
          </>
        )}

        {error && <div className="error-msg">{error}</div>}

        <div className="form-actions">
          <button className="btn-primary" onClick={handleConnect}>연결</button>
        </div>

        {/* 저장된 세션 */}
        {saved.length > 0 && (
          <div className="saved-sessions">
            <h4>저장된 세션</h4>
            {saved.map(s => (
              <div key={s.name} className="saved-item" onClick={() => loadSavedSession(s)}>
                <div className="saved-item-info">
                  <span className="saved-item-name">{s.name}</span>
                  <span className="saved-item-host">{s.username}@{s.host}:{s.port}</span>
                </div>
                <span className="tab-close" onClick={e => deleteSaved(e, s.name)}>×</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
