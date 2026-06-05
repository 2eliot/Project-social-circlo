'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { resolveMediaUrl } from '@/lib/media-url';
import { useVoiceClip } from '@/lib/use-voice-clip';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { useAuth } from '@/store/auth.store';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DMAttachment = {
  kind: 'image' | 'voice';
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
};

type DMMessage = {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  attachments?: DMAttachment[];
  parent?: {
    id: string;
    authorId: string;
    content: string;
    attachments?: DMAttachment[];
    author?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  } | null;
};

interface ConversationPeer {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface ActiveConversation {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  pendingForMe: boolean;
  canReply: boolean;
  canSendIntro: boolean;
  peer: ConversationPeer;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatShortTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatVoiceDuration(totalSeconds: number) {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function resolveAttachmentUrl(url: string) {
  return resolveMediaUrl(url);
}

/* ------------------------------------------------------------------ */
/*  Voice upload helper                                                */
/* ------------------------------------------------------------------ */

async function uploadDmAttachment(file: File): Promise<DMAttachment | null> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const result = await api<{ attachment: DMAttachment | null }>('/dm/upload', {
      method: 'POST',
      body: formData,
    });
    return result.attachment;
  } catch {
    throw new Error('No se pudo subir el archivo');
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const REACTION_EMOJIS = ['❤️', '🔥', '👍', '😂', '😮'] as const;
type ReactionMap = Record<string, { emoji: string; count: number; reacted: boolean }>;

/* ------------------------------------------------------------------ */
/*  Emoji Picker (shown on long-press)                                */
/* ------------------------------------------------------------------ */

function EmojiPicker({
  x,
  y,
  mine,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  mine: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const isReady = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { isReady.current = true; }, 300);
    return () => clearTimeout(t);
  }, []);

  /* Ensure the picker NEVER renders below the composer area */
  const PICKER_H = 56;
  const COMPOSER_H = 52; /* footer (48px) + gap */
  const maxTop = window.innerHeight - PICKER_H - COMPOSER_H;
  const topPos = Math.min(
    y + PICKER_H + COMPOSER_H > window.innerHeight
      ? Math.max(8, y - 200)
      : y - 56,
    maxTop,
  );

  return (
    <>
      {/* Transparent backdrop — ignores taps for the first 300ms so the finger-up doesn't close it */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => { if (isReady.current) onClose(); }}
        onPointerDown={(e) => { if (!isReady.current) e.stopPropagation(); }}
      />
      <div
        className="fixed z-50 flex gap-1 px-2 py-1.5 rounded-2xl shadow-2xl pointer-events-auto max-w-[calc(100vw-16px)]"
        style={{
          ...(mine
            ? { left: 'auto', right: Math.max(8, window.innerWidth - x - 10) }
            : { right: 'auto', left: Math.max(8, Math.min(x - 80, window.innerWidth - 250)) }
          ),
          top: topPos,
          background: 'rgba(18,21,37,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(emoji); }}
            className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-white/10 active:scale-110 transition-all text-[22px]"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface ChatConversationProps {
  conversation: ActiveConversation;
  messages: DMMessage[];
  loading: boolean;
  error: string | null;
  onlineUserIds: Set<string>;
  onBack: () => void;
  onOpenProfile: (userId: string) => void;
  onConversationChanged: () => void;
  onSendMessage: (content: string, attachments: DMAttachment[], parentId?: string, parent?: DMMessage['parent']) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onDeleteConversation: () => Promise<void>;
  onAcceptConversation?: () => Promise<void>;
  onRejectConversation?: () => Promise<void>;
}

/* ================================================================== */
/*  MAIN COMPONENT                                                    */
/* ================================================================== */

export default function ChatConversation({
  conversation,
  messages,
  loading,
  error,
  onlineUserIds,
  onBack,
  onOpenProfile,
  onConversationChanged,
  onSendMessage,
  onDeleteMessage,
  onDeleteConversation,
  onAcceptConversation,
  onRejectConversation,
}: ChatConversationProps) {
  const { user } = useAuth();

  /* --- States --- */
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<DMAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const voice = useVoiceRecorder({
    endpoint: '/dm/upload',
    onAttached: (attachment) => {
      setPendingAttachments((prev) => [...prev, attachment].slice(0, 4));
    },
    onError: (msg) => setLocalError(msg),
  });
  const [replyingTo, setReplyingTo] = useState<DMMessage | null>(null);
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [acting, setActing] = useState(false);
  const [imagePopupUrl, setImagePopupUrl] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [longPressMenu, setLongPressMenu] = useState<{ messageId: string; x: number; y: number; mine: boolean } | null>(null);

  /* --- Swipe state --- */
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartX = useRef(0);
  const swipeElem = useRef<HTMLElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* --- Refs --- */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef<number>(0);

  const canWrite = Boolean(conversation.canReply || conversation.canSendIntro);
  const peerId = conversation.peer.id;

  /* --- Check if peer is blocked --- */
  useEffect(() => {
    async function checkBlocked() {
      try {
        const data = await api<{ blocked: { id: string }[] }>('/blocks');
        const blockedIds = (data.blocked ?? data).map((b: any) => (typeof b === 'string' ? b : b.id));
        setIsBlocked(blockedIds.includes(peerId));
      } catch { /* ignore */ }
    }
    void checkBlocked();
  }, [peerId]);

  /* --- Socket typing listener --- */
  useEffect(() => {
    const socket = getSocket('/social');
    const convId = conversation.id;
    const onTyping = (payload: { conversationId: string; userId: string }) => {
      if (payload?.conversationId !== convId || payload?.userId !== peerId) return;
      setPeerIsTyping(true);
      if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => {
        setPeerIsTyping(false);
        typingTimerRef.current = null;
      }, 3500);
    };
    socket.on('dm_typing', onTyping);
    return () => {
      socket.off('dm_typing', onTyping);
      if (typingTimerRef.current !== null) { window.clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
      setPeerIsTyping(false);
    };
  }, [conversation.id, peerId]);

  /* --- Click outside menu --- */
  useEffect(() => {
    if (!showMenu) return;
    const handler = () => setShowMenu(false);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showMenu]);

  /* --- Upload attachment --- */
  async function addAttachment(file: File) {
    setUploadingAttachment(true);
    try {
      const attachment = await uploadDmAttachment(file);
      if (attachment) setPendingAttachments((prev) => [...prev, attachment].slice(0, 4));
    } catch {
      setLocalError('No se pudo subir el archivo.');
    } finally {
      setUploadingAttachment(false);
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void addAttachment(file);
    e.target.value = '';
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  /* --- Send message --- */
  async function sendMessage() {
    if ((!composer.trim() && pendingAttachments.length === 0) || sending) return;
    setSending(true); setLocalError(null);
    const content = composer;
    const attachments = [...pendingAttachments];
    const parentId = replyingTo?.id;
    const parent = replyingTo ? {
      id: replyingTo.id,
      authorId: replyingTo.authorId,
      content: replyingTo.content,
      attachments: replyingTo.attachments,
      author: replyingTo.author,
    } : undefined;
    setComposer(''); setPendingAttachments([]); setReplyingTo(null);
    try {
      await onSendMessage(content, attachments, parentId, parent);
    } catch (err) {
      setComposer(content); setPendingAttachments(attachments); setReplyingTo(replyingTo);
      if (err instanceof ApiError && err.status === 403) { setLocalError('No puedes enviar más mensajes.'); }
      else { setLocalError('No se pudo enviar.'); }
    } finally {
      setSending(false);
      /* Re-focus the composer input so the user can keep typing without re-clicking */
      composerInputRef.current?.focus();
    }
  }

  function onComposerChange(value: string) {
    setComposer(value);
    if (canWrite) {
      const now = Date.now();
      if (now - lastTypingEmitRef.current > 3000) {
        lastTypingEmitRef.current = now;
        getSocket('/social').emit('dm_typing', { conversationId: conversation.id, peerId });
      }
    }
  }

  /* --- Toggle reaction --- */
  function toggleReaction(messageId: string, emoji: string) {
    setReactions((prev: Record<string, any>) => {
      const current: Record<string, any> = prev[messageId] ?? {};
      const existing = current[emoji];
      if (!existing) {
        return { ...prev, [messageId]: { ...current, [emoji]: { emoji, count: 1, reacted: true } } };
      }
      if (existing.reacted) {
        const newCount = existing.count - 1;
        if (newCount <= 0) {
          const { [emoji]: _remove, ...rest } = current;
          const updated = { ...prev, [messageId]: rest };
          if (Object.keys(rest).length === 0) {
            const { [messageId]: _m, ...clean } = updated;
            return clean;
          }
          return updated;
        }
        return { ...prev, [messageId]: { ...current, [emoji]: { ...existing, count: newCount, reacted: false } } };
      }
      return { ...prev, [messageId]: { ...current, [emoji]: { ...existing, count: existing.count + 1, reacted: true } } };
    });
    setLongPressMenu(null);
  }

  /* --- Long-press handlers --- */
  function handlePointerDown(messageId: string, mine: boolean, e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    swipeElem.current = el;
    swipeStartX.current = e.clientX;
    setSwipingMessageId(messageId);
    setSwipeOffset(0);

    longPressTimer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setLongPressMenu({ messageId, x: e.clientX, y: rect.top, mine });
      setSwipingMessageId(null);
      setSwipeOffset(0);
    }, 500);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (!swipingMessageId) return;
    const dx = e.clientX - swipeStartX.current;
    if (dx > 0) setSwipeOffset(Math.min(dx, 80));
    else if (dx < -20) { setSwipingMessageId(null); setSwipeOffset(0); }
  }

  function handlePointerUp(message: DMMessage) {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (swipeOffset > 40 && swipingMessageId === message.id) {
      setReplyingTo(message);
    }
    setSwipingMessageId(null);
    setSwipeOffset(0);
  }

  /* --- Block / Unblock --- */
  async function handleBlockToggle() {
    setActing(true); setLocalError(null);
    try {
      if (isBlocked) { await api(`/blocks/${peerId}`, { method: 'DELETE' }); setIsBlocked(false); }
      else { await api(`/blocks/${peerId}`, { method: 'POST' }); setIsBlocked(true); }
      setShowMenu(false);
    } catch { setLocalError('No se pudo actualizar el bloqueo.'); }
    finally { setActing(false); }
  }

  async function handleDeleteConversation() {
    setActing(true);
    try { await onDeleteConversation(); setShowMenu(false); }
    catch { setLocalError('No se pudo eliminar.'); }
    finally { setActing(false); }
  }

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */

  const displayError = error || localError;

  return (
    <div className="flex flex-col h-full bg-[#050712] relative overflow-hidden min-h-0">

      <input ref={imageInputRef} type="file" accept="image/*" className="opacity-0 absolute w-0 h-0 overflow-hidden -z-10" onChange={onPickImage} />

      {/* ===== HEADER ===== */}
      <header className={`flex items-center gap-2 px-2 py-1.5 bg-[#090b19]/96 border-b border-white/[0.05] shrink-0 ${longPressMenu ? 'z-50' : 'z-5'} relative`}>
        {/* Back */}
        <button type="button" onClick={onBack}
          className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#101225] text-[#8c55ff] text-xl font-light border-none cursor-pointer shrink-0">
          ‹
        </button>

        {/* Avatar */}
        <button type="button" onClick={() => onOpenProfile(peerId)}
          className="relative w-8 h-8 border-none bg-none cursor-pointer p-0 shrink-0">
          <img
            src={conversation.peer.avatarUrl ? resolveMediaUrl(conversation.peer.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.peer.displayName)}&background=b7c26f&color=fff&bold=true`}
            alt={conversation.peer.displayName}
            className="w-8 h-8 rounded-xl object-cover bg-[#b7c26f] border border-white/[0.08]"
          />
          {onlineUserIds.has(peerId) && (
            <span className="absolute w-2 h-2 rounded-full bg-[#28ff63] -right-0.5 bottom-0 border-2 border-[#080a17]" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[13px] font-bold text-white truncate">{conversation.peer.displayName}</span>
            <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#5b31ff] to-[#9c62ff] flex items-center justify-center text-[8px] font-black text-white shrink-0">✓</span>
          </div>
          <div className="flex items-center text-[10px] text-[#a3ffb0]">
            {onlineUserIds.has(peerId) ? (
              <><span className="w-1.5 h-1.5 rounded-full bg-[#21ff54] mr-1" />En línea</>
            ) : (
              <span className="text-[#727693]">Desconectado</span>
            )}
          </div>
        </div>

        {/* Delete (visible when a message is long-pressed) */}
        {longPressMenu && (
          <button type="button"
            onClick={() => {
              const msgId = longPressMenu.messageId;
              setLongPressMenu(null);
              void onDeleteMessage(msgId);
            }}
            className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#101225] text-[#ff6b6b] border-none cursor-pointer shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15"><path d="M4 7h16" strokeLinecap="round" /><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 7l.6 11a1 1 0 00.94 1h6.8a1 1 0 001-.94L17 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}

        {/* 3-dot menu */}
        <div className="relative">
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu((p) => !p); }}
            className="text-[#9f6cff] text-lg tracking-wide border-none bg-none cursor-pointer px-0.5">
            •••
          </button>
          {showMenu && (
            <div className="absolute top-full right-0 mt-2 min-w-[200px] bg-[#121525] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden z-50"
              onClick={(e) => e.stopPropagation()}>
              <button type="button" disabled={acting} onClick={() => void handleDeleteConversation()}
                className="flex w-full items-center gap-2.5 px-4 py-3 border-none bg-none cursor-pointer text-[#ff6b6b] text-sm font-medium text-left hover:bg-white/5 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 7h16" strokeLinecap="round" /><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 7l.6 11a1 1 0 00.94 1h6.8a1 1 0 001-.94L17 7" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 11v4M14 11v4" strokeLinecap="round" /></svg>
                Eliminar conversación
              </button>
              <button type="button" disabled={acting} onClick={() => void handleBlockToggle()}
                className="flex w-full items-center gap-2.5 px-4 py-3 border-none bg-none cursor-pointer text-sm font-medium text-left hover:bg-white/5 transition-colors"
                style={{ color: isBlocked ? '#28ff63' : '#ff9f43' }}>
                {isBlocked ? (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" strokeLinecap="round" /></svg>Desbloquear usuario</>
                ) : (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" strokeLinecap="round" /></svg>Bloquear usuario</>
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ===== PENDING REQUEST BANNER ===== */}
      {conversation.pendingForMe && (
        <div className="flex flex-col items-center gap-3 px-4 py-4 mx-3 mt-2 mb-1 rounded-2xl bg-gradient-to-b from-[#1a1035] to-[#120b28] border border-[#7349ff]/25 shadow-lg shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <span className="text-sm font-semibold text-white">Solicitud de chat</span>
          </div>
          <p className="text-xs text-[#a8a8c0] text-center">
            {conversation.peer.displayName} quiere conversar contigo
          </p>
          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={() => onAcceptConversation?.()}
              disabled={acting}
              className="flex-1 py-2.5 rounded-xl border-none bg-gradient-to-r from-[#7b43ff] to-[#5d27ff] text-white text-sm font-bold cursor-pointer disabled:opacity-50 transition-all active:scale-[0.97]"
            >
              Aceptar
            </button>
            <button
              type="button"
              onClick={() => onRejectConversation?.()}
              disabled={acting}
              className="flex-1 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm font-semibold cursor-pointer disabled:opacity-50 transition-all active:scale-[0.97]"
            >
              Rechazar
            </button>
          </div>
        </div>
      )}

      {/* ===== MESSAGES ===== */}
      <div ref={messagesContainerRef} className="flex-1 px-3 relative z-2 scrollbar-thin overflow-y-auto"
        style={{ scrollbarWidth: 'thin' }}>

        {/* Date pill */}
        <div className="w-fit mx-auto mb-2 px-3 py-1 bg-[#131523]/94 rounded-xl text-[#eeeeff] text-[11px] font-bold shadow-lg">
          Hoy
        </div>

        <PreserveScroll containerRef={messagesContainerRef} loading={loading} messagesLength={messages.length} />

        {loading ? (
          <div className="text-center text-[#727693] text-sm py-8">Cargando chat...</div>
        ) : displayError ? (
          <div className="text-center text-[#ff6b6b] text-sm py-8">{displayError}</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[#727693] text-sm py-8">No hay mensajes todavía.</div>
        ) : (
          messages.map((message) => {
            const mine = message.authorId === user?.id;
            const voiceAttachment = message.attachments?.find((a) => a.kind === 'voice');
            const msgReactions: Record<string, any> = reactions[message.id] ?? {};
            const reactionEntries = Object.entries(msgReactions).filter(([_, r]: [string, any]) => r?.count > 0);
            const isSwiping = swipingMessageId === message.id;

            return (
              <div key={message.id} className={`relative mb-0.5 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                {/* Reply swipe indicator */}
                {isSwiping && swipeOffset > 20 && (
                  <div className={`absolute top-1/2 -translate-y-1/2 text-[10px] text-[#cdbfff] font-semibold transition-opacity pointer-events-none ${mine ? 'left-0' : 'right-0'}`}
                    style={{ opacity: swipeOffset > 30 ? 1 : 0 }}>
                    Responder
                  </div>
                )}

                {voiceAttachment ? (
                  /* ---- Voice bubble + reactions ---- */
                  <div className="relative"
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointerDown(message.id, mine, e); }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={() => handlePointerUp(message)}
                    onPointerCancel={() => { setSwipingMessageId(null); setSwipeOffset(0); if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
                    onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setLongPressMenu({ messageId: message.id, x: e.clientX, y: r.top, mine }); }}
                  >
                    <VoiceBubble
                      attachment={voiceAttachment}
                      src={resolveAttachmentUrl(voiceAttachment.url)}
                      mine={mine}
                    />
                    {reactionEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {reactionEntries.map(([emoji, r]) => (
                          <button key={emoji} type="button"
                            onClick={(e) => { e.stopPropagation(); toggleReaction(message.id, emoji); }}
                            className={`flex items-center gap-0.5 h-5 px-1.5 rounded-full text-[10px] font-semibold border transition-all ${r.reacted
                              ? 'bg-[#7b38ff]/20 border-[#7b38ff]/40 text-[#cdbfff]'
                              : 'bg-[#121525] border-white/[0.06] text-[#eeeef7]'
                            }`}>
                            <span className="text-sm">{emoji}</span>
                            {r.count > 1 && <span>{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ---- Text/image bubble ---- */
                  <div
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointerDown(message.id, mine, e); }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={() => handlePointerUp(message)}
                    onPointerCancel={() => { setSwipingMessageId(null); setSwipeOffset(0); if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
                    onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setLongPressMenu({ messageId: message.id, x: e.clientX, y: r.top, mine }); }}
                    className={`relative max-w-[78%] px-3 py-2 text-sm leading-snug break-words shadow-lg select-none ${mine
                      ? 'rounded-2xl rounded-br-lg bg-gradient-to-br from-[#7b43ff] to-[#5d27ff] text-white'
                      : 'rounded-2xl rounded-bl-lg bg-gradient-to-b from-[#111423] to-[#0d0f1c] text-white/90 border border-white/[0.055]'
                    }`}
                    style={{
                      touchAction: 'pan-y',
                      transform: `translateX(${isSwiping ? swipeOffset : 0}px)`,
                      transition: isSwiping ? 'none' : 'transform 120ms ease-out',
                    }}
                  >
                    {/* Reply preview */}
                    {message.parent && (
                      <div className={`rounded-xl px-2.5 py-1 mb-1.5 text-[11px] ${mine ? 'bg-black/15 border border-white/10' : 'bg-white/5 border border-white/10'}`}>
                        <div className="font-semibold opacity-80">{message.parent.author?.displayName ?? 'Mensaje'}</div>
                        <div className="opacity-70 truncate">{message.parent.content?.slice(0, 60) || '📎 Archivo'}</div>
                      </div>
                    )}

                    {/* Images */}
                    {message.attachments?.filter((a) => a.kind === 'image').map((att, i) => (
                      <button key={i} type="button" onClick={(e) => { e.stopPropagation(); setImagePopupUrl(resolveAttachmentUrl(att.url)); }}
                        className="block p-0 border-none bg-none cursor-pointer mt-1">
                        <img src={resolveAttachmentUrl(att.url)} alt="" className="max-w-full max-h-40 rounded-xl object-cover" />
                      </button>
                    ))}

                    {/* Text */}
                    {message.content && (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}

                    {/* Timestamp + double check */}
                    <div className={`flex justify-end items-center gap-1 mt-0.5 text-[10px] ${mine ? 'text-white/60' : 'text-white/40'}`}>
                      {formatShortTime(message.createdAt)}
                      {mine && <span className="tracking-tighter">✓✓</span>}
                    </div>

                    {/* Reactions row inside bubble */}
                    {reactionEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {reactionEntries.map(([emoji, r]) => (
                          <button key={emoji} type="button"
                            onClick={(e) => { e.stopPropagation(); toggleReaction(message.id, emoji); }}
                            className={`flex items-center gap-0.5 h-6 px-1.5 rounded-full text-[11px] font-semibold border transition-all ${r.reacted
                              ? 'bg-[#7b38ff]/20 border-[#7b38ff]/40 text-[#cdbfff]'
                              : 'bg-[#121525] border-white/[0.06] text-[#eeeef7]'
                            }`}>
                            <span className="text-sm">{emoji}</span>
                            {r.count > 1 && <span>{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

      </div>

      {/* Typing indicator — outside scroll container so it doesn't affect scroll position */}
      {peerIsTyping && (
        <div className="flex items-center gap-2.5 px-3 py-2 mx-3 rounded-2xl bg-gradient-to-b from-[#101321] to-[#0c0f1b] border border-white/[0.055] shadow-lg w-fit max-w-[90%] shrink-0">
          <div className="relative w-7 h-7 shrink-0">
            <img
              src={conversation.peer.avatarUrl ? resolveMediaUrl(conversation.peer.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.peer.displayName)}&background=b7c26f&color=fff&bold=true`}
              alt="" className="w-7 h-7 rounded-lg object-cover bg-[#b7c26f]"
            />
            {onlineUserIds.has(peerId) && (
              <span className="absolute w-2 h-2 rounded-full bg-[#28ff63] -right-0.5 bottom-0 border border-[#080a17]" />
            )}
          </div>
          <span className="text-xs text-[#e5e5ef]">{conversation.peer.displayName} está escribiendo</span>
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7b38ff] shadow-[0_0_6px_rgba(123,56,255,0.9)] animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#7b38ff] shadow-[0_0_6px_rgba(123,56,255,0.9)] animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#7b38ff] shadow-[0_0_6px_rgba(123,56,255,0.9)] animate-bounce [animation-delay:300ms]" />
          </span>
        </div>
      )}

      {/* ===== PENDING ATTACHMENTS ===== */}
      {pendingAttachments.length > 0 && !voice.isRecording && (
        <div className="flex gap-2 px-3 py-1.5 bg-[#0e1021]/95 rounded-xl border border-[#7349ff]/20 z-9 overflow-x-auto shrink-0 mx-3 mb-1.5 scroll-snap-x">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg shrink-0">
              {att.kind === 'image' ? (
                <img src={resolveAttachmentUrl(att.url)} alt="" className="w-7 h-7 rounded-md object-cover" />
              ) : (
                <span className="text-sm">🎤</span>
              )}
              <button type="button" onClick={() => removePendingAttachment(i)}
                className="bg-none border-none text-[#ff6b6b] text-sm cursor-pointer p-0.5 leading-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Recording indicator */}
      {voice.isRecording && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-xl border border-red-500/20 text-[#ff6b6b] text-xs font-semibold z-9 shrink-0 mx-3 mb-1.5">
          <span className="w-2 h-2 rounded-full bg-[#ff4444] animate-pulse" />
          Grabando {formatVoiceDuration(voice.elapsed)}
          <span className="text-white/40 font-normal ml-1">— pulsa el micrófono para detener</span>
        </div>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0e1021]/95 rounded-xl border border-white/10 z-9 shrink-0 mx-3 mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-[#cdbfff]">Respondiendo a {replyingTo.author?.displayName ?? 'mensaje'}</div>
            <div className="text-xs opacity-70 truncate">{replyingTo.content?.slice(0, 60) || '📎 Archivo'}</div>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="text-xs opacity-60 bg-none border-none cursor-pointer shrink-0">Cancelar</button>
        </div>
      )}

      {/* ===== COMPOSER ===== */}
      <footer className="shrink-0 h-12 bg-[#0e1021]/97 border-t border-[#7349ff]/12 flex items-center px-2 shadow-2xl z-10">
        {/* Gallery */}
        <button type="button" disabled={!canWrite || sending || uploadingAttachment || voice.isRecording}
          onClick={() => imageInputRef.current?.click()}
          className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#111426] border border-white/[0.035] text-[#c7b5ff] cursor-pointer shrink-0 mr-1.5 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
        </button>

        {/* Mic */}
        <button type="button" disabled={!canWrite || sending || uploadingAttachment}
          onClick={() => void voice.toggle()}
          className={`flex items-center justify-center w-8 h-8 rounded-xl border cursor-pointer shrink-0 mr-1.5 ${voice.isRecording ? 'bg-red-500/20 border-red-500/30 text-[#ff4444]' : 'bg-[#111426] border-white/[0.035] text-[#c7b5ff]'} disabled:opacity-40`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></svg>
        </button>

        {/* Text input */}
        <div className="flex-1 h-9 rounded-xl bg-[#121524] border border-white/[0.055] flex items-center px-3 mr-1.5">
          <input
            ref={composerInputRef}
            type="text"
            value={composer}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
            placeholder={canWrite ? 'Mensaje...' : 'No disponible'}
            disabled={!canWrite || sending || uploadingAttachment}
            className="w-full bg-transparent border-none outline-none text-[#e5e5ef] text-sm font-inherit placeholder-white/30"
          />
        </div>

        {/* Send */}
        <button type="button" disabled={!canWrite || sending || uploadingAttachment || (!composer.trim() && pendingAttachments.length === 0)}
          onClick={() => void sendMessage()}
          className="flex items-center justify-center w-9 h-9 rounded-full border-none bg-gradient-to-br from-[#8d52ff] to-[#5a18ff] text-white cursor-pointer shrink-0 shadow-[0_0_16px_rgba(116,49,255,0.5)] disabled:opacity-40"
        >
          {sending ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" width="16" height="16"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
          )}
        </button>
      </footer>

      {/* ===== LONG-PRESS EMOJI PICKER ===== */}
      {longPressMenu && (
        <EmojiPicker
          x={longPressMenu.x}
          y={longPressMenu.y}
          mine={longPressMenu.mine}
          onSelect={(emoji) => toggleReaction(longPressMenu.messageId, emoji)}
          onClose={() => setLongPressMenu(null)}
        />
      )}

      {/* ===== IMAGE POPUP ===== */}
      {imagePopupUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setImagePopupUrl(null)}>
          <div className="relative max-w-[92vw] max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setImagePopupUrl(null)}
              className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-black/60 border border-white/10 text-white flex items-center justify-center cursor-pointer text-lg">
              ×
            </button>
            <img src={imagePopupUrl} alt="" className="max-w-[92vw] max-h-[88vh] rounded-2xl object-contain border border-white/10 shadow-2xl" />
          </div>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes bounce { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .scrollbar-thin::-webkit-scrollbar { width: 3px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        [animation-delay]:is(span) { animation-delay: var(--delay, 0ms); }
      `}</style>
    </div>
  );
}

/* ================================================================== */
/*  Preserve scroll — stay at bottom if user was near bottom          */
/* ================================================================== */

function PreserveScroll({ containerRef, loading, messagesLength }: { containerRef: React.RefObject<HTMLDivElement | null>; loading: boolean; messagesLength: number }) {
  const firstLoad = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (firstLoad.current && !loading) {
      /* Initial load: scroll to bottom (recent messages near form) */
      firstLoad.current = false;
      container.scrollTop = container.scrollHeight;
      return;
    }

    /* Messages changed: if user was near bottom, stay at bottom */
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (wasNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [loading, messagesLength]);

  return null;
}

/* ================================================================== */
/*  Voice Bubble Sub-component                                        */
/* ================================================================== */

function VoiceBubble({ attachment, src, mine }: { attachment: DMAttachment; src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clip = useVoiceClip(src);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const duration = clip.duration || (attachment.durationSeconds ?? 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
  }, [clip.src]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); return; }
    setPlaying(true);
    audio.play().catch(() => { setPlaying(false); });
  }

  function onTimeUpdate() {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  }

  function onEnded() {
    setPlaying(false);
    setCurrentTime(0);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const bars = Array.from({ length: 16 }, (_, i) => Math.max(6, 10 + Math.sin(i * 1.1) * 6 + Math.sin(i * 0.5) * 4 + Math.random() * 3));

  return (
    <div className={`relative max-w-[75vw] ${mine ? 'rounded-2xl rounded-br-lg bg-gradient-to-br from-[#7b43ff] to-[#5d27ff]' : 'rounded-2xl rounded-bl-lg bg-gradient-to-b from-[#161826] to-[#101220] border border-white/[0.055]'}`}
      style={{ padding: mine ? '8px 10px 10px 11px' : '8px 14px 10px 12px' }}>
      <audio ref={audioRef} src={clip.src} preload="metadata" playsInline
        onTimeUpdate={onTimeUpdate} onEnded={onEnded} />
      {/* Play + time */}
      <div className="flex items-center mb-1.5">
        <button type="button" onClick={togglePlay} onPointerDown={(e) => e.stopPropagation()}
          className={`flex items-center justify-center w-9 h-9 rounded-full border-none cursor-pointer mr-3 shrink-0 ${mine ? 'bg-white/15 text-white' : 'bg-[#8a4eff] text-white shadow-lg'}`}
          style={!mine ? { background: 'radial-gradient(circle at 35% 35%, #8a4eff, #4e1bd1)' } : {}}>
          {playing ? (
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <span className="text-xs font-medium" style={{ color: mine ? 'rgba(255,255,255,0.8)' : '#9b9bbf' }}>
          {formatVoiceDuration(Math.floor(currentTime || 0))}
          <span className="opacity-50 ml-1">/ {formatVoiceDuration(Math.floor(duration))}</span>
        </span>
        {/* Speed badge */}
        <span className={`ml-auto text-[11px] font-bold ${mine ? 'bg-white/12 text-[#cfc2ff] px-2.5 py-0.5 rounded-full' : 'bg-black/55 text-[#bbbbdb] px-2 py-0.5 rounded-md'}`}>
          1x
        </span>
      </div>

      {/* Waveform */}
      <div className="flex items-center gap-0.5" style={{ color: mine ? 'rgba(255,255,255,0.7)' : '#8a5aff' }}>
        {bars.map((h, i) => (
          <span key={i} className="rounded-sm"
            style={{
              width: 3,
              height: h,
              background: 'currentColor',
              opacity: 0.6 + (i / bars.length) * 0.4,
            }}
          />
        ))}
      </div>

      {/* Progress (received only) */}
      {!mine && (
        <div className="w-full h-1 rounded-sm bg-white/10 mt-2.5 overflow-hidden relative">
          <div className="h-full rounded-sm bg-gradient-to-r from-[#884aff] to-[#b47cff]" style={{ width: `${progress * 100}%`, transition: 'width 0.25s linear' }} />
        </div>
      )}
    </div>
  );
}
