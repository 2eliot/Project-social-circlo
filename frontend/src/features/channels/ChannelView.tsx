'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { resolveMediaUrl } from '@/lib/media-url';
import { getSocket } from '@/lib/socket-client';
import { useAuth } from '@/store/auth.store';

interface Channel { id: string; name: string; type: 'TEXT' | 'VOICE' | 'VIDEO'; isEnabled: boolean; }
interface Message {
  id: string;
  createdAt: string;
  content: string | null;
  authorId: string | null;
  attachments?: Array<{ kind?: string; url?: string; fileName?: string | null }>;
  author?: { id: string; displayName: string; avatarUrl: string | null; isAnonymousProfile: boolean } | null;
  parent?: {
    id: string;
    content: string | null;
    attachments?: Array<{ kind?: string; url?: string; fileName?: string | null }>;
    author?: { id: string; displayName: string } | null;
  } | null;
}

type GroupMemberRole = 'GROUP_ADMIN' | 'GROUP_MODERATOR' | 'GROUP_MEMBER';

type MessageAttachment = { kind?: string; url?: string; fileName?: string | null; mimeType?: string | null; size?: number | null };

type VoiceHeroMember = { id: string; displayName: string; avatarUrl: string | null; micMuted: boolean; isSpeaker: boolean; isSelf: boolean };

export function ChannelView({ channel, minimal = false, showComposer = true, showVoiceControls = false, canToggleVoice = false, voiceEnabled = true, voiceBusy = false, onToggleVoice, canJoinVoice = false, voiceJoined = false, voiceJoinBusy = false, voiceRequestPending = false, onVoiceJoinAction, voiceChannelId, onMicMutedChange, memberRoles, canManageMembers = false, onToggleMemberMenu, onOpenProfile, voiceHeroMembers, canAssignRoles = false, bannerUrl, isMember = true, joinBusy = false, onJoinGroup, onLeaveGroup }: { channel: Channel; minimal?: boolean; showComposer?: boolean; showVoiceControls?: boolean; canToggleVoice?: boolean; voiceEnabled?: boolean; voiceBusy?: boolean; onToggleVoice?: () => void; canJoinVoice?: boolean; voiceJoined?: boolean; voiceJoinBusy?: boolean; voiceRequestPending?: boolean; onVoiceJoinAction?: () => void; voiceChannelId?: string; onMicMutedChange?: (muted: boolean) => void; memberRoles?: Record<string, GroupMemberRole>; canManageMembers?: boolean; onToggleMemberMenu?: (memberId: string) => void; onOpenProfile?: (userId: string) => void; voiceHeroMembers?: VoiceHeroMember[]; canAssignRoles?: boolean; bannerUrl?: string | null; isMember?: boolean; joinBusy?: boolean; onJoinGroup?: () => void; onLeaveGroup?: () => void }) {
  if (channel.type === 'TEXT') return <TextChannelView channel={channel} minimal={minimal} showComposer={showComposer} showVoiceControls={showVoiceControls} canToggleVoice={canToggleVoice} voiceEnabled={voiceEnabled} voiceBusy={voiceBusy} onToggleVoice={onToggleVoice} canJoinVoice={canJoinVoice} voiceJoined={voiceJoined} voiceJoinBusy={voiceJoinBusy} voiceRequestPending={voiceRequestPending} onVoiceJoinAction={onVoiceJoinAction} voiceChannelId={voiceChannelId} onMicMutedChange={onMicMutedChange} memberRoles={memberRoles} canManageMembers={canManageMembers} onToggleMemberMenu={onToggleMemberMenu} onOpenProfile={onOpenProfile} voiceHeroMembers={voiceHeroMembers} canAssignRoles={canAssignRoles} bannerUrl={bannerUrl} isMember={isMember} joinBusy={joinBusy} onJoinGroup={onJoinGroup} onLeaveGroup={onLeaveGroup} />;
  return <VoiceVideoChannelView channel={channel} />;
}

function TextChannelView({ channel, minimal = false, showComposer = true, showVoiceControls = false, canToggleVoice = false, voiceEnabled = true, voiceBusy = false, onToggleVoice, canJoinVoice = false, voiceJoined = false, voiceJoinBusy = false, voiceRequestPending = false, onVoiceJoinAction, voiceChannelId, onMicMutedChange, memberRoles, canManageMembers = false, onToggleMemberMenu, onOpenProfile, voiceHeroMembers, canAssignRoles = false, bannerUrl, isMember = true, joinBusy = false, onJoinGroup, onLeaveGroup }: { channel: Channel; minimal?: boolean; showComposer?: boolean; showVoiceControls?: boolean; canToggleVoice?: boolean; voiceEnabled?: boolean; voiceBusy?: boolean; onToggleVoice?: () => void; canJoinVoice?: boolean; voiceJoined?: boolean; voiceJoinBusy?: boolean; voiceRequestPending?: boolean; onVoiceJoinAction?: () => void; voiceChannelId?: string; onMicMutedChange?: (muted: boolean) => void; memberRoles?: Record<string, GroupMemberRole>; canManageMembers?: boolean; onToggleMemberMenu?: (memberId: string) => void; onOpenProfile?: (userId: string) => void; voiceHeroMembers?: VoiceHeroMember[]; canAssignRoles?: boolean; bannerUrl?: string | null; isMember?: boolean; joinBusy?: boolean; onJoinGroup?: () => void; onLeaveGroup?: () => void }) {
  const router = useRouter();
  const user = useAuth((state) => state.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const oldestCreatedAtRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [micMuted, setMicMuted] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [imagePopupUrl, setImagePopupUrl] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, Record<string, { emoji: string; count: number; reacted: boolean }>>>({});
  const [longPressMenu, setLongPressMenu] = useState<{ messageId: string; x: number; y: number; mine: boolean } | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const swipeStartRef = useRef<{ messageId: string; startX: number } | null>(null);
  const longPressTargetRef = useRef<HTMLElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressLongPressClickRef = useRef(false);
  const previewMessages = messages;

  const REACTION_EMOJIS = ['❤️', '🔥', '👍', '😂', '😮'] as const;

  function formatShortTime(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function toggleReaction(messageId: string, emoji: string) {
    setReactions((prev) => {
      const current = prev[messageId] ?? {};
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

  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    api<Message[]>(`/channels/${channel.id}/messages?limit=50`).then((m) => {
      if (!cancelled) {
        const ordered = [...m].reverse();
        setMessages(ordered);
        setHasMore(m.length >= 50);
        if (ordered.length > 0) {
          oldestCreatedAtRef.current = ordered[0].createdAt;
        }
        setInitialLoading(false);
      }
    });

    const socket = getSocket('/chat');
    socket.emit('join_channel', { channelId: channel.id });

    const upsertMessage = (nextMessage: Message) =>
      setMessages((prev) => {
        const exists = prev.some((item) => item.id === nextMessage.id);
        if (exists) {
          return prev.map((item) => (item.id === nextMessage.id ? nextMessage : item));
        }
        return [...prev, nextMessage];
      });

    const onNew = (m: Message) => upsertMessage(m);
    const onPending = (m: Message) => upsertMessage(m);
    const onDeleted = (payload: { id: string }) =>
      setMessages((prev) => prev.filter((item) => item.id !== payload.id));
    const onEdited = (payload: { id: string; content: string }) =>
      setMessages((prev) => prev.map((item) => (item.id === payload.id ? { ...item, content: payload.content } : item)));

    socket.on('message_new', onNew);
    socket.on('message_pending', onPending);
    socket.on('message_deleted', onDeleted);
    socket.on('message_edited', onEdited);

    return () => {
      cancelled = true;
      socket.emit('leave_channel', { channelId: channel.id });
      socket.off('message_new', onNew);
      socket.off('message_pending', onPending);
      socket.off('message_deleted', onDeleted);
      socket.off('message_edited', onEdited);
    };
  }, [channel.id]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!voiceJoined || !voiceChannelId) return;
    getSocket('/sfu').emit('set_mic_muted', { channelId: voiceChannelId, muted: micMuted });
  }, [micMuted, voiceChannelId, voiceJoined]);

  function toggleMicMuted() {
    setMicMuted((current) => {
      const next = !current;
      onMicMutedChange?.(next);
      return next;
    });
  }

  /* --- Mobile keyboard: keep composer flush with keyboard top --- */
  useEffect(() => {
    const onResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const root = chatRootRef.current;
      if (!root) return;
      const keyboardH = window.innerHeight - vv.height;
      if (keyboardH > 80) {
        // Available height = visual viewport height minus root's visual offset from top
        const rootTop = root.getBoundingClientRect().top;
        const availableH = Math.max(0, vv.height - rootTop);
        root.style.height = `${availableH}px`;
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      } else {
        root.style.height = '';
      }
    };
    window.visualViewport?.addEventListener('resize', onResize);
    onResize();
    return () => window.visualViewport?.removeEventListener('resize', onResize);
  }, []);

  /* --- Click outside long-press menu --- */
  useEffect(() => {
    if (!longPressMenu) return;
    const handler = () => setLongPressMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [longPressMenu]);

  /* --- Lazy-load older messages when scrolling to top --- */
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (loadingMore || !hasMore) return;
      // When user scrolls within 80px of the top, load older messages
      if (container.scrollTop < 80) {
        const prevScrollHeight = container.scrollHeight;
        setLoadingMore(true);
        const before = oldestCreatedAtRef.current;
        const url = `/channels/${channel.id}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`;
        api<Message[]>(url).then((older) => {
          if (older.length === 0) {
            setHasMore(false);
            setLoadingMore(false);
            return;
          }
          const ordered = [...older].reverse();
          setMessages((prev) => [...ordered, ...prev]);
          if (ordered.length > 0) {
            oldestCreatedAtRef.current = ordered[0].createdAt;
          }
          setHasMore(older.length >= 50);
          setLoadingMore(false);
          // Preserve scroll position after prepending
          requestAnimationFrame(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - prevScrollHeight;
            }
          });
        }).catch(() => {
          setLoadingMore(false);
        });
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [channel.id, hasMore, loadingMore]);

  async function uploadAttachment(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const payload = await api<{ attachment: MessageAttachment | null }>(`/channels/${channel.id}/messages/upload`, {
        method: 'POST',
        body: form,
      });
      const attachment = payload.attachment;
      if (!attachment) return;
      setPendingAttachments((current) => [...current, attachment].slice(0, 4));
    } finally {
      setUploading(false);
    }
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTargetRef.current = null;
  }

  function beginSwipe(message: Message, clientX: number, el: HTMLElement) {
    clearLongPressTimer();
    longPressTargetRef.current = el;
    longPressTriggeredRef.current = false;
    suppressLongPressClickRef.current = false;
    swipeStartRef.current = { messageId: message.id, startX: clientX };
    setSwipingMessageId(message.id);
    setSwipeOffset(0);
    longPressTimerRef.current = window.setTimeout(() => {
      swipeStartRef.current = null;
      setSwipingMessageId(null);
      setSwipeOffset(0);
      longPressTriggeredRef.current = true;
      suppressLongPressClickRef.current = true;
      const rect = longPressTargetRef.current?.getBoundingClientRect();
      const mine = message.authorId === user?.id;
      setLongPressMenu({ messageId: message.id, x: rect ? rect.left + rect.width / 2 : clientX, y: rect?.top ?? 0, mine });
      longPressTimerRef.current = null;
    }, 500);
  }

  function moveSwipe(clientX: number) {
    if (!swipeStartRef.current) return;
    const rawDelta = clientX - swipeStartRef.current.startX;
    if (Math.abs(rawDelta) > 10) {
      clearLongPressTimer();
    }
    const delta = Math.max(0, Math.min(92, rawDelta));
    setSwipeOffset(delta);
  }

  function finishSwipe(message: Message) {
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      swipeStartRef.current = null;
      setSwipingMessageId(null);
      setSwipeOffset(0);
      return;
    }

    if (swipeStartRef.current?.messageId === message.id && swipeOffset >= 64) {
      setReplyingTo(message);
    }

    swipeStartRef.current = null;
    setSwipingMessageId(null);
    setSwipeOffset(0);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!showComposer || (!input.trim() && pendingAttachments.length === 0)) return;
    const socket = getSocket('/chat');
    socket.emit('send_message', { channelId: channel.id, content: input.trim(), attachments: pendingAttachments, parentId: replyingTo?.id });
    setInput('');
    setReplyingTo(null);
    setPendingAttachments([]);
  }

  const isAdminOrCoA = user?.id ? (memberRoles?.[user.id] === 'GROUP_ADMIN' || memberRoles?.[user.id] === 'GROUP_MODERATOR') : false;

  return (
    <div ref={chatRootRef} className="flex flex-col h-full bg-[#080a17] relative overflow-hidden min-h-0">
      {/* Banner background */}
      {bannerUrl ? (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img src={resolveMediaUrl(bannerUrl)} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}

      <input ref={imageInputRef} type="file" accept="image/*" className="opacity-0 absolute w-0 h-0 overflow-hidden -z-10" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void uploadAttachment(file);
        e.target.value = '';
      }} />

      {/* ===== VOICE BANNER ===== */}
      {showVoiceControls && (
        <div className="shrink-0 mx-3 mt-2 mb-1 rounded-xl border border-white/[0.04] bg-[#0e1021]/75 px-3 py-2 shadow-lg relative z-10">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${voiceEnabled ? 'border-[#7349ff]/15 bg-[#7b38ff]/12 text-[#cdbfff]' : 'border-white/[0.05] bg-[#121525] text-white/45'}`}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-[#eeeeff] leading-tight">
                {!voiceEnabled ? 'Chat de voz inactivo' : voiceJoined ? 'Conectado al chat de voz' : voiceRequestPending ? 'Solicitud enviada' : 'Chat de voz activo'}
              </div>
              <div className="text-[9px] text-white/40 mt-0.5 leading-tight">
                {!voiceEnabled ? 'Nadie está conectado' : voiceJoined ? 'Micrófono abajo a la izquierda' : voiceRequestPending ? 'Esperando aprobación...' : canToggleVoice ? 'Toca para subir o apagar' : 'Toca para solicitar subir'}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
            {canToggleVoice ? (
              <>
                {/* Admin / CoA */}
                {!voiceEnabled ? (
                  <button
                    type="button"
                    disabled={voiceBusy}
                    onClick={onToggleVoice}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold bg-gradient-to-r from-[#7b43ff] to-[#5d27ff] text-white shadow-[0_0_12px_rgba(116,49,255,0.35)] disabled:opacity-50"
                  >
                    {voiceBusy ? '...' : 'Iniciar'}
                  </button>
                ) : (
                  <>
                    {voiceJoined && (
                      <button
                        type="button"
                        disabled={voiceJoinBusy}
                        onClick={onVoiceJoinAction}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/[0.08] bg-white/[0.04] text-white/80 disabled:opacity-50"
                      >
                        {voiceJoinBusy ? '...' : 'Salir'}
                      </button>
                    )}
                    {!voiceJoined && (
                      <button
                        type="button"
                        disabled={voiceJoinBusy}
                        onClick={onVoiceJoinAction}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold bg-gradient-to-r from-[#7b43ff] to-[#5d27ff] text-white shadow-[0_0_12px_rgba(116,49,255,0.35)] disabled:opacity-50"
                      >
                        {voiceJoinBusy ? '...' : 'Subir'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={voiceBusy}
                      onClick={onToggleVoice}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/[0.08] bg-white/[0.04] text-white/70 disabled:opacity-50"
                    >
                      {voiceBusy ? '...' : 'Apagar'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Usuario normal */}
                {voiceEnabled ? (
                  voiceJoined ? (
                    <button
                      type="button"
                      disabled={voiceJoinBusy}
                      onClick={onVoiceJoinAction}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/[0.08] bg-white/[0.04] text-white/80 disabled:opacity-50"
                    >
                      {voiceJoinBusy ? '...' : 'Salir'}
                    </button>
                  ) : voiceRequestPending ? (
                    <button
                      type="button"
                      disabled
                      className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/[0.06] bg-white/[0.02] text-white/50 opacity-60"
                    >
                      Pendiente
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={voiceJoinBusy}
                      onClick={onVoiceJoinAction}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold bg-gradient-to-r from-[#7b43ff] to-[#5d27ff] text-white shadow-[0_0_12px_rgba(116,49,255,0.35)] disabled:opacity-50"
                    >
                      {voiceJoinBusy ? '...' : 'Subir'}
                    </button>
                  )
                ) : null}
              </>
            )}
            </div>
          </div>

          {/* Voice participants grid */}
          {voiceEnabled && voiceHeroMembers && voiceHeroMembers.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/[0.03]">
              <div className="grid grid-cols-4 gap-x-2 gap-y-2">
                {voiceHeroMembers.map((member) => {
                  const speaking = member.isSpeaker && !member.micMuted;
                  return (
                  <div key={member.id} className="text-center">
                    <div className="relative mx-auto h-[48px] w-[48px]">
                      {/* Outer ring */}
                      <div className={`h-full w-full rounded-full p-[2px] ${
                        speaking
                          ? 'bg-[linear-gradient(135deg,#22c55e,#10b981)] shadow-[0_0_14px_rgba(34,197,94,.22)]'
                          : member.isSpeaker
                            ? 'bg-[linear-gradient(135deg,rgba(252,126,255,.95),rgba(102,245,255,.82))] shadow-[0_0_14px_rgba(212,98,255,.15)]'
                            : 'bg-[linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.02))]'
                      }`}>
                        <button
                          type="button"
                          onClick={() => onOpenProfile?.(member.id)}
                          className="relative h-full w-full overflow-hidden rounded-full border border-white/[0.05] bg-[#101521]"
                        >
                          {member.avatarUrl ? <img src={resolveMediaUrl(member.avatarUrl)} alt={member.displayName} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-white/88">{member.displayName.slice(0, 2).toUpperCase()}</div>}
                        </button>
                      </div>
                      {/* Mic sticker overlapping the border ring */}
                      {(member.isSpeaker || member.isSelf) && (
                        <div className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#0e1021] ${
                          member.micMuted
                            ? 'bg-[#3a1520] text-rose-200'
                            : 'bg-[#065f46] text-emerald-200'
                        }`}>
                          <MicBadgeIcon muted={member.micMuted} />
                        </div>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[7px] font-bold uppercase tracking-[0.04em] text-white/80">{truncateVoiceName(member.displayName)}</div>
                    {speaking && (
                      <div className="mt-px text-[7px] font-semibold text-emerald-400/90 tracking-wide">hablando</div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== MESSAGES ===== */}
      <div ref={messagesContainerRef} className="flex-1 px-3 relative z-2 scrollbar-thin overflow-y-auto flex flex-col gap-2 py-3"
        style={{ scrollbarWidth: 'thin' }}>

        <PreserveScroll containerRef={messagesContainerRef} loading={initialLoading} messagesLength={messages.length} />

        {loadingMore && (
          <div className="flex justify-center py-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#4d26b3] border-t-transparent" />
          </div>
        )}

        {previewMessages.length === 0 ? (
          <div className="text-center text-white/40 text-sm py-8">No hay mensajes todavía.</div>
        ) : (
          previewMessages.map((message) => {
            if (!message.authorId) {
              return (
                <div key={`${message.id}-${message.createdAt}`} className="flex justify-center px-3 py-1.5">
                  <div className="max-w-[92%] rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-center text-[10px] font-semibold text-white/70">
                    {message.content}
                  </div>
                </div>
              );
            }
            const mine = message.authorId === user?.id;
            const authorLabel = message.author?.isAnonymousProfile ? 'Anonimo' : message.author?.displayName ?? 'Sistema';
            const authorRole = message.author?.id ? memberRoles?.[message.author.id] : undefined;
            const canOpenMemberMenu = Boolean(canManageMembers && message.author?.id && message.author.id !== user?.id && onToggleMemberMenu);
            const isSwiping = swipingMessageId === message.id;
            const msgReactions = reactions[message.id] ?? {};
            const reactionEntries = Object.entries(msgReactions).filter(([_, r]) => r.count > 0);
            const avatarLetter = authorLabel.slice(0, 2).toUpperCase();
            const avatarUrl = message.author?.avatarUrl ? resolveMediaUrl(message.author.avatarUrl) : null;

            return (
              <div key={`${message.id}-${message.createdAt}`} className="relative flex gap-2.5 items-end flex-row">
                {/* Avatar */}
                <button
                  type="button"
                  className={`shrink-0 w-[34px] h-[34px] rounded-full overflow-hidden border border-white/10 bg-[#101521] flex items-center justify-center text-[10px] font-black text-white/88 ${message.author?.id && !message.author?.isAnonymousProfile && onOpenProfile ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={(e) => {
                    if (!message.author?.id || message.author.isAnonymousProfile || !onOpenProfile) return;
                    e.stopPropagation();
                    onOpenProfile(message.author.id);
                  }}
                >
                  {avatarUrl ? <img src={avatarUrl} alt={authorLabel} className="h-full w-full object-cover" /> : avatarLetter}
                </button>

                {/* Reply swipe indicator */}
                {isSwiping && swipeOffset > 20 && (
                  <div className="absolute top-1/2 -translate-y-1/2 text-[10px] text-[#cdbfff] font-semibold transition-opacity pointer-events-none left-0"
                    style={{ opacity: swipeOffset > 30 ? 1 : 0 }}>
                    Responder
                  </div>
                )}

                {/* ── Message Bubble ── */}
                <div
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); beginSwipe(message, e.clientX, e.currentTarget as HTMLElement); }}
                  onPointerMove={(e) => moveSwipe(e.clientX)}
                  onPointerUp={() => finishSwipe(message)}
                  onPointerCancel={() => finishSwipe(message)}
                  onClickCapture={(e) => {
                    if (suppressLongPressClickRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      suppressLongPressClickRef.current = false;
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setLongPressMenu({ messageId: message.id, x: e.clientX, y: r.top, mine });
                  }}
                  className={`relative max-w-[75%] px-3 py-2 flex flex-col shadow-lg select-none rounded-2xl rounded-bl-lg text-white/90 border ${bannerUrl ? 'bg-[#111423]/75 border-white/[0.08]' : 'bg-gradient-to-b from-[#111423] to-[#0d0f1c] border-white/[0.055]'}`}
                  style={{
                    touchAction: 'pan-y',
                    transform: `translateX(${isSwiping ? swipeOffset : 0}px)`,
                    transition: isSwiping ? 'none' : 'transform 120ms ease-out',
                  }}
                >
                  {/* Author name + tag */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-[#cdbfff]">
                      {authorLabel}
                    </span>
                    {authorRole && authorRole !== 'GROUP_MEMBER' ? (
                      <span className="shrink-0 rounded-md bg-[#7b38ff]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-[#cdbfff]">
                        {authorRole === 'GROUP_ADMIN' ? 'ADMIN' : 'COA'}
                      </span>
                    ) : null}
                  </div>

                  {/* Reply preview */}
                  {message.parent && (
                    <div className="rounded-xl px-2.5 py-1 mb-1.5 text-[10px] bg-white/5 border border-white/10">
                      <div className="font-semibold opacity-80">{message.parent.author?.displayName ?? 'Mensaje'}</div>
                      <div className="opacity-70 truncate">{getReplyPreview(message.parent)}</div>
                    </div>
                  )}

                  {/* Images */}
                  {message.attachments?.filter((a) => a.kind !== 'voice' && a.kind !== 'sticker').map((att, i) => (
                    <button key={i} type="button" onClick={(e) => { e.stopPropagation(); setImagePopupUrl(resolveAttachmentRenderUrl(att.url)); }}
                      className="block p-0 border-none bg-transparent cursor-pointer mt-1.5">
                      <img src={resolveAttachmentRenderUrl(att.url)} alt={att.fileName ?? ''} className="w-full max-h-60 object-cover rounded-xl border border-white/[0.06]" loading="lazy" />
                    </button>
                  ))}

                  {/* Stickers */}
                  {message.attachments?.filter((a) => a.kind === 'sticker').map((att, i) => (
                    <img key={i} src={resolveAttachmentRenderUrl(att.url)} alt={att.fileName ?? 'Sticker'} className="max-h-[112px] w-auto rounded-[16px] object-contain mt-1" />
                  ))}

                  {/* Text + time row */}
                  <div className="flex items-end justify-between gap-3 mt-0.5">
                    {message.content && (
                      <div className="text-[13px] leading-[1.4] whitespace-pre-wrap break-words">{message.content}</div>
                    )}
                    <span className="text-[10px] whitespace-nowrap shrink-0 text-white/40">
                      {formatShortTime(message.createdAt)}
                    </span>
                  </div>

                  {/* Reactions row */}
                  {reactionEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {reactionEntries.map(([emoji, r]) => (
                        <button key={emoji} type="button"
                          onClick={(e) => { e.stopPropagation(); toggleReaction(message.id, emoji); }}
                          className={`flex items-center gap-0.5 h-6 px-1.5 rounded-full text-[11px] font-semibold border transition-all ${r.reacted
                            ? 'bg-[#7b38ff]/20 border-[#7b38ff]/40 text-[#cdbfff]'
                            : bannerUrl
                              ? 'bg-[#121525]/70 border-white/[0.06] text-[#eeeef7]'
                              : 'bg-[#121525] border-white/[0.06] text-[#eeeef7]'
                          }`}>
                          <span className="text-sm">{emoji}</span>
                          {r.count > 1 && <span>{r.count}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ===== PENDING ATTACHMENTS ===== */}
      {pendingAttachments.length > 0 && (
        <div className="flex gap-2 px-3 py-1.5 bg-[#0e1021]/95 rounded-xl border border-[#7349ff]/20 z-9 overflow-x-auto shrink-0 mx-3 mb-1.5 scroll-snap-x">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg shrink-0">
              {att.kind === 'image' ? (
                <img src={resolveAttachmentRenderUrl(att.url)} alt="" className="w-7 h-7 rounded-md object-cover" />
              ) : (
                <span className="text-sm">🎤</span>
              )}
              <button type="button" onClick={() => removePendingAttachment(i)}
                className="bg-none border-none text-[#ff6b6b] text-sm cursor-pointer p-0.5 leading-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0e1021]/95 rounded-xl border border-white/10 z-9 shrink-0 mx-3 mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-[#cdbfff]">Respondiendo a {replyingTo.author?.displayName ?? 'mensaje'}</div>
            <div className="text-xs opacity-70 truncate">{getReplyPreview(replyingTo)}</div>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="text-xs opacity-60 bg-none border-none cursor-pointer shrink-0">Cancelar</button>
        </div>
      )}

      {/* ===== SPECTATOR JOIN / LEAVE BUTTONS ===== */}
      {!isMember ? (
        <footer className="shrink-0 h-14 bg-[#0e1021]/80 border-t border-amber-400/12 flex items-center justify-center gap-3 px-4 shadow-2xl z-10">
          <button
            type="button"
            disabled={joinBusy}
            onClick={() => onJoinGroup?.()}
            className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-6 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50 transition-all shadow-[0_0_16px_rgba(52,211,153,.12)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="7" r="4" />
              <path d="M20 8v6M23 11h-6" strokeLinecap="round" />
            </svg>
            Unirse al grupo
          </button>
          <button
            type="button"
            disabled={joinBusy}
            onClick={() => onLeaveGroup?.()}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm text-white/50 hover:bg-white/10 disabled:opacity-40 transition-all"
          >
            Salir
          </button>
        </footer>
      ) : showComposer ? (
        <footer className="shrink-0 h-12 bg-[#0e1021]/80 border-t border-[#7349ff]/12 flex items-center px-2 shadow-2xl z-10">
          {/* Gallery */}
          <button type="button" disabled={uploading}
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#111426] border border-white/[0.035] text-[#c7b5ff] cursor-pointer shrink-0 mr-1.5 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
          </button>

          {/* Mic */}
          {voiceChannelId ? (
            <button type="button"
              disabled={!voiceEnabled || !voiceJoined}
              onClick={toggleMicMuted}
              className={`flex items-center justify-center w-8 h-8 rounded-xl border cursor-pointer shrink-0 mr-1.5 disabled:opacity-40 transition ${micMuted ? 'border-white/[0.035] bg-[#111426] text-white/50' : 'border-cyan-300/22 bg-cyan-400/10 text-cyan-100 shadow-[0_0_14px_rgba(74,241,255,.14)]'}`}
            >
              <MicStateIcon muted={micMuted} active={voiceEnabled} />
            </button>
          ) : null}

          {/* Text input */}
          <div className="flex-1 h-9 rounded-xl bg-[#121524] border border-white/[0.055] flex items-center px-3 mr-1.5">
            <input
              ref={composerInputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              data-1p-ignore
              data-form-type="other"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as any); } }}
              placeholder="Mensaje..."
              disabled={uploading}
              className="w-full bg-transparent border-none outline-none text-[#e5e5ef] text-sm font-inherit placeholder-white/30"
            />
          </div>

          {/* Send */}
          <button type="button" tabIndex={-1}
            disabled={(!input.trim() && pendingAttachments.length === 0) || uploading}
            onClick={(e) => send(e as any)}
            onPointerDown={(e) => { e.preventDefault(); }}
            className="flex items-center justify-center w-9 h-9 rounded-full border-none bg-gradient-to-br from-[#8d52ff] to-[#5a18ff] text-white cursor-pointer shrink-0 shadow-[0_0_16px_rgba(116,49,255,0.5)] disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" width="16" height="16"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
          </button>
        </footer>
      ) : null}

      {uploading ? <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40 px-3 pb-1 shrink-0">Subiendo imagen...</div> : null}

      {/* ===== LONG-PRESS EMOJI PICKER ===== */}
      {longPressMenu && (() => {
        const msg = messages.find(m => m.id === longPressMenu.messageId);
        const canDelete = longPressMenu.mine || isAdminOrCoA;
        const handleDelete = () => {
          if (!msg || !channel) return;
          const socket = getSocket('/chat');
          socket.emit('delete_message', {
            id: msg.id,
            createdAt: msg.createdAt,
            channelId: channel.id,
          });
          setLongPressMenu(null);
        };
        return (
          <ChannelEmojiPicker
            x={longPressMenu.x}
            y={longPressMenu.y}
            mine={longPressMenu.mine}
            canDelete={canDelete}
            onSelect={(emoji) => toggleReaction(longPressMenu.messageId, emoji)}
            onDelete={handleDelete}
            onClose={() => setLongPressMenu(null)}
          />
        );
      })()}

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
        .scrollbar-thin::-webkit-scrollbar { width: 3px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>
    </div>
  );
}

function getReplyPreview(message?: Pick<Message, 'content' | 'attachments'> | null) {
  if (!message) return 'Mensaje';
  const text = message.content?.trim();
  if (text) return text;
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    const first = message.attachments[0];
    if (first?.kind === 'image') return 'Imagen';
    return 'Archivo';
  }
  return 'Mensaje';
}

function MessageAttachmentView({ attachment }: { attachment: MessageAttachment }) {
  const resolvedUrl = resolveAttachmentRenderUrl(attachment.url);
  if (!resolvedUrl) return null;

  if (attachment.kind === 'sticker') {
    return <img src={resolvedUrl} alt={attachment.fileName ?? 'Sticker'} className="max-h-[112px] w-auto rounded-[16px] object-contain" />;
  }

  return (
    <button type="button" className="block w-full">
      <img src={resolvedUrl} alt={attachment.fileName ?? 'Imagen'} className="max-h-[220px] w-full rounded-[16px] object-cover" />
    </button>
  );
}

function resolveAttachmentRenderUrl(url?: string | null) {
  if (!url) return '';
  if (url.startsWith('/stickers/')) return url;
  return resolveMediaUrl(url);
}

function VoiceVideoChannelView({ channel }: { channel: Channel }) {
  const [connected, setConnected] = useState(false);
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#83f8ff]/28 bg-[radial-gradient(circle,rgba(111,243,255,.18),rgba(111,243,255,.04))] text-[#aefcff] shadow-[0_0_26px_rgba(111,243,255,.18)]">
        {channel.type === 'VOICE' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-9 w-9"><rect x="9" y="4" width="6" height="10" rx="3" /><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-9 w-9"><rect x="3.5" y="6.5" width="12" height="11" rx="2.5" /><path d="m15.5 10.2 5-3v9l-5-3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </div>
      <div>
        <h3 className="text-lg font-semibold">
          {channel.type === 'VOICE' ? 'Sala de voz' : 'Sala de video'} · {channel.name}
        </h3>
        <p className="mt-2 text-sm opacity-70">
          Sala SFU lista. Implementa la conexion de mediasoup-client en <code>src/lib/mediasoup-client.ts</code> y conectate al gateway <code>/sfu</code>.
        </p>
      </div>
      <button className="primary" onClick={() => setConnected((current) => !current)} disabled>
        {connected ? 'Salir' : 'Unirme (TODO)'}
      </button>
    </div>
  );
}

function VoicePowerIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 3v7" strokeLinecap="round" />
      <path d="M7 5.8a8 8 0 1 0 10 0" strokeLinecap="round" strokeLinejoin="round" />
      {!enabled ? <path d="m5 5 14 14" strokeLinecap="round" /> : null}
    </svg>
  );
}

function AttachmentMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15.5 6.5 9 13a3 3 0 1 0 4.24 4.24l6.01-6.01a5 5 0 1 0-7.07-7.07L5.46 10.9a7 7 0 1 0 9.9 9.9L21 15.17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 3v4M21 5h-4M5 16v3M6.5 17.5h-3" strokeLinecap="round" />
    </svg>
  );
}

function MuteMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m5 5 14 14" strokeLinecap="round" />
    </svg>
  );
}

function VoiceJoinIcon({ joined, pending: _pending }: { joined: boolean; pending: boolean }) {
  if (joined) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="m6 10 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 4v11" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="m6 14 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 19V8" strokeLinecap="round" />
    </svg>
  );
}

function MicStateIcon({ muted, active }: { muted: boolean; active: boolean }) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <rect x="9" y="4" width="6" height="10" rx="3" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {muted ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="m5 5 14 14" strokeLinecap="round" />
          </svg>
        </span>
      ) : active ? (
        <span className="pointer-events-none absolute -right-3 flex items-end gap-[2px]">
          <span className="h-2 w-[2px] rounded-full bg-current opacity-70 animate-pulse" />
          <span className="h-3 w-[2px] rounded-full bg-current opacity-90 animate-pulse [animation-delay:120ms]" />
          <span className="h-2.5 w-[2px] rounded-full bg-current opacity-70 animate-pulse [animation-delay:220ms]" />
        </span>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/*  PreserveScroll – keeps view at bottom when new messages arrive     */
/* ================================================================== */

function PreserveScroll({ containerRef, loading, messagesLength }: { containerRef: React.RefObject<HTMLDivElement | null>; loading: boolean; messagesLength: number }) {
  const firstLoad = useRef(true);
  const prevLength = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Skip when there are no messages yet — don't consume firstLoad
    if (messagesLength === 0) return;

    if (firstLoad.current && !loading) {
      firstLoad.current = false;
      // Use requestAnimationFrame to ensure DOM has painted
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight;
      });
      prevLength.current = messagesLength;
      return;
    }

    // If messages were prepended (older messages loaded), preserve scroll position
    const lengthDelta = messagesLength - prevLength.current;
    prevLength.current = messagesLength;
    if (lengthDelta > 0 && container.scrollTop < 50) {
      // Messages were prepended while at top — keep user at roughly same spot
      // scrollHeight already increased, scrollTop stays near 0 naturally
      return;
    }

    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (wasNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [loading, messagesLength]);

  return null;
}

/* ================================================================== */
/*  ChannelEmojiPicker – long‑press reaction picker                    */
/* ================================================================== */

const REACTION_EMOJIS = ['❤️', '🔥', '👍', '😂', '😮'] as const;

function ChannelEmojiPicker({
  x,
  y,
  mine,
  canDelete,
  onSelect,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  mine: boolean;
  canDelete: boolean;
  onSelect: (emoji: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isReady = useRef(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { isReady.current = true; }, 300);
    return () => clearTimeout(t);
  }, []);

  const PICKER_H = 56;
  const PICKER_W = 300; /* 5 emojis + divider + delete btn + padding */
  const COMPOSER_H = 52;
  const maxTop = window.innerHeight - PICKER_H - COMPOSER_H;
  const topPos = Math.min(
    y + PICKER_H + COMPOSER_H > window.innerHeight
      ? Math.max(8, y - 200)
      : y - 56,
    maxTop,
  );

  /* Keep picker fully inside the viewport horizontally */
  const maxRight = window.innerWidth - PICKER_W - 8;
  const leftPos = mine
    ? undefined
    : Math.max(8, Math.min(x - 80, maxRight));
  const rightPos = mine
    ? Math.min(Math.max(8, window.innerWidth - x - 10), maxRight)
    : undefined;

  function handleDelete() {
    onDelete();
    setShowDeleteConfirm(false);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => { if (isReady.current) onClose(); }}
        onPointerDown={(e) => { if (!isReady.current) e.stopPropagation(); }}
      />
      <div
        className="fixed z-50 flex gap-1 px-2 py-1.5 rounded-2xl shadow-2xl pointer-events-auto max-w-[calc(100vw-16px)]"
        style={{
          ...(mine
            ? { left: 'auto', right: rightPos }
            : { right: 'auto', left: leftPos }
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

        {/* 3-dot delete button */}
        {canDelete && (
          <>
            <div className="w-px h-5 bg-white/10 self-center mx-0.5" />
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm((p) => !p); }}
                className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-white/10 active:scale-110 transition-all text-white/70 text-[18px] font-bold"
              >
                ⋮
              </button>
              {showDeleteConfirm && (
                <div
                  className="absolute bottom-full mb-1 right-0 min-w-[160px] bg-[#151829] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#ff6b6b] hover:bg-white/5 transition-colors border-none bg-none cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                      <path d="M4 7h16" strokeLinecap="round" />
                      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M7 7l.6 11a1 1 0 00.94 1h6.8a1 1 0 001-.94L17 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Eliminar mensaje
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function truncateVoiceName(value: string) {
  return value.length > 8 ? `${value.slice(0, 7)}.` : value;
}

function MicBadgeIcon({ muted }: { muted: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-2.5 w-2.5">
        <rect x="9" y="4" width="6" height="10" rx="3" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {muted ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="absolute h-2.5 w-2.5">
          <path d="m5 5 14 14" strokeLinecap="round" />
        </svg>
      ) : null}
    </span>
  );
}
