'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useVoiceStore } from '@/store/voice.store';

/**
 * Floating Overlay / PIP for voice channels.
 * Persists across navigation — renders a draggable bubble
 * when the user is connected to a voice channel but not viewing
 * the owning group page.
 */
export function VoiceOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    activeChannelId,
    activeGroupId,
    activeGroupName,
    isJoined,
    isMuted,
    participants,
    clear: voiceStoreClear,
  } = useVoiceStore();

  const [position, setPosition] = useState({ x: 16, y: 120 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  // Visible only when: channel is active, user has joined as speaker, AND we're NOT on that group's page
  const isVisible = !!activeChannelId && isJoined && pathname !== `/app/groups/${activeGroupId}`;

  // ── Drag handling ──
  // Only start dragging on the main bubble area, not on interactive elements
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Don't start drag on buttons (mute, close) or inputs
    if (target.closest('[data-no-drag]')) return;
    setDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 180, dragRef.current.origX + dx)),
        y: Math.max(60, Math.min(window.innerHeight - 100, dragRef.current.origY + dy)),
      });
    };
    const onUp = () => {
      setDragging(false);
      // ── Snap automático al borde más cercano (estilo Messenger) ──
      if (!dragRef.current) return;
      const bubbleWidth = 180;
      const centerX = dragRef.current.origX + bubbleWidth / 2;
      const snapLeft = centerX < window.innerWidth / 2;
      setPosition((prev) => ({
        x: snapLeft ? 12 : window.innerWidth - bubbleWidth - 12,
        y: prev.y,
      }));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  // ── Go to the group page ──
  const goToGroup = () => {
    if (activeGroupId) {
      router.push(`/app/groups/${activeGroupId}`);
    }
  };

  // ── Handle leave ──
  const handleLeave = () => {
    // Notify the group page to disconnect SFU (if still mounted)
    window.dispatchEvent(new CustomEvent('voice:leaveRequested'));
    // Clean store immediately (hides overlay)
    voiceStoreClear();
  };

  // ── Handle mute/unmute via the store callback ──
  // The group page reads store state and controls the SFU instance
  const handleToggleMute = () => {
    // We dispatch a custom event that the group page listens for
    window.dispatchEvent(new CustomEvent('voice:toggleMute'));
  };

  if (!isVisible) return null;

  const speakerCount = participants.filter((p) => p.isSpeaking || (!p.micMuted && p.isSelf)).length;

  return (
    <div
      ref={bubbleRef}
      onPointerDown={onPointerDown}
      className="fixed z-[9999] select-none"
      style={{
        left: position.x,
        top: position.y,
        touchAction: 'none',
        transition: dragging ? 'none' : 'box-shadow 0.2s',
      }}
    >
      <div className={`
        flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 shadow-2xl backdrop-blur-xl
        ${dragging ? 'cursor-grabbing scale-105 shadow-[0_20px_50px_rgba(0,0,0,.5)]' : 'cursor-grab'}
        ${isJoined && !isMuted
          ? 'border-emerald-400/30 bg-[#0a1f17]/92 shadow-[0_0_24px_rgba(52,211,153,.18)]'
          : 'border-white/10 bg-[#0c0f1a]/92'}
      `}>
        {/* Tap area to go to group — uses div instead of button so it's draggable */}
        <div
          role="button"
          tabIndex={0}
          onClick={goToGroup}
          onKeyDown={(e) => { if (e.key === 'Enter') goToGroup(); }}
          className="flex items-center gap-2 min-w-0 cursor-pointer"
        >
          {/* Mic icon with speaking indicator */}
          <div className={`
            relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border
            ${isJoined && !isMuted
              ? 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300'
              : 'border-white/[0.08] bg-white/[0.04] text-white/50'}
          `}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            {/* Speaking pulse ring */}
            {isJoined && !isMuted && (
              <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/20" />
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-white/90 leading-tight max-w-[100px]">
              {activeGroupName ?? 'Chat de voz'}
            </div>
            <div className="text-[9px] text-white/45 mt-0.5">
              {speakerCount > 0 ? `${speakerCount} hablando` : isJoined && isMuted ? 'Silenciado' : 'Escuchando'}
            </div>
          </div>
        </div>

        {/* Mute/Unmute button */}
        {isJoined && (
          <button
            type="button"
            data-no-drag
            onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}
            className={`
              flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px]
              ${isMuted
                ? 'border-rose-400/15 bg-rose-500/10 text-rose-300'
                : 'border-emerald-400/15 bg-emerald-500/10 text-emerald-300'}
            `}
            aria-label={isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            {isMuted ? (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        )}

        {/* Close button */}
        <button
          type="button"
          data-no-drag
          onClick={(e) => { e.stopPropagation(); handleLeave(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.03] text-white/50 hover:bg-white/[0.08] hover:text-white/80"
          aria-label="Salir del chat de voz"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
