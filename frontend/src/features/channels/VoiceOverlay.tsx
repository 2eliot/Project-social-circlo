'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useVoiceStore } from '@/store/voice.store';

/**
 * Floating PIP bubble for voice channels.
 * Minimal UI: mic mute/unmute button + close (X) button.
 * Draggable by long-press anywhere on the bubble (150ms hold to start drag).
 */
export function VoiceOverlay() {
  const pathname = usePathname();
  const {
    activeChannelId,
    activeGroupId,
    isJoined,
    isActive,
    isMuted,
    clear: voiceStoreClear,
  } = useVoiceStore();

  const [position, setPosition] = useState({ x: 16, y: 120 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isVisible = !!activeChannelId && isActive && pathname !== `/app/groups/${activeGroupId}`;

  // ── Long-press to drag (150ms hold) ──
  // Quick taps on buttons work as clicks; hold anywhere to drag.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return; // only left button
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      setDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
      };
      e.preventDefault();
    }, 150);
  }, [position]);

  const onPointerUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (dragging) {
      setDragging(false);
    }
  }, [dragging]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 80, dragRef.current.origX + dx)),
        y: Math.max(60, Math.min(window.innerHeight - 60, dragRef.current.origY + dy)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  // ── Handlers ──
  const handleLeave = () => {
    // Primary: invoke the store callback (works even when group page is unmounted)
    useVoiceStore.getState().onLeaveRequested?.();
    // Fallback: also dispatch event for the group page (when mounted)
    window.dispatchEvent(new CustomEvent('voice:leaveRequested'));
    voiceStoreClear();
  };

  const handleToggleMute = () => {
    // Update store immediately so the bubble UI reflects the change
    const newMuted = !isMuted;
    useVoiceStore.getState().setMuted(newMuted);
    // Primary: invoke the store callback (works even when group page is unmounted)
    useVoiceStore.getState().onMicToggled?.(newMuted);
    // Fallback: also dispatch event for the group page (when mounted)
    window.dispatchEvent(new CustomEvent('voice:toggleMute', { detail: { muted: newMuted } }));
  };

  if (!isVisible) return null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="fixed z-[9999] select-none"
      style={{
        left: position.x,
        top: position.y,
        touchAction: 'none',
        transition: dragging ? 'none' : 'box-shadow 0.2s',
      }}
    >
      <div className={`
        flex items-center gap-1 rounded-full border px-2 py-1.5 shadow-2xl backdrop-blur-xl
        ${dragging ? 'cursor-grabbing scale-110 shadow-[0_20px_50px_rgba(0,0,0,.5)]' : 'cursor-grab'}
        ${isJoined && !isMuted
          ? 'border-emerald-400/30 bg-[#0a1f17]/92 shadow-[0_0_24px_rgba(52,211,153,.18)]'
          : 'border-white/10 bg-[#0c0f1a]/92'}
      `}>
        {/* Mic mute / unmute */}
        {isJoined && (
          <button
            type="button"
            onClick={handleToggleMute}
            className={`
              flex h-9 w-9 shrink-0 items-center justify-center rounded-full border
              ${isMuted
                ? 'border-rose-400/20 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 active:scale-90'
                : 'border-emerald-400/20 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 active:scale-90'}
              transition-transform duration-150
            `}
            aria-label={isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            {isMuted ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        )}

        {/* Close */}
        <button
          type="button"
          onClick={handleLeave}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.03] text-white/50 hover:bg-white/[0.08] hover:text-white/80 active:scale-90 transition-transform duration-150"
          aria-label="Salir del chat de voz"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
