import React, { useState, useCallback } from 'react'
import Toolbar from './toolbar/Toolbar'
import Canvas from './canvas/Canvas'
import ClusterPanel from './dashboard/ClusterPanel'

export default function App() {
  const [selectedTool, setSelectedTool] = useState('pen')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [userInfo, setUserInfo] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [leaderInfo, setLeaderInfo] = useState(null)

  const handleUserAssigned = useCallback((payload) => {
    setUserInfo({ userId: payload.userId, colour: payload.colour })
  }, [])
  const handleUndo = useCallback(() => window.dispatchEvent(new CustomEvent('miniraft:undo')), [])
  const handleRedo = useCallback(() => window.dispatchEvent(new CustomEvent('miniraft:redo')), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#f9fafb' }}>
      <Toolbar
        tool={selectedTool} setTool={setSelectedTool}
        strokeWidth={strokeWidth} setStrokeWidth={setStrokeWidth}
        onUndo={handleUndo} onRedo={handleRedo}
        userColour={userInfo?.colour}
        connectionStatus={connectionStatus}
        leaderInfo={leaderInfo}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 3, position: 'relative', background: '#ffffff', borderRight: '1px solid #e5e7eb' }}>
          <Canvas
            tool={selectedTool} strokeWidth={strokeWidth} userInfo={userInfo}
            onUserAssigned={handleUserAssigned}
            onConnectionStatus={setConnectionStatus}
            onLeaderInfo={setLeaderInfo}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: '#f9fafb' }}>
          <ClusterPanel />
        </div>
      </div>
    </div>
  )
}
