import React, { useState, useEffect } from 'react';
import { Trophy } from 'lucide-react';
import { ACHIEVEMENTS } from '../constants';

export default function AchievementPopupContainer({ popups, setPopups }) {
  const [dismissed, setDismissed] = useState([]);
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  useEffect(() => {
    if (!popups || popups.length === 0) {
      setDismissed([]);
      setSummaryDismissed(false);
    }
  }, [popups]);

  if (!popups || popups.length === 0) return null;

  const initialDisplay = popups.length > 3 ? popups.slice(0, 2) : popups;
  const remainingCount = popups.length > 3 ? popups.length - 2 : 0;

  const displayPopups = initialDisplay.filter(id => !dismissed.includes(id));
  const showSummary = remainingCount > 0 && !summaryDismissed;

  const handleClose = (id) => {
    setDismissed(prev => {
      const next = [...prev, id];
      if (initialDisplay.filter(x => !next.includes(x)).length === 0 && !showSummary) {
        setTimeout(() => setPopups([]), 0);
      }
      return next;
    });
  };

  const handleCloseSummary = () => {
    setSummaryDismissed(true);
    if (displayPopups.length === 0) {
      setTimeout(() => setPopups([]), 0);
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '0.8rem', pointerEvents: 'none' }}>
      {displayPopups.map((achId) => {
        const ach = ACHIEVEMENTS.find(a => a.id === achId);
        if (!ach) return null;
        return (
          <div key={ach.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(30, 58, 138, 0.95)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.5)', width: '300px', boxShadow: '0 4px 6px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s ease-out forwards', pointerEvents: 'auto' }}>
            <button onClick={() => handleClose(ach.id)} style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', width: '20px', height: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>✕</button>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
              <Trophy size={20} color="#f59e0b" />
            </div>
            <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.85rem', color: '#f59e0b' }}>도전과제 달성!</p>
              <p style={{ margin: 0, fontSize: '0.95rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{ach.title}</p>
            </div>
          </div>
        );
      })}
      {showSummary && (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(30, 58, 138, 0.95)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.5)', width: '300px', boxShadow: '0 4px 6px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s ease-out forwards', pointerEvents: 'auto' }}>
          <button onClick={handleCloseSummary} style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', width: '20px', height: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>✕</button>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <Trophy size={20} color="#f59e0b" />
          </div>
          <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.2rem', justifyContent: 'center', height: '100%' }}>
            <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.95rem', color: '#f59e0b' }}>+{remainingCount}개의 도전과제 달성!</p>
          </div>
        </div>
      )}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
