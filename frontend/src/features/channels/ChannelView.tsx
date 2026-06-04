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

  const initialLoadRef = useRef(true);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: initialLoadRef.current ? 'auto' : 'smooth' });
    initialLoadRef.current = false;
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
    <div className={`relative flex h-full flex-col overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(12,15,28,.98),rgba(8,10,19,.99))] ${minimal ? 'max-h-full' : 'min-h-0 lg:min-h-[520px]'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_14%,rgba(83,240,255,.08),transparent_16%),radial-gradient(circle_at_78%_22%,rgba(236,94,255,.1),transparent_20%),radial-gradient(circle_at_52%_72%,rgba(84,114,255,.08),transparent_24%)]" />

      <div ref={listRef} className="relative flex-1 overflow-y-auto px-0 py-0">
        <div className="absolute inset-0 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(15,18,31,.94),rgba(8,10,19,.98))]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(78,241,255,.08),transparent_16%),radial-gradient(circle_at_76%_22%,rgba(229,88,255,.1),transparent_16%),radial-gradient(circle_at_52%_64%,rgba(99,123,255,.08),transparent_22%)]" />
          <div className="absolute left-[10%] top-[14%] h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(92,240,255,.1),transparent_62%)] blur-3xl" />
          <div className="absolute right-[4%] top-[12%] h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(236,94,255,.1),transparent_62%)] blur-3xl" />
        </div>

        <div className="relative flex min-h-full flex-col justify-end gap-2.5 px-3 pb-3 pt-3">
          {previewMessages.length === 0 ? (
            <div className="self-center rounded-full border border-white/10 bg-black/20 px-4 py-2 text-center text-sm text-white/46">
              Todavía no hay mensajes en este canal.
            </div>
          ) : previewMessages.map((message) => {
            if (!message.authorId) {
              return (
                <div key={`${message.id}-${message.createdAt}`} className="flex justify-center px-3 py-1.5">
                  <div className="max-w-[92%] rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-center text-[10px] font-semibold text-white/70 shadow-[0_8px_14px_rgba(0,0,0,.12)]">
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
              <div key={`${message.id}-${message.createdAt}`} className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex ${mine ? 'justify-end' : 'justify-start'} w-full max-w-[84%] items-center gap-2`}>
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
                      className={`relative overflow-hidden border px-3 py-2.5 shadow-[0_16px_24px_rgba(0,0,0,.18)] ${mine ? 'rounded-[24px] rounded-br-[10px] border-white/70 bg-[linear-gradient(180deg,rgba(68,74,90,.96),rgba(53,58,73,.96))] text-white' : 'rounded-[24px] rounded-bl-[10px] border-white/70 bg-[linear-gradient(180deg,rgba(68,74,90,.96),rgba(53,58,73,.96))] text-white'}`}
                      style={{ transform: `translateX(${offset}px)`, transition: swipingMessageId === message.id ? 'none' : 'transform 120ms ease-out', touchAction: 'pan-y' }}
                    >
                      <div className={`pointer-events-none absolute ${mine ? 'left-3 top-2' : 'right-3 top-2'} text-[9px] font-semibold uppercase tracking-[0.08em] text-[#edd8ff] transition ${offset > 24 ? 'opacity-90' : 'opacity-0'}`}>
                        Responder
                      </div>
                      <div className="min-w-0 text-left">
                        <div className={`grid min-w-0 grid-cols-[auto,minmax(0,1fr)] items-start gap-x-2 gap-y-1 ${mine ? 'justify-items-end' : 'justify-items-start'}`}>
                          <button
                            type="button"
                            className={`row-span-3 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#101521] text-[10px] font-black text-white/88 ${message.author?.id && !message.author?.isAnonymousProfile && onOpenProfile ? 'cursor-pointer' : ''}`}
                            onClick={(event) => {
                              if (!message.author?.id || message.author.isAnonymousProfile || !onOpenProfile) return;
                              event.stopPropagation();
                              onOpenProfile(message.author.id);
                            }}
                          >
                            {message.author?.avatarUrl ? <img src={resolveMediaUrl(message.author.avatarUrl)} alt={authorLabel} className="h-full w-full object-cover" /> : authorLabel.slice(0, 2).toUpperCase()}
                          </button>
                          <div className="min-w-0 w-full">
                            <div className={`flex min-w-0 items-center gap-1.5 ${mine ? 'justify-end' : ''}`}>
                              <div className="truncate text-[11px] font-bold text-white/92">{authorLabel}</div>
                              {authorRole && authorRole !== 'GROUP_MEMBER' ? <div className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.05em] ${authorRole === 'GROUP_ADMIN' ? 'border-cyan-200/30 bg-cyan-300/18 text-cyan-50' : 'border-fuchsia-200/30 bg-fuchsia-300/16 text-fuchsia-50'}`}>{authorRole === 'GROUP_ADMIN' ? 'Admin' : 'CoA'}</div> : null}
                            </div>
                            {message.parent ? (
                              <div className="mt-1 rounded-[14px] border border-white/15 bg-black/15 px-2.5 py-1.5 text-[10px] text-white/72">
                                <div className="truncate font-semibold text-white/88">{message.parent.author?.displayName ?? 'Mensaje'}</div>
                                <div className="truncate">{getReplyPreview(message.parent)}</div>
                              </div>
                            ) : null}
                            {message.content ? <div className="mt-1 text-[14px] leading-[1.22] whitespace-pre-wrap">{message.content}</div> : null}
                            {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                              <div className="mt-2 space-y-2">
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
              </div>
            );
          })}
        </div>
      </div>

      {showComposer ? (
        <div className="relative mt-auto border-t border-white/10 bg-[linear-gradient(180deg,rgba(8,10,20,.92),rgba(10,13,23,.99))] px-2.5 pb-3 pt-2.5">
          {replyingTo ? (
            <div className="mb-2 flex items-center gap-2 rounded-[16px] border border-fuchsia-200/18 bg-fuchsia-400/10 px-3 py-2 text-[10px] text-white/76">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[#f5dcff]">Respondiendo a {replyingTo.author?.displayName ?? 'mensaje'}</div>
                <div className="truncate">{getReplyPreview(replyingTo)}</div>
              </div>
              <button type="button" onClick={() => setReplyingTo(null)} className="text-[10px] font-semibold text-white/58">
                Cancelar
              </button>
            </div>
          ) : null}
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1 scroll-snap-x">
              {pendingAttachments.map((attachment, index) => (
                <div key={`${attachment.url ?? 'pending'}-${index}`} className="relative min-w-[88px] overflow-hidden rounded-[16px] border border-white/10 bg-white/5">
                  <img src={resolveAttachmentRenderUrl(attachment.url)} alt={attachment.fileName ?? 'Adjunto'} className="h-[88px] w-[88px] object-cover" />
                  <button type="button" onClick={() => removePendingAttachment(index)} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form onSubmit={send}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!voiceEnabled || !voiceJoined}
                onClick={toggleMicMuted}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-50 ${micMuted ? 'border-rose-300/18 bg-rose-500/[0.06] text-rose-100' : 'border-cyan-300/22 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]'}`}
              >
                <MicStateIcon muted={micMuted} active={voiceEnabled} />
              </button>
              <button type="button" onClick={() => { setEmojiOpen((current) => !current); setStickerOpen(false); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[18px] text-white/82">
                🙂
              </button>
              <button type="button" onClick={() => { setStickerOpen((current) => !current); setEmojiOpen(false); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/82">
                <SparkleMiniIcon />
              </button>
              <div className="flex min-w-0 flex-1 items-center rounded-full border border-white/10 bg-[linear-gradient(180deg,rgba(22,27,43,.92),rgba(16,20,33,.96))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
                <button type="button" onClick={() => imageInputRef.current?.click()} className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/52">
                  <AttachmentMiniIcon />
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Escribe un mensaje"
                  className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-[13px] text-white/88 placeholder:text-white/28"
                />
              </div>
              <button type="submit" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-fuchsia-200/24 bg-[radial-gradient(circle,rgba(186,112,255,.36),rgba(118,80,255,.16))] text-white shadow-[0_0_22px_rgba(197,118,255,.3)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
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
            <div className="mt-2 flex flex-wrap gap-2 rounded-[18px] border border-white/10 bg-white/[0.04] p-2">
              {QUICK_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setInput((current) => `${current}${emoji}`)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-sm">
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          {stickerOpen ? (
            <div className="mt-2 flex gap-2 overflow-x-auto rounded-[18px] border border-white/10 bg-white/[0.04] p-2 scroll-snap-x">
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
