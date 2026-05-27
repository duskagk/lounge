import { useState } from 'react'

const EMPTY_FORM = {
  type: 'ssh', name: '', host: '', port: '22',
  username: '', password: '', privateKey: '',
  keyPath: '', cwd: '', autoConnect: false,
  portForwards: [],
  jumpHost: '', jumpPort: '22', jumpUsername: '', jumpPassword: '', jumpKeyPath: '',
}

function newFwd() {
  return { id: `fwd-${Date.now()}-${Math.random().toString(36).slice(2)}`, localPort: '', remoteHost: 'localhost', remotePort: '' }
}

export default function SessionSidebar({ profiles, onConnect, onClose, onRefresh }) {
  const [view, setView]       = useState('list')
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(EMPTY_FORM)
  const [error, setError]     = useState('')

  const set      = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setCheck = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  const openNewForm = (type = 'ssh') => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, type })
    setError('')
    setView('form')
  }

  const openEditForm = (p) => {
    setEditing(p)
    setForm({
      type:         p.type,
      name:         p.name,
      host:         p.host        || '',
      port:         String(p.port || 22),
      username:     p.username    || '',
      password:     p.password    || '',
      privateKey:   p.privateKey  || '',
      keyPath:      p.keyPath     || '',
      cwd:          p.cwd         || '',
      autoConnect:  p.autoConnect || false,
      portForwards: (p.portForwards || []).map(f => ({
        ...f, localPort: String(f.localPort), remotePort: String(f.remotePort),
      })),
      jumpHost:     p.jumpHost     || '',
      jumpPort:     String(p.jumpPort || 22),
      jumpUsername: p.jumpUsername || '',
      jumpPassword: p.jumpPassword || '',
      jumpKeyPath:  p.jumpKeyPath  || '',
    })
    setError('')
    setView('form')
  }

  const validate = () => {
    if (!form.name) { setError('Please enter a name.'); return false }
    if (form.type === 'ssh' && (!form.host || !form.username)) {
      setError('Host and Username are required.'); return false
    }
    return true
  }

  const handleSave = async () => {
    setError('')
    if (!validate()) return
    await window.electronAPI.saveProfile(buildProfile())
    onRefresh()
    setView('list')
  }

  const handleSaveAndConnect = async () => {
    setError('')
    if (!validate()) return
    const p = buildProfile()
    await window.electronAPI.saveProfile(p)
    onRefresh()
    onConnect(buildSession(p))
    onClose()
  }

  const handleConnectNow = () => {
    setError('')
    if (!validate()) return
    onConnect(buildSession(buildProfile()))
    onClose()
  }

  const buildProfile = () => ({
    id:           editing?.id || `profile-${Date.now()}`,
    type:         form.type,
    name:         form.name,
    host:         form.host,
    port:         parseInt(form.port) || 22,
    username:     form.username,
    password:     form.password,
    privateKey:   form.privateKey,
    keyPath:      form.keyPath,
    cwd:          form.cwd,
    autoConnect:  form.autoConnect,
    portForwards: form.portForwards
      .filter(f => f.localPort && f.remotePort)
      .map(f => ({ ...f, localPort: parseInt(f.localPort), remotePort: parseInt(f.remotePort) })),
    jumpHost:     form.jumpHost,
    jumpPort:     parseInt(form.jumpPort) || 22,
    jumpUsername: form.jumpUsername,
    jumpPassword: form.jumpPassword,
    jumpKeyPath:  form.jumpKeyPath,
  })

  const buildSession = (p) => ({
    type:         p.type,
    label:        p.name,
    host:         p.host,
    port:         p.port,
    username:     p.username,
    password:     p.password,
    privateKey:   p.privateKey,
    cwd:          p.cwd,
    profileId:    p.id,
    portForwards: p.portForwards || [],
    jumpHost:     p.jumpHost     || '',
    jumpPort:     p.jumpPort     || 22,
    jumpUsername: p.jumpUsername || '',
    jumpPassword: p.jumpPassword || '',
    jumpKeyPath:  p.jumpKeyPath  || '',
  })

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await window.electronAPI.deleteProfile(id)
    onRefresh()
  }

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
            ? (editing ? 'Edit Profile' : form.type === 'local' ? 'New Local Terminal' : 'New SSH Server')
            : 'Sessions'}
        </span>
        {view === 'form'
          ? <button className="btn-ghost small" onClick={() => setView('list')}>← Cancel</button>
          : <button className="btn-ghost small" onClick={onClose}>Close</button>
        }
      </div>

      <div className="sidebar-content">

        {/* Profile list */}
        {view === 'list' && (
          <>
            {localProfiles.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">Local</div>
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

            {sshProfiles.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">SSH</div>
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
                + New Local Terminal
              </button>
              <button className="btn-add-profile" onClick={() => openNewForm('ssh')}>
                + New SSH Server
              </button>
            </div>
          </>
        )}

        {/* Form */}
        {view === 'form' && (
          <>
            {!editing && (
              <div className="form-tabs">
                <div className={`form-tab ${form.type === 'local' ? 'active' : ''}`}
                  onClick={() => setForm(p => ({ ...p, type: 'local' }))}>Local</div>
                <div className={`form-tab ${form.type === 'ssh' ? 'active' : ''}`}
                  onClick={() => setForm(p => ({ ...p, type: 'ssh' }))}>SSH</div>
              </div>
            )}

            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={set('name')}
                placeholder={form.type === 'local' ? 'my-project' : 'my-server'} />
            </div>

            {/* Local only */}
            {form.type === 'local' && (
              <div className="form-group">
                <label>Start Directory</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={form.cwd} onChange={set('cwd')}
                    placeholder="Leave blank for home directory"
                    style={{ flex: 1 }}
                  />
                  <button className="btn-ghost small" onClick={async () => {
                    const p = await window.electronAPI.browseFolder()
                    if (p) setForm(prev => ({ ...prev, cwd: p }))
                  }}>Browse</button>
                </div>
              </div>
            )}

            {/* SSH only */}
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
                    placeholder="Password (or use key below)" />
                </div>
                <div className="form-group">
                  <label>Key File Path (optional)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={form.keyPath} onChange={set('keyPath')}
                      placeholder="C:\Users\you\.ssh\id_rsa"
                      style={{ flex: 1 }}
                    />
                    <button className="btn-ghost small" onClick={async () => {
                      const p = await window.electronAPI.browseFile()
                      if (p) setForm(prev => ({ ...prev, keyPath: p }))
                    }}>Browse</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Key file takes priority over inline private key below.
                  </div>
                </div>
                <div className="form-group">
                  <label>Private Key (optional, paste)</label>
                  <textarea value={form.privateKey} onChange={set('privateKey')}
                    placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'} />
                </div>

                {/* ProxyJump */}
                <div className="form-group">
                  <label>ProxyJump (optional)</label>
                  <div className="form-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <input value={form.jumpHost} onChange={set('jumpHost')} placeholder="jump-host (leave blank to disable)" />
                    </div>
                    <div className="form-group short">
                      <input value={form.jumpPort} onChange={set('jumpPort')} placeholder="22" />
                    </div>
                  </div>
                  {form.jumpHost && (
                    <>
                      <div className="form-group" style={{ marginTop: 4 }}>
                        <input value={form.jumpUsername} onChange={set('jumpUsername')} placeholder="Username" />
                      </div>
                      <div className="form-group" style={{ marginTop: 4 }}>
                        <input type="password" value={form.jumpPassword} onChange={set('jumpPassword')} placeholder="Password" />
                      </div>
                      <div className="form-group" style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                        <input value={form.jumpKeyPath} onChange={set('jumpKeyPath')}
                          placeholder="Key file path (optional)" style={{ flex: 1 }} />
                        <button className="btn-ghost small" onClick={async () => {
                          const p = await window.electronAPI.browseFile()
                          if (p) setForm(prev => ({ ...prev, jumpKeyPath: p }))
                        }}>Browse</button>
                      </div>
                    </>
                  )}
                </div>

                {/* Port Forwarding */}
                <div className="form-group">
                  <label>Port Forwarding</label>
                  {form.portForwards.length > 0 && (
                    <div className="pf-list">
                      {form.portForwards.map((f, i) => (
                        <div key={f.id} className="pf-row">
                          <input
                            className="pf-input pf-port"
                            value={f.localPort}
                            onChange={e => setForm(prev => {
                              const fwds = [...prev.portForwards]
                              fwds[i] = { ...fwds[i], localPort: e.target.value }
                              return { ...prev, portForwards: fwds }
                            })}
                            placeholder="local"
                          />
                          <span className="pf-arrow">→</span>
                          <input
                            className="pf-input pf-host"
                            value={f.remoteHost}
                            onChange={e => setForm(prev => {
                              const fwds = [...prev.portForwards]
                              fwds[i] = { ...fwds[i], remoteHost: e.target.value }
                              return { ...prev, portForwards: fwds }
                            })}
                            placeholder="localhost"
                          />
                          <span className="pf-colon">:</span>
                          <input
                            className="pf-input pf-port"
                            value={f.remotePort}
                            onChange={e => setForm(prev => {
                              const fwds = [...prev.portForwards]
                              fwds[i] = { ...fwds[i], remotePort: e.target.value }
                              return { ...prev, portForwards: fwds }
                            })}
                            placeholder="remote"
                          />
                          <button className="pf-remove" onClick={() => setForm(prev => ({
                            ...prev,
                            portForwards: prev.portForwards.filter((_, j) => j !== i),
                          }))}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn-ghost small" style={{ marginTop: 4 }}
                    onClick={() => setForm(prev => ({ ...prev, portForwards: [...prev.portForwards, newFwd()] }))}>
                    + Add Rule
                  </button>
                </div>
              </>
            )}

            <label className="form-check">
              <input type="checkbox" checked={form.autoConnect} onChange={setCheck('autoConnect')} />
              Auto-connect on startup
            </label>

            {error && <div className="error-msg">{error}</div>}

            <div className="form-actions" style={{ flexDirection: 'column', gap: '6px' }}>
              <button className="btn-ghost" style={{ width: '100%' }} onClick={handleConnectNow}>
                Connect only (don't save)
              </button>
              <button className="btn-primary" style={{ width: '100%' }} onClick={handleSaveAndConnect}>
                Save &amp; Connect
              </button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '12px' }} onClick={handleSave}>
                Save only
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// Profile item component
function ProfileItem({ p, onConnect, onEdit, onDelete, onToggleAuto }) {
  const subtitle = p.type === 'ssh'
    ? `${p.username}@${p.host}:${p.port}`
    : (p.cwd || '~ home directory')

  return (
    <div className="profile-item" onClick={onConnect}>
      <div className="profile-item-main">
        <div className="profile-item-name">
          {p.name}
          {p.autoConnect && <span className="badge-auto">auto</span>}
        </div>
        <div className="profile-item-host">{subtitle}</div>
      </div>
      <div className="profile-item-actions">
        <button className={`btn-icon ${p.autoConnect ? 'active' : ''}`}
          title={p.autoConnect ? 'Auto-connect: on' : 'Auto-connect: off'}
          onClick={e => onToggleAuto(e, p)}>⚡</button>
        <button className="btn-icon" title="Edit"
          onClick={e => { e.stopPropagation(); onEdit() }}>✎</button>
        <button className="btn-icon danger" title="Delete"
          onClick={e => onDelete(e, p.id)}>×</button>
      </div>
    </div>
  )
}
