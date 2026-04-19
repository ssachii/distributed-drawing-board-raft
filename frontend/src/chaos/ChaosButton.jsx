import React, { useState, useEffect } from 'react'

export default function ChaosButton() {
  const [target, setTarget] = useState('random')
  const [mode, setMode] = useState('random')
  const [lastResult, setLastResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    if (lastResult) {
      setShowToast(true)
      const t = setTimeout(() => setShowToast(false), 5000)
      return () => clearTimeout(t)
    }
  }, [lastResult])

  const unleashChaos = async () => {
    setLoading(true)
    try {
      const res = await fetch('/chaos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, mode }) })
      setLastResult(await res.json())
    } catch (e) { setLastResult({ error: e.message }) }
    setLoading(false)
  }

  const healAll = async () => {
    setLoading(true)
    try {
      const res = await fetch('/chaos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'all', mode: 'heal' }) })
      setLastResult(await res.json())
    } catch (e) { setLastResult({ error: e.message }) }
    setLoading(false)
  }

  const selectStyle = {
    background: '#fff', color: '#374151', border: '1px solid #d1d5db',
    borderRadius: '6px', padding: '5px 8px', fontSize: '12px',
    cursor: 'pointer', width: '100%', outline: 'none',
  }

  const isPartition = mode === 'partition'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div>
        <label style={{ color: '#6b7280', fontSize: '11px', display: 'block', marginBottom: '3px' }}>Target</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={selectStyle}>
          <option value="random">Random replica</option>
          <option value="replica1">replica1</option>
          <option value="replica2">replica2</option>
          <option value="replica3">replica3</option>
          <option value="replica4">replica4</option>
        </select>
      </div>

      <div>
        <label style={{ color: '#6b7280', fontSize: '11px', display: 'block', marginBottom: '3px' }}>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
          <option value="random">Surprise (random)</option>
          <option value="graceful">Graceful stop</option>
          <option value="hard">Hard kill (SIGKILL)</option>
          <option value="partition">Network partition</option>
        </select>
      </div>

      {isPartition && (
        <div style={{ fontSize: '11px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '7px 9px' }}>
          ⚡ Disconnects replica from Docker network for ~15s, then auto-heals.
        </div>
      )}

      <button onClick={unleashChaos} disabled={loading} style={{
        padding: '8px 12px', borderRadius: '6px', border: 'none',
        cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600,
        background: loading ? '#fca5a5' : (isPartition ? '#f97316' : '#ef4444'),
        color: '#fff', width: '100%', transition: 'background 0.15s',
        opacity: loading ? 0.7 : 1,
      }}>
        {loading ? 'Working...' : isPartition ? '⚡ Partition Network' : '💥 Unleash Chaos'}
      </button>

      <button onClick={healAll} disabled={loading} style={{
        padding: '6px 12px', borderRadius: '6px',
        border: '1px solid #bbf7d0', cursor: loading ? 'not-allowed' : 'pointer',
        fontSize: '12px', background: '#f0fdf4', color: '#15803d',
        opacity: loading ? 0.5 : 1, width: '100%',
      }}>
        🩹 Heal All Partitions
      </button>

      {showToast && lastResult && (
        <div style={{
          padding: '8px 10px', borderRadius: '6px', fontSize: '11px',
          background: lastResult.error ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${lastResult.error ? '#fca5a5' : '#bbf7d0'}`,
          color: lastResult.error ? '#b91c1c' : '#15803d',
          wordBreak: 'break-word',
        }}>
          {lastResult.error ? `Error: ${lastResult.error}`
            : lastResult.partition ? `⚡ Partitioned ${lastResult.partition} — auto-heal in 15s`
            : lastResult.healed ? `🩹 Healed: ${lastResult.healed}`
            : lastResult.killed ? `Killed ${lastResult.killed} (${lastResult.mode})`
            : JSON.stringify(lastResult)}
        </div>
      )}
    </div>
  )
}
