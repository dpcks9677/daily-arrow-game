import React, { useState, useEffect } from 'react';
import { Unplug } from 'lucide-react';

export default function MultiplayerBoard({ roomData, myUserId }) {
  if (!roomData || !roomData.players) return null;

  const players = roomData.players;
  const opponents = Object.entries(players)
    .filter(([id]) => id !== myUserId)
    .map(([id, data]) => ({ id, ...data }));

  if (opponents.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      gap: '20px',
      justifyContent: 'center',
      marginTop: '30px',
      flexWrap: 'wrap'
    }}>
      {opponents.map((opp) => (
        <MiniBoard key={opp.id} player={opp} />
      ))}
    </div>
  );
}

function MiniBoard({ player }) {
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    if (player.shake && player.shake > 0) {
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 300); // 300ms shake
      return () => clearTimeout(timer);
    }
  }, [player.shake]);

  const progress = player.progress || 0;
  const isDisconnected = player.isDisconnected;
  const isFinished = player.finishedAt !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ 
        marginBottom: '12px', 
        fontSize: '0.85rem', 
        fontWeight: 'bold',
        background: isDisconnected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(59, 130, 246, 0.2)',
        color: isDisconnected ? '#9ca3af' : '#60a5fa',
        padding: '4px 10px',
        borderRadius: '12px',
        border: `1px solid ${isDisconnected ? 'rgba(255,255,255,0.2)' : 'rgba(59, 130, 246, 0.4)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: isDisconnected ? 'none' : '0 0 10px rgba(59, 130, 246, 0.2)'
      }}>
        {player.nickname} {isDisconnected && '(포기)'}
      </div>
      
      <div 
        className={isShaking ? 'shake-animation' : ''}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: '3px',
          padding: '8px',
          background: 'rgba(30, 41, 59, 0.5)',
          borderRadius: '12px',
          border: isShaking ? '2px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: isShaking ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 4px 16px 0 rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          width: 'fit-content',
          opacity: isDisconnected ? 0.5 : 1,
          transition: 'border-color 0.1s, box-shadow 0.1s'
        }}
      >
        {/* Overlay for disconnected player */}
        {isDisconnected && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10
          }}>
            <Unplug size={40} color="#9ca3af" />
          </div>
        )}

        {Array.from({ length: 50 }).map((_, idx) => {
          const isCompleted = idx < progress;
          return (
            <div 
              key={idx}
              style={{
                width: '12px',
                height: '12px',
                background: isCompleted ? '#10b981' : 'rgba(255, 255, 255, 0.05)',
                borderRadius: '3px',
                boxShadow: isCompleted 
                  ? '0 0 8px rgba(16, 185, 129, 0.4)' 
                  : 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                transition: 'background 0.2s ease, box-shadow 0.2s ease'
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
