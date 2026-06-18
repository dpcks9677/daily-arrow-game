import React, { useEffect, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import './MobileDPad.css';

export default function MobileDPad({ onDirectionPress }) {
  const dpadRef = useRef(null);

  useEffect(() => {
    const handleTouchMove = (e) => {
      e.preventDefault();
    };

    const dpadElement = dpadRef.current;
    if (dpadElement) {
      dpadElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    }

    return () => {
      if (dpadElement) {
        dpadElement.removeEventListener('touchmove', handleTouchMove);
      }
    };
  }, []);

  const handlePress = (direction, e) => {
    e.preventDefault();
    onDirectionPress(direction);
  };

  return (
    <div className="mobile-dpad-container" ref={dpadRef}>
      <button 
        className="dpad-btn dpad-up" 
        onPointerDown={(e) => handlePress('ArrowUp', e)}
      >
        <ArrowUp size={32} />
      </button>
      <button 
        className="dpad-btn dpad-left" 
        onPointerDown={(e) => handlePress('ArrowLeft', e)}
      >
        <ArrowLeft size={32} />
      </button>
      <div className="dpad-center"></div>
      <button 
        className="dpad-btn dpad-down" 
        onPointerDown={(e) => handlePress('ArrowDown', e)}
      >
        <ArrowDown size={32} />
      </button>
      <button 
        className="dpad-btn dpad-right" 
        onPointerDown={(e) => handlePress('ArrowRight', e)}
      >
        <ArrowRight size={32} />
      </button>
    </div>
  );
}
