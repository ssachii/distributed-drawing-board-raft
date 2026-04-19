import React, { useEffect } from 'react'

export default function Toolbar({
  tool, setTool, strokeWidth, setStrokeWidth,
  onUndo, onRedo, userColour, connectionStatus, leaderInfo,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); onUndo?.() }
      else if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) { e.preventDefault(); onRedo?.() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onUndo, onRedo])

  const isConnected = connectionStatus === 'connected'
  const isElection = isConnected && (!leaderInfo || !leaderInfo.leaderId)
  const statusColor = !isConnected
    ? (connectionStatus === 'reconnecting' ? '#d97706' : connectionStatus === 'disconnected' ? '#dc2626' : '#9ca3af')
    : isElection ? '#d97706' : '#16a34a'
  const statusLabel = !isConnected
    ? (connectionStatus === 'reconnecting' ? 'Reconnecting...' : connectionStatus === 'disconnected' ? 'Disconnected' : 'Connecting...')
    : isElection ? 'Election in progress...'
    : `Leader: ${leaderInfo.leaderId} · term ${leaderInfo.term}`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '0 16px', height: '50px',
      background: '#ffffff',
      borderBottom: '1px solid #e5e7eb',
      flexShrink: 0, flexWrap: 'wrap',
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .tb-btn {
          padding: 5px 13px; border-radius: 6px; border: 1px solid #e5e7eb;
          cursor: pointer; font-size: 13px; font-weight: 500;
          background: #fff; color: #374151;
          transition: all 0.12s; white-space: nowrap;
        }
        .tb-btn:hover { background: #f9fafb; border-color: #d1d5db; color: #111827; }
        .tb-btn.active { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; font-weight: 600; }
        .tb-btn.eraser-active { background: #fff7ed; color: #ea580c; border-color: #fed7aa; font-weight: 600; }
        .tb-btn.subtle { border-color: transparent; color: #6b7280; }
        .tb-btn.subtle:hover { background: #f3f4f6; border-color: #e5e7eb; color: #374151; }
      `}</style>

      {/* Logo */}
      <span style={{ fontWeight: 700, fontSize: '15px', color: '#111827', letterSpacing: '-0.01em', marginRight: '2px' }}>
        Mini<span style={{ color: '#2563eb' }}>RAFT</span>
      </span>

      <div style={{ width: 1, height: 24, background: '#e5e7eb' }} />

      {userColour && (
        <div title="Your colour" style={{
          width: 18, height: 18, borderRadius: '50%',
          backgroundColor: userColour, border: '2px solid #e5e7eb', flexShrink: 0,
        }} />
      )}

      <button onClick={() => setTool('pen')} className={`tb-btn ${tool === 'pen' ? 'active' : ''}`} title="Pen">
        ✏️ Pen
      </button>
      <button onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')} className={`tb-btn ${tool === 'eraser' ? 'eraser-active' : ''}`} title="Eraser">
        🧹 Erase
      </button>

      <div style={{ width: 1, height: 24, background: '#e5e7eb' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ color: '#9ca3af', fontSize: '12px', whiteSpace: 'nowrap' }}>Width</label>
        <input type="range" min={1} max={20} value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          style={{ width: '76px', accentColor: '#2563eb', cursor: 'pointer' }} />
        <span style={{ color: '#374151', fontSize: '12px', fontFamily: 'monospace', minWidth: '18px' }}>{strokeWidth}</span>
      </div>

      <div style={{ width: 1, height: 24, background: '#e5e7eb' }} />

      <button onClick={onUndo} className="tb-btn subtle" title="Undo (Ctrl+Z)">↩ Undo</button>
      <button onClick={onRedo} className="tb-btn subtle" title="Redo (Ctrl+Y)">↪ Redo</button>

      <div style={{ flex: 1 }} />

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          backgroundColor: statusColor, flexShrink: 0,
          boxShadow: `0 0 0 2px ${statusColor}33`,
        }} />
        {isElection && (
          <div style={{
            width: 10, height: 10, border: `2px solid ${statusColor}`,
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', flexShrink: 0,
          }} />
        )}
        <span style={{ color: '#6b7280', fontSize: '12px', whiteSpace: 'nowrap' }}>{statusLabel}</span>
      </div>
    </div>
  )
}
