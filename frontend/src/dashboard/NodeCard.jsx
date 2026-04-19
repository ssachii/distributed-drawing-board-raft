import React from 'react'

export default function NodeCard({ status }) {
  if (!status) return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
      <span style={{ color: '#d1d5db', fontSize: '13px' }}>Connecting...</span>
    </div>
  )

  const { replicaId, state, term, logLength, commitIndex, leaderId, lastHeartbeatMs, healthy } = status
  const isLeader = state === 'LEADER'
  const isCandidate = state === 'CANDIDATE'
  const isUnreachable = !healthy

  const borderColor = isLeader ? '#22c55e' : isCandidate ? '#f59e0b' : isUnreachable ? '#fca5a5' : '#e5e7eb'
  const bgColor = isLeader ? '#f0fdf4' : isCandidate ? '#fffbeb' : isUnreachable ? '#fef2f2' : '#fff'

  const badgeBg = isLeader ? '#dcfce7' : isCandidate ? '#fef3c7' : isUnreachable ? '#fee2e2' : '#f3f4f6'
  const badgeColor = isLeader ? '#15803d' : isCandidate ? '#b45309' : isUnreachable ? '#b91c1c' : '#6b7280'
  const badgeText = isUnreachable ? 'DOWN' : (state || 'UNKNOWN')

  return (
    <div style={{
      background: bgColor, border: `1px solid ${borderColor}`,
      borderRadius: '8px', padding: '10px 12px',
      boxShadow: isLeader ? '0 0 0 1px #86efac33' : 'none',
      transition: 'all 0.2s',
      animation: isCandidate ? 'pulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.75} }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: 'monospace' }}>{replicaId || 'unknown'}</span>
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
          background: badgeBg, color: badgeColor, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>{badgeText}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: '11px', color: '#6b7280' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Term</span><span style={{ fontFamily: 'monospace', color: '#374151' }}>{term ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Log</span><span style={{ fontFamily: 'monospace', color: '#374151' }}>{logLength ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Commit</span><span style={{ fontFamily: 'monospace', color: '#374151' }}>{commitIndex ?? '—'}</span>
        </div>
        {leaderId && !isLeader && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Leader</span><span style={{ fontFamily: 'monospace', color: '#16a34a' }}>{leaderId}</span>
          </div>
        )}
        {lastHeartbeatMs != null && lastHeartbeatMs > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>HB</span>
            <span style={{ fontFamily: 'monospace', color: '#374151' }}>
              {(() => {
                const age = Date.now() - lastHeartbeatMs
                if (age < 0) return 'now'
                if (age < 1000) return `${age}ms`
                return `${(age / 1000).toFixed(1)}s`
              })()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
