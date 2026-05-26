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

const QUICK_EMOJIS = ['😀', '😂', '🔥', '💯', '🎉', '🙏', '😎', '❤️'];
const STICKER_LIBRARY: Array<{ id: string; label: string; url: string }> = [
  { id: 'burst-heart', label: 'Heart', url: '/stickers/burst-heart.svg' },
  { id: 'cosmic-cat', label: 'Cat', url: '/stickers/cosmic-cat.svg' },
  { id: 'wow-star', label: 'Star', url: '/stickers/wow-star.svg' },
];

export function ChannelView({ channel, minimal = false, showComposer = true, showVoiceControls = false, canToggleVoice = false, voiceEnabled = true, voiceBusy = false, onToggleVoice, canJoinVoice = false, voiceJoined = false, voiceJoinBusy = false, voiceRequestPending = false, onVoiceJoinAction, voiceChannelId, onMicMutedChange, memberRoles, canManageMembers = false, onToggleMemberMenu, onOpenProfile }: { channel: Channel; minimal?: boolean; showComposer?: boolean; showVoiceControls?: boolean; canToggleVoice?: boolean; voiceEnabled?: boolean; voiceBusy?: boolean; onToggleVoice?: () => void; canJoinVoice?: boolean; voiceJoined?: boolean; voiceJoinBusy?: boolean; voiceRequestPending?: boolean; onVoiceJoinAction?: () => void; voiceChannelId?: string; onMicMutedChange?: (muted: boolean) => void; memberRoles?: Record<string, GroupMemberRole>; canManageMembers?: boolean; onToggleMemberMenu?: (memberId: string) => void; onOpenProfile?: (userId: string) => void }) {
  if (channel.type === 'TEXT') return <TextChannelView channel={channel} minimal={minimal} showComposer={showComposer} showVoiceControls={showVoiceControls} canToggleVoice={canToggleVoice} voiceEnabled={voiceEnabled} voiceBusy={voiceBusy} onToggleVoice={onToggleVoice} canJoinVoice={canJoinVoice} voiceJoined={voiceJoined} voiceJoinBusy={voiceJoinBusy} voiceRequestPending={voiceRequestPending} onVoiceJoinAction={onVoiceJoinAction} voiceChannelId={voiceChannelId} onMicMutedChange={onMicMutedChange} memberRoles={memberRoles} canManageMembers={canManageMembers} onToggleMemberMenu={onToggleMemberMenu} onOpenProfile={onOpenProfile} />;
  return <VoiceVideoChannelView channel={channel} />;
}

function TextChannelView({ channel, minimal = false, showComposer = true, showVoiceControls = false, canToggleVoice = false, voiceEnabled = true, voiceBusy = false, onToggleVoice, canJoinVoice = false, voiceJoined = false, voiceJoinBusy = false, voiceRequestPending = false, onVoiceJoinAction, voiceChannelId, onMicMutedChange, memberRoles, canManageMembers = false, onToggleMemberMenu, onOpenProfile }: { channel: Channel; minimal?: boolean; showComposer?: boolean; showVoiceControls?: boolean; canToggleVoice?: boolean; voiceEnabled?: boolean; voiceBusy?: boolean; onToggleVoice?: () => void; canJoinVoice?: boolean; voiceJoined?: boolean; voiceJoinBusy?: boolean; voiceRequestPending?: boolean; onVoiceJoinAction?: () => void; voiceChannelId?: string; onMicMutedChange?: (muted: boolean) => void; memberRoles?: Record<string, GroupMemberRole>; canManageMembers?: boolean; onToggleMemberMenu?: (memberId: string) => void; onOpenProfile?: (userId: string) => void }) {
  const router = useRouter();
  const user = useAuth((state) => state.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [micMuted, setMicMuted] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const swipeStartRef = useRef<{ messageId: string; startX: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressLongPressClickRef = useRef(false);
  const previewMessages = messages;

  useEffect(() => {
    let cancelled = false;
    api<Message[]>(`/channels/${channel.id}/messages?limit=50`).then((m) => {
      if (!cancelled) setMessages([...m].reverse());
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
    const onDeleted = (payload: { id: string }) => setMessages((prev) => prev.filter((item) => item.id !== payload.id));
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
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

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
  }

  function beginSwipe(message: Message, clientX: number, canOpenMemberMenu: boolean) {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    suppressLongPressClickRef.current = false;
    swipeStartRef.current = { messageId: message.id, startX: clientX };
    setSwipingMessageId(message.id);
    setSwipeOffset(0);
    if (!canOpenMemberMenu) return;
    longPressTimerRef.current = window.setTimeout(() => {
      swipeStartRef.current = null;
      setSwipingMessageId(null);
      setSwipeOffset(0);
      longPressTriggeredRef.current = true;
      suppressLongPressClickRef.current = true;
      if (message.author?.id) onToggleMemberMenu?.(message.author.id);
      longPressTimerRef.current = null;
    }, 800);
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
    setEmojiOpen(false);
    setStickerOpen(false);
  }

  return (
    <div className={`relative flex h-full flex-col overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(13,18,34,.96),rgba(8,11,20,.98))] ${minimal ? 'max-h-full' : 'min-h-[520px]'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(87,241,255,.14),transparent_20%),radial-gradient(circle_at_78%_22%,rgba(233,95,255,.12),transparent_22%),radial-gradient(circle_at_52%_68%,rgba(68,99,255,.12),transparent_28%)]" />

      <div ref={listRef} className="relative flex-1 overflow-y-auto px-0 py-0">
        <div className="absolute inset-0 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(24,34,63,.34),rgba(12,16,31,.2))]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(54,0,112,.16),transparent_40%,rgba(0,196,255,.12))]" />
          <div className="absolute left-[18%] top-[10%] h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(255,0,214,.16),transparent_60%)] blur-2xl" />
          <div className="absolute right-[8%] top-[18%] h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(0,230,255,.14),transparent_60%)] blur-2xl" />
        </div>

        <div className="relative flex min-h-full flex-col justify-end gap-1.5 px-2 pb-2 pt-2">
          {previewMessages.length === 0 ? (
            <div className="self-center rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-center text-sm text-white/46">
              Todavia no hay mensajes en este canal.
            </div>
          ) : previewMessages.map((message) => {
            if (!message.authorId) {
              return (
                <div key={`${message.id}-${message.createdAt}`} className="flex justify-center px-3 py-1">
                  <div className="max-w-[92%] rounded-full border border-[#9eeaff]/15 bg-[#9eeaff]/8 px-3 py-1.5 text-center text-[10px] font-semibold text-[#dff8ff] shadow-[0_10px_14px_rgba(0,0,0,.12)]">
                    {message.content}
                  </div>
                </div>
              );
            }
            const mine = message.authorId === user?.id;
            const authorLabel = message.author?.isAnonymousProfile ? 'Anonimo' : message.author?.displayName ?? 'Sistema';
            const authorRole = message.author?.id ? memberRoles?.[message.author.id] : undefined;
            const canOpenMemberMenu = Boolean(canManageMembers && message.author?.id && message.author.id !== user?.id && onToggleMemberMenu);
            const offset = swipingMessageId === message.id ? swipeOffset : 0;
            return (
              <div key={`${message.id}-${message.createdAt}`} className={`flex ${mine ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
                <div className="flex max-w-[90%] items-center gap-2">
                  <div className={offset > 24 ? 'text-[9px] font-semibold uppercase tracking-[0.06em] text-[#d7bfff] opacity-90' : 'text-[9px] font-semibold uppercase tracking-[0.06em] text-[#d7bfff] opacity-0'}>
                    Responder
                  </div>
                  <div
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); beginSwipe(message, e.clientX, canOpenMemberMenu); }}
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
                      if (!canOpenMemberMenu) return;
                      e.preventDefault();
                      if (message.author?.id) onToggleMemberMenu?.(message.author.id);
                    }}
                    className={`relative max-w-[84%] rounded-[16px] border px-2.5 py-2 shadow-[0_10px_14px_rgba(0,0,0,.16)] ${mine ? 'border-white/10 bg-[rgba(47,51,61,.94)] text-white' : 'border-white/8 bg-[rgba(55,61,72,.92)] text-white/92'}`}
                    style={{ transform: `translateX(${offset}px)`, transition: swipingMessageId === message.id ? 'none' : 'transform 120ms ease-out', touchAction: 'pan-y' }}
                  >
                    <div className="flex w-full min-w-0 items-start gap-2 text-left">
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#111925] text-[9px] font-black text-white/88 ${message.author?.id && !message.author?.isAnonymousProfile && onOpenProfile ? 'cursor-pointer' : ''}`}
                      onClick={(event) => {
                        if (!message.author?.id || message.author.isAnonymousProfile || !onOpenProfile) return;
                        event.stopPropagation();
                        onOpenProfile(message.author.id);
                      }}
                    >
                      {message.author?.avatarUrl ? <img src={resolveMediaUrl(message.author.avatarUrl)} alt={authorLabel} className="h-full w-full object-cover" /> : authorLabel.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="truncate text-[9px] font-bold text-white/95">{authorLabel}</div>
                        {authorRole && authorRole !== 'GROUP_MEMBER' ? <div className={`shrink-0 rounded-full border px-1 py-0.5 text-[7px] font-black uppercase tracking-[0.05em] ${authorRole === 'GROUP_ADMIN' ? 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100' : 'border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-100'}`}>{authorRole === 'GROUP_ADMIN' ? 'Admin' : 'CoA'}</div> : null}
                      </div>
                      {message.parent ? (
                        <div className="mt-1 rounded-[10px] border border-white/8 bg-black/15 px-2 py-1 text-[9px] text-white/68">
                          <div className="truncate font-semibold text-white/84">{message.parent.author?.displayName ?? 'Mensaje'}</div>
                          <div className="truncate">{getReplyPreview(message.parent)}</div>
                        </div>
                      ) : null}
                      {message.content ? <div className="mt-0.5 text-[10px] leading-[1.22] whitespace-pre-wrap">{message.content}</div> : null}
                      {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                        <div className="mt-1.5 space-y-2">
                          {message.attachments.map((attachment, index) => (
                            <MessageAttachmentView key={`${message.id}-${attachment.url ?? index}`} attachment={attachment} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showComposer ? (
        <div className="relative mt-auto border-t border-white/8 bg-[linear-gradient(180deg,rgba(9,12,23,.92),rgba(11,15,27,.98))] px-3 pb-3 pt-2">
          {replyingTo ? (
            <div className="mb-2 flex items-center gap-2 rounded-[14px] border border-[#a476ff]/22 bg-[#a476ff]/8 px-3 py-2 text-[10px] text-white/76">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[#e6d6ff]">Respondiendo a {replyingTo.author?.displayName ?? 'mensaje'}</div>
                <div className="truncate">{getReplyPreview(replyingTo)}</div>
              </div>
              <button type="button" onClick={() => setReplyingTo(null)} className="text-[10px] font-semibold text-white/58">
                Cancelar
              </button>
            </div>
          ) : null}
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {pendingAttachments.map((attachment, index) => (
                <div key={`${attachment.url ?? 'pending'}-${index}`} className="relative min-w-[88px] overflow-hidden rounded-[14px] border border-white/10 bg-white/5">
                  {attachment.kind === 'sticker' ? (
                    <img src={resolveAttachmentRenderUrl(attachment.url)} alt={attachment.fileName ?? 'Sticker'} className="h-[88px] w-[88px] object-cover" />
                  ) : (
                    <img src={resolveAttachmentRenderUrl(attachment.url)} alt={attachment.fileName ?? 'Adjunto'} className="h-[88px] w-[88px] object-cover" />
                  )}
                  <button type="button" onClick={() => removePendingAttachment(index)} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form onSubmit={send}>
            <div className="flex items-center gap-2 rounded-full border border-[#a476ff]/34 bg-[linear-gradient(90deg,rgba(87,241,255,.08),rgba(222,95,255,.08))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
              <button type="button" onClick={() => imageInputRef.current?.click()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/72">
                <AttachmentMiniIcon />
              </button>
              <button type="button" onClick={() => { setEmojiOpen((current) => !current); setStickerOpen(false); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/72">
                🙂
              </button>
              <button type="button" onClick={() => { setStickerOpen((current) => !current); setEmojiOpen(false); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/72">
                ✦
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe un mensaje..."
                className="border-0 bg-transparent px-0 py-0 text-sm text-white/86 placeholder:text-white/34"
              />
              <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#ab87ff]/38 bg-[linear-gradient(135deg,rgba(111,243,255,.18),rgba(196,111,255,.18))] text-[#dffcff] shadow-[0_0_18px_rgba(171,135,255,.22)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path d="M4 12h13M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAttachment(file);
                event.target.value = '';
              }}
            />
          </form>

          {emojiOpen ? (
            <div className="mt-2 flex flex-wrap gap-2 rounded-[16px] border border-white/10 bg-white/[0.04] p-2">
              {QUICK_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setInput((current) => `${current}${emoji}`)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-sm">
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          {stickerOpen ? (
            <div className="mt-2 flex gap-2 overflow-x-auto rounded-[16px] border border-white/10 bg-white/[0.04] p-2">
              {STICKER_LIBRARY.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  onClick={() => setPendingAttachments((current) => [...current, { kind: 'sticker', url: sticker.url, fileName: sticker.label }].slice(0, 4))}
                  className="overflow-hidden rounded-[14px] border border-white/10 bg-white/5"
                >
                  <img src={sticker.url} alt={sticker.label} className="h-[72px] w-[72px] object-cover" />
                </button>
              ))}
            </div>
          ) : null}

          {uploading ? <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/52">Subiendo imagen...</div> : null}

          {showVoiceControls ? (
            <div className="mt-2 flex items-center gap-1.5">
              {canToggleVoice ? (
                <button
                  type="button"
                  disabled={voiceBusy}
                  onClick={onToggleVoice}
                  className={`flex h-10 w-10 items-center justify-center rounded-[14px] border transition disabled:opacity-50 ${voiceEnabled ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]' : 'border-white/10 bg-white/5 text-white/55'}`}
                >
                  <VoicePowerIcon enabled={voiceEnabled} />
                </button>
              ) : null}

              {canJoinVoice ? (
                <button
                  type="button"
                  disabled={voiceJoinBusy}
                  onClick={onVoiceJoinAction}
                  className={`flex h-10 w-10 items-center justify-center rounded-[14px] border transition disabled:opacity-50 ${voiceJoined ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,.18)]' : voiceRequestPending ? 'border-amber-300/25 bg-amber-500/10 text-amber-100' : 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]'}`}
                >
                  <VoiceJoinIcon joined={voiceJoined} pending={voiceRequestPending} />
                </button>
              ) : null}

              <button
                type="button"
                disabled={!voiceEnabled || !voiceJoined}
                onClick={toggleMicMuted}
                className={`flex h-10 w-10 items-center justify-center rounded-[14px] border transition disabled:opacity-50 ${micMuted ? 'border-rose-300/25 bg-rose-500/10 text-rose-100' : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,.18)]'}`}
              >
                <MicStateIcon muted={micMuted} active={voiceEnabled} />
              </button>
            </div>
          ) : null}
        </div>
      ) : showVoiceControls ? (
        <div className="relative mt-auto border-t border-white/8 bg-[linear-gradient(180deg,rgba(9,12,23,.92),rgba(11,15,27,.98))] px-3 pb-3 pt-2">
          <div className="flex items-center gap-2">
            {canToggleVoice ? (
              <button
                type="button"
                disabled={voiceBusy}
                onClick={onToggleVoice}
                className={`flex h-12 w-12 items-center justify-center rounded-[16px] border transition disabled:opacity-50 ${voiceEnabled ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]' : 'border-white/10 bg-white/5 text-white/55'}`}
              >
                <VoicePowerIcon enabled={voiceEnabled} />
              </button>
            ) : null}

            {canJoinVoice ? (
              <button
                type="button"
                disabled={voiceJoinBusy}
                onClick={onVoiceJoinAction}
                className={`flex h-12 w-12 items-center justify-center rounded-[16px] border transition disabled:opacity-50 ${voiceJoined ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,.18)]' : voiceRequestPending ? 'border-amber-300/25 bg-amber-500/10 text-amber-100' : 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]'}`}
              >
                <VoiceJoinIcon joined={voiceJoined} pending={voiceRequestPending} />
              </button>
            ) : null}

            <button
              type="button"
              disabled={!voiceEnabled || !voiceJoined}
              onClick={toggleMicMuted}
              className={`flex h-12 w-12 items-center justify-center rounded-[16px] border transition disabled:opacity-50 ${micMuted ? 'border-rose-300/25 bg-rose-500/10 text-rose-100' : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,.18)]'}`}
            >
              <MicStateIcon muted={micMuted} active={voiceEnabled} />
            </button>
          </div>
        </div>
      ) : null}
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
    return <img src={resolvedUrl} alt={attachment.fileName ?? 'Sticker'} className="max-h-[172px] w-auto rounded-[18px] object-contain" />;
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

function VoiceJoinIcon({ joined, pending }: { joined: boolean; pending: boolean }) {
  if (pending) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="M12 8v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  if (joined) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="m9 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12H4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="m15 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h17" strokeLinecap="round" />
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
