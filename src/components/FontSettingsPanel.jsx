import { useState, useEffect, useRef } from 'react'

const PRESET_FONTS = [
  'JetBrains Mono',
  'D2Coding',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Fira Code',
  'Nanum Gothic Coding',
  'Source Code Pro',
  'Hack',
  'IBM Plex Mono',
]

const MIN_SIZE = 8
const MAX_SIZE = 32

export default function FontSettingsPanel({ fontFamily, fontSize, onChange, onClose }) {
  const isPreset = PRESET_FONTS.includes(fontFamily)
  const [preset, setPreset]       = useState(isPreset ? fontFamily : '__custom__')
  const [customFont, setCustomFont] = useState(isPreset ? '' : fontFamily)
  const [size, setSize]           = useState(fontSize)
  const panelRef = useRef(null)

  const effectiveFamily = preset === '__custom__'
    ? (customFont.trim() || 'monospace')
    : preset

  useEffect(() => {
    function onMouseDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onClose])

  function emit(family, newSize) {
    onChange({ fontFamily: family, fontSize: newSize })
  }

  function handlePresetChange(val) {
    setPreset(val)
    if (val !== '__custom__') emit(val, size)
  }

  function handleCustomChange(val) {
    setCustomFont(val)
    if (val.trim()) emit(val.trim(), size)
  }

  function adjustSize(delta) {
    const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size + delta))
    setSize(next)
    emit(effectiveFamily, next)
  }

  function handleSizeInput(val) {
    const n = parseInt(val, 10)
    if (!isNaN(n)) {
      const clamped = Math.max(MIN_SIZE, Math.min(MAX_SIZE, n))
      setSize(clamped)
      emit(effectiveFamily, clamped)
    }
  }

  return (
    <div className="font-panel" ref={panelRef}>
      <div className="font-panel-header">
        <span>Terminal Font</span>
        <button className="btn-icon" onClick={onClose} title="Close">×</button>
      </div>

      <div className="font-panel-body">
        <div className="form-group">
          <label>Font Family</label>
          <select
            className="font-select"
            value={preset}
            onChange={e => handlePresetChange(e.target.value)}
          >
            {PRESET_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            <option value="__custom__">Custom...</option>
          </select>
        </div>

        {preset === '__custom__' && (
          <div className="form-group">
            <label>Font Name</label>
            <input
              type="text"
              value={customFont}
              onChange={e => handleCustomChange(e.target.value)}
              placeholder="e.g. Gulim, Malgun Gothic"
            />
          </div>
        )}

        <div className="form-group">
          <label>Font Size</label>
          <div className="size-control">
            <button
              className="size-btn"
              onClick={() => adjustSize(-1)}
              disabled={size <= MIN_SIZE}
            >−</button>
            <input
              type="number"
              className="size-input"
              value={size}
              min={MIN_SIZE}
              max={MAX_SIZE}
              onChange={e => handleSizeInput(e.target.value)}
            />
            <button
              className="size-btn"
              onClick={() => adjustSize(1)}
              disabled={size >= MAX_SIZE}
            >+</button>
          </div>
        </div>

        <div className="font-preview" style={{ fontFamily: effectiveFamily, fontSize: `${size}px` }}>
          <div>$ ls -la /home/user</div>
          <div>drwxr-xr-x  user  4096  lounge</div>
          <div>-rw-r--r--  user   512  .bashrc</div>
        </div>
      </div>
    </div>
  )
}
