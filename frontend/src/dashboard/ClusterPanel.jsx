import React from 'react'
import { useClusterSSE } from './useClusterSSE'
import NodeCard from './NodeCard'
import ChaosButton from '../chaos/ChaosButton'

const REPLICA_IDS = ['replica1', 'replica2', 'replica3', 'replica4']

export default function ClusterPanel() {
  const { replicas, lastEvent } = useClusterSSE()
  const replicaMap = {}
  replicas.forEach((r) => { if (r.replicaId) replicaMap[r.replicaId] = r })
  const isEmpty = replicas.length === 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: '16px', gap: '12px', overflowY: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>Cluster Status</div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>Raft consensus · 4 nodes</div>
      </div>

      {isEmpty && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
          <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '10px' }}>Connecting to cluster...</div>
          <div style={{ width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {REPLICA_IDS.map((id) => (
          <NodeCard key={id} status={isEmpty ? null : (replicaMap[id] || { replicaId: id, healthy: false, state: 'UNKNOWN' })} />
        ))}
      </div>

      {lastEvent && (
        <div style={{
          borderRadius: '8px', padding: '10px 12px', fontSize: '12px',
          background: lastEvent.type === 'leader_elected' ? '#f0fdf4' : '#fffbeb',
          border: `1px solid ${lastEvent.type === 'leader_elected' ? '#bbf7d0' : '#fde68a'}`,
          color: lastEvent.type === 'leader_elected' ? '#166534' : '#92400e',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            {lastEvent.type === 'leader_elected' ? '✓ Leader Elected' : '⟳ Election Started'}
          </div>
          {lastEvent.leaderId && <div>New leader: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{lastEvent.leaderId}</span></div>}
          {lastEvent.term != null && <div>Term: <span style={{ fontFamily: 'monospace' }}>{lastEvent.term}</span></div>}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
          Chaos Engineering
        </div>
        <ChaosButton />
      </div>
    </div>
  )
}
