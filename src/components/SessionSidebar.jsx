import { useState } from 'react'

const EMPTY_FORM = {
  type: 'ssh', name: '', host: '', port: '22',
  username: '', password: '', privateKey: '',
  keyPath: '', cwd: '', autoConnect: false,
}

export default function SessionSidebar({ profiles, onConnect, onClose, onRefresh }) {
  const [view, setView]       = useState('list')
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(EMPTY_FORM)
  const [error, setError]     = useState('')

  const set  = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setCheck = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  // ── 폼 열기 ──────────────────────────────────────────────────────────────
  const openNewForm = (type = 'ssh') => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, type })
    setError('')
    setView('form')
  }

  const openEditForm = (p) => {
    setEditing(p)
    setForm({
      type:        p.type,
      name:        p.name,
      host:        p.host        || '',
      port:        String(p.port || 22),
      username:    p.username    || '',
      password:    p.password    || '',
      privateKey:  p.privateKey  || '',
      keyPath:     p.keyPath     || '',
      cwd:         p.cwd         || '',
      autoConnect: p.autoConnect || false,
    })
    setError('')
    setView('form')
  }

  // ── 유효성 검사 ──────────────────────────────────────────────────────────
  const validate = () => {
    if (!form.name) { setError('이름을 입력하세요'); return false }
    if (form.type === 'ssh' && (!form.host || !form.username)) {
      setError('Host와 Username을 입력하세요'); return false
    }
    return true
  }

  // ── 저장 (저장만, 연결 안 함) ────────────────────────────────────────────
  const handleSave = async () => {
    setError('')
    if (!validate()) return
    await window.electronAPI.saveProfile(buildProfile())
    onRefresh()
    setView('list')
  }

  // ── 저장 + 즉시 연결 ─────────────────────────────────────────────────────
  const handleSaveAndConnect = async () => {
    setError('')
    if (!validate()) return
    const p = buildProfile()
    await window.electronAPI.saveProfile(p)
    onRefresh()
    onConnect(buildSession(p))
    onClose()
  }

  // ── 저장 없이 즉시 연결 ──────────────────────────────────────────────────
  const handleConnectNow = () => {
    setError('')
    if (!validate()) return
    onConnect(buildSession(buildProfile()))
    onClose()
  }

  const buildProfile = () => ({
    id:          editing?.id || `profile-${Date.now()}`,
    type:        form.type,
    name:        form.name,
    host:        form.host,
    port:        parseInt(form.port) || 22,
    username:    form.username,
    password:    form.password,
    privateKey:  form.privateKey,
    keyPath:     form.keyPath,
    cwd:         form.cwd,
    autoConnect: form.autoConnect,
  })

  const buildSession = (p) => ({
    type:       p.type,
    label:      p.name,
    host:       p.host,
    port:       p.port,
    username:   p.username,
    password:   p.password,
    privateKey: p.privateKey,
    cwd:        p.cwd,
  })

  // ── 삭제 ──────────────────────────────────────────────────────────────────
  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await window.electronAPI.deleteProfile(id)
    onRefresh()
  }

  // ── 자동 연결 토글 ────────────────────────────────────────────────────────
  const toggleAutoConnect = async (e, p) => {
    e.stopPropagation()
    await window.electronAPI.saveProfile({ ...p, autoConnect: !p.autoConnect })
    onRefresh()
  }

  const localProfiles = profiles.filter(p => p.type === 'local')
  const sshProfiles   = profiles.filter(p => p.type === 'ssh')

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>
          {view === 'form'
            ? (editing ? '편집' : form.type === 'local' ? '새 로컬 터미널' : '새 SSH 서버')
            : '터미널'}
        </span>
        {view === 'form'
          ? <button className="btn-ghost small" onClick={() => setView('list')}>← 취소</button>
          : <button className="btn-ghost small" onClick={onClose}>닫기</button>
        }
      </div>

      <div className="sidebar-content">

        {/* ── 프로필 목록 ──────────────────────────────────────────────────── */}
        {view === 'list' && (
          <>
            {/* 저장된 로컬 터미널 */}
            {localProfiles.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">로컬 터미널</div>
                {localProfiles.map(p => (
                  <ProfileItem
                    key={p.id} p={p}
                    onConnect={() => { onConnect(buildSession(p)); onClose() }}
                    onEdit={() => openEditForm(p)}
                    onDelete={handleDelete}
                    onToggleAuto={toggleAutoConnect}
                  />
                ))}
              </div>
            )}

            {/* SSH 서버 목록 */}
            {sshProfiles.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">SSH 서버</div>
                {sshProfiles.map(p => (
                  <ProfileItem
                    key={p.id} p={p}
                    onConnect={() => { onConnect(buildSession(p)); onClose() }}
                    onEdit={() => openEditForm(p)}
                    onDelete={handleDelete}
                    onToggleAuto={toggleAutoConnect}
                  />
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <button className="btn-add-profile" onClick={() => openNewForm('local')}>
                + 로컬 터미널 저장
              </button>
              <button className="btn-add-profile" onClick={() => openNewForm('ssh')}>
                + 새 SSH 서버 추가
              </button>
            </div>
          </>
        )}

        {/* ── 폼 ────────────────────────────────────────────────────────── */}
        {view === 'form' && (
          <>
            {/* 타입 전환 (편집 중이 아닐 때만) */}
            {!editing && (
              <div className="form-tabs">
                <div className={`form-tab ${form.type === 'local' ? 'active' : ''}`}
                  onClick={() => setForm(p => ({ ...p, type: 'local' }))}>로컬</div>
                <div className={`form-tab ${form.type === 'ssh' ? 'active' : ''}`}
                  onClick={() => setForm(p => ({ ...p, type: 'ssh' }))}>SSH</div>
              </div>
            )}

            <div className="form-group">
              <label>이름</label>
              <input value={form.name} onChange={set('name')}
                placeholder={form.type === 'local' ? '프로젝트 폴더' : 'my-server'} />
            </div>

            {/* 로컬 전용 */}
            {form.type === 'local' && (
              <div className="form-group">
                <label>시작 디렉토리</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={form.cwd} onChange={set('cwd')}
                    placeholder="비워두면 홈 디렉토리"
                    style={{ flex: 1 }}
                  />
                  <button className="btn-ghost small" onClick={async () => {
                    const p = await window.electronAPI.browseFolder()
                    if (p) setForm(prev => ({ ...prev, cwd: p }))
                  }}>탐색</button>
                </div>
              </div>
            )}

            {/* SSH 전용 */}
            {form.type === 'ssh' && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Host</label>
                    <input value={form.host} onChange={set('host')} placeholder="192.168.0.1" />
                  </div>
                  <div className="form-group short">
                    <label>Port</label>
                    <input value={form.port} onChange={set('port')} placeholder="22" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Username</label>
                  <input value={form.username} onChange={set('username')} placeholder="ubuntu" />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={form.password} onChange={set('password')}
                    placeholder="비밀번호 (또는 아래 키 사용)" />
                </div>
                <div className="form-group">
                  <label>키 파일 경로 (선택)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={form.keyPath} onChange={set('keyPath')}
                      placeholder="C:\Users\duska\.ssh\id_rsa"
                      style={{ flex: 1 }}
                    />
                    <button className="btn-ghost small" onClick={async () => {
                      const p = await window.electronAPI.browseFile()
                      if (p) setForm(prev => ({ ...prev, keyPath: p }))
                    }}>탐색</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    경로 지정 시 아래 직접 입력보다 우선 적용됩니다
                  </div>
                </div>
                <div className="form-group">
                  <label>Private Key 직접 입력 (선택)</label>
                  <textarea value={form.privateKey} onChange={set('privateKey')}
                    placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'} />
                </div>
              </>
            )}

            <label className="form-check">
              <input type="checkbox" checked={form.autoConnect} onChange={setCheck('autoConnect')} />
              앱 시작 시 자동 연결
            </label>

            {error && <div className="error-msg">{error}</div>}

            <div className="form-actions" style={{ flexDirection: 'column', gap: '6px' }}>
              {/* 저장 없이 바로 연결 */}
              <button className="btn-ghost" style={{ width: '100%' }} onClick={handleConnectNow}>
                연결만 (저장 안 함)
              </button>
              {/* 저장 + 연결 */}
              <button className="btn-primary" style={{ width: '100%' }} onClick={handleSaveAndConnect}>
                저장 후 연결
              </button>
              {/* 저장만 */}
              <button className="btn-ghost" style={{ width: '100%', fontSize: '12px' }} onClick={handleSave}>
                저장만
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ── 프로필 아이템 컴포넌트 ─────────────────────────────────────────────────────
function ProfileItem({ p, onConnect, onEdit, onDelete, onToggleAuto }) {
  const subtitle = p.type === 'ssh'
    ? `${p.username}@${p.host}:${p.port}`
    : (p.cwd || '~/  홈 디렉토리')

  return (
    <div className="profile-item" onClick={onConnect}>
      <div className="profile-item-main">
        <div className="profile-item-name">
          {p.name}
          {p.autoConnect && <span className="badge-auto">자동</span>}
        </div>
        <div className="profile-item-host">{subtitle}</div>
      </div>
      <div className="profile-item-actions">
        <button className={`btn-icon ${p.autoConnect ? 'active' : ''}`}
          title={p.autoConnect ? '자동 연결 켜짐' : '자동 연결 꺼짐'}
          onClick={e => onToggleAuto(e, p)}>⚡</button>
        <button className="btn-icon" title="편집"
          onClick={e => { e.stopPropagation(); onEdit() }}>✎</button>
        <button className="btn-icon danger" title="삭제"
          onClick={e => onDelete(e, p.id)}>×</button>
      </div>
    </div>
  )
}
