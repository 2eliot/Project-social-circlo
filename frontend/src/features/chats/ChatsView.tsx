'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { useAuth } from '@/store/auth.store';
import { resolveMediaUrl } from '@/lib/media-url';

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
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

type ConversationSummary = {
  id: string;
  createdAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  pendingForMe: boolean;
  canReply: boolean;
  canSendIntro: boolean;
  peer: { id: string; displayName: string; avatarUrl?: string | null };
  lastMessage?: {
    content: string;
    createdAt: string;
    authorId?: string;
    attachments?: DMAttachment[];
  } | null;
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

type MessageActionMenuState = {
  messageId: string;
  mine: boolean;
  side: 'left' | 'right';
  x: number;
  y: number;
};

type SubTab = 'chats' | 'grupos' | 'informacion' | 'solicitudes';

type GroupSummary = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  memberCount: number;
  myRole: string;
  owner: { id: string; displayName: string; avatarUrl?: string | null };
};

/* ------------------------------------------------------------------ */
/*  Avatar con borde y punto verde                                     */
/* ------------------------------------------------------------------ */

function OnlineAvatar({
  displayName,
  avatarUrl,
  size = 48,
  online = false,
  ring = false,
}: {
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
  ring?: boolean;
}) {
  const initials = (displayName ?? '?').slice(0, 2).toUpperCase();
  const borderRadius = Math.round(size * 0.34);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={`flex h-full w-full items-center justify-center overflow-hidden bg-[#0e1126] text-white/90 ${
          ring ? 'ring-2 ring-[#3b228e] ring-offset-2 ring-offset-[#060713]' : ''
        }`}
        style={{ borderRadius }}
      >
        {avatarUrl ? (
          <img
            src={resolveMediaUrl(avatarUrl)}
            alt={displayName ?? 'Avatar'}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-semibold tracking-[0.06em]" style={{ fontSize: Math.max(12, Math.round(size * 0.32)) }}>
            {initials}
          </span>
        )}
      </div>
      <span
        className={`absolute bottom-0 right-0 rounded-full border-2 border-[#060713] ${
          online ? 'bg-[#2ecc71]' : 'bg-[#727693]'
        }`}
        style={{ width: Math.round(size * 0.28), height: Math.round(size * 0.28) }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Formateo de hora                                                   */
/* ------------------------------------------------------------------ */

function formatHora(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatShortTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function getReplyPreview(message?: Pick<DMMessage, 'content' | 'attachments'> | null) {
  if (!message) return 'Mensaje';
  if (message.content?.trim()) return message.content;
  if (message.attachments?.some((a) => a.kind === 'image')) return '🖼 Imagen';
  if (message.attachments?.some((a) => a.kind === 'voice')) return '🎤 Nota de voz';
  return 'Mensaje';
}

function resolveAttachmentUrl(url: string) {
  return resolveMediaUrl(url);
}

function formatVoiceDuration(totalSeconds: number) {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getSupportedVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

function getVoiceFileExtension(mimeType?: string) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function getVoiceRecordingErrorMessage(err: unknown) {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'No diste permiso al micrófono. Revisa el permiso del navegador para localhost.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'No se encontró ningún micrófono disponible.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'El micrófono está siendo usado por otra aplicación.';
    }
    if (err.name === 'NotSupportedError') {
      return 'Tu navegador no pudo iniciar la grabación con un formato compatible.';
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'No se pudo iniciar la grabación.';
}

async function uploadDmAttachment(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ attachment: DMAttachment | null }>('/dm/upload', {
    method: 'POST',
    body: formData,
  });
  return result.attachment;
}

function getConversationPreview(lastMessage?: ConversationSummary['lastMessage']) {
  if (!lastMessage) return '';
  if (lastMessage.content?.trim()) return lastMessage.content;
  const attachments = lastMessage.attachments ?? [];
  if (attachments.some((a) => a.kind === 'image')) return '🖼 Imagen';
  if (attachments.some((a) => a.kind === 'voice')) return '🎤 Nota de voz';
  return '';
}

/* ------------------------------------------------------------------ */
/*  Props del componente principal                                     */
/* ------------------------------------------------------------------ */

interface ChatsViewProps {
  selectedConversationId: string | null;
  refreshToken: number;
  onSelectConversation: (id: string | null) => void;
  onOpenProfile: (userId: string) => void;
  onConversationChanged: () => void;
}

/* ================================================================== */
/*  COMPONENTE PRINCIPAL                                               */
/* ================================================================== */

export default function ChatsView({
  selectedConversationId,
  refreshToken,
  onSelectConversation,
  onOpenProfile,
  onConversationChanged,
}: ChatsViewProps) {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('chats');
  const [dms, setDms] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [onlineFriends, setOnlineFriends] = useState<
    { id: string; displayName: string; avatarUrl?: string | null }[]
  >([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadConversations, setUnreadConversations] = useState<Set<string>>(new Set());

  /* ---- Cargar conversaciones ---- */
  async function loadConversations() {
    setLoadingList(true);
    try {
      const rows = await api<ConversationSummary[]>('/dm');
      const sorted = rows.slice().sort((a, b) => {
        const ta = a.lastMessage?.createdAt
          ? new Date(a.lastMessage.createdAt).getTime()
          : new Date(a.createdAt).getTime();
        const tb = b.lastMessage?.createdAt
          ? new Date(b.lastMessage.createdAt).getTime()
          : new Date(b.createdAt).getTime();
        return tb - ta;
      });
      setDms(sorted);
    } catch {
      setDms([]);
    } finally {
      setLoadingList(false);
    }
  }

  /* ---- Cargar amigos online (mutuos + conectados vía Redis) ---- */
  async function loadOnlineFriends() {
    try {
      const friends = await api<
        { id: string; displayName: string; avatarUrl?: string | null; online: boolean }[]
      >('/users/me/online-friends');
      setOnlineFriends(friends);
      setOnlineCount(friends.length);
    } catch {
      setOnlineFriends([]);
      setOnlineCount(0);
    }
  }

  /* ---- Cargar grupos del usuario ---- */
  async function loadMyGroups() {
    setLoadingGroups(true);
    try {
      const data = await api<{ mine: GroupSummary[]; public: GroupSummary[] }>('/groups');
      setMyGroups(data.mine ?? []);
    } catch {
      setMyGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }

  /* ---- Contar solicitudes pendientes ---- */
  useEffect(() => {
    setPendingCount(dms.filter((d) => d.status === 'PENDING' && d.pendingForMe).length);
  }, [dms]);

  useEffect(() => {
    void loadConversations();
  }, [refreshToken]);

  useEffect(() => {
    if (user?.id) void loadOnlineFriends();
  }, [user?.id]);

  useEffect(() => {
    if (user?.id && subTab === 'grupos') void loadMyGroups();
  }, [user?.id, subTab]);

  /* ---- Presencia en tiempo real ---- */
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket('/presence');
    const onPresence = (payload: { userId: string; online: boolean }) => {
      // Refrescar la lista completa cuando cambia presencia
      void loadOnlineFriends();
    };
    socket.on('presence', onPresence);
    return () => {
      socket.off('presence', onPresence);
    };
  }, [user?.id]);

  /* ---- Escuchar mensajes nuevos en tiempo real (silencioso) ---- */
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket('/social');
    const onDmMessage = (payload: {
      conversationId: string;
      authorId: string;
      content?: string | null;
      createdAt?: string;
      attachments?: DMAttachment[];
    }) => {
      if (!payload || payload.authorId === user.id) return;
      /* Actualizar el lastMessage de la conversación sin recargar toda la lista */
      setDms((current) => {
        const updated = current.map((d) =>
          d.id === payload.conversationId
            ? {
                ...d,
                lastMessage: {
                  content: payload.content ?? '',
                  createdAt: payload.createdAt ?? new Date().toISOString(),
                  authorId: payload.authorId,
                  attachments: payload.attachments,
                },
              }
            : d,
        );
        return updated.slice().sort((a, b) => {
          const ta = a.lastMessage?.createdAt
            ? new Date(a.lastMessage.createdAt).getTime()
            : new Date(a.createdAt).getTime();
          const tb = b.lastMessage?.createdAt
            ? new Date(b.lastMessage.createdAt).getTime()
            : new Date(b.createdAt).getTime();
          return tb - ta;
        });
      });
      setUnreadConversations((prev) => {
        const next = new Set(prev);
        next.add(payload.conversationId);
        return next;
      });
    };
    socket.on('dm_message_new', onDmMessage);
    return () => {
      socket.off('dm_message_new', onDmMessage);
    };
  }, [user?.id]);

  /* ---- Set de IDs de usuarios online ---- */
  const onlineIds = new Set(onlineFriends.map((f) => f.id));

  /* ---- Filtrar según subtab ---- */
  const filteredDms = dms.filter((d) => {
    if (subTab === 'solicitudes') return d.status === 'PENDING';
    if (subTab === 'chats') return d.status === 'ACCEPTED';
    return true;
  });

  /* ---- Obtener la hora actual para el saludo ---- */
  const [greeting, setGreeting] = useState('');
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting('Buenos días');
    else if (hour >= 12 && hour < 19) setGreeting('Buenas tardes');
    else setGreeting('Buenas noches');
  }, []);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */
  return (
    <div className="px-4 pb-4">
      {/* ===== STICKY: amigos + tabs siempre visibles ===== */}
      <div className="sticky top-0 z-20 bg-[#060713] -mx-4 px-4 pb-1 shadow-[0_4px_12px_rgba(6,7,19,.8)]">
      {/* ============ ENCABEZADO ============ */}
      <header className="mb-3 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold leading-tight text-white">
            {greeting},{' '}
            <span className="text-[#3b228e]">{user?.displayName ?? 'Usuario'}</span>
            <span className="ml-1">👋</span>
          </h1>
          <p className="mt-1 text-sm text-[#727693]">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2ecc71]" />
            {onlineCount} amigo{onlineCount !== 1 ? 's' : ''} en línea
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0e1126] text-[#727693] transition hover:bg-[#1a1f3a] hover:text-white"
            aria-label="Añadir amigo"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="7" r="4" />
              <path d="M19 8v6M16 11h6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0e1126] text-[#727693] transition hover:bg-[#1a1f3a] hover:text-white"
            aria-label="Buscar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* ============ AMIGOS ACTIVOS (scroll horizontal) ============ */}
      <section className="mb-2">
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none scroll-snap-x">
          {onlineFriends.slice(0, 8).map((friend) => (
            <button
              key={friend.id}
              onClick={() => onOpenProfile(friend.id)}
              className="relative flex shrink-0 flex-col items-center gap-1.5"
            >
              <div className="rounded-2xl bg-gradient-to-b from-[#3b228e] to-[#6b3fa0] p-[3px]">
                <div className="relative rounded-[calc(1rem-3px)] overflow-hidden bg-[#060713]">
                  <OnlineAvatar
                    displayName={friend.displayName}
                    avatarUrl={friend.avatarUrl}
                    size={80}
                    online={true}
                    ring={false}
                  />
                </div>
              </div>
              <span className="max-w-[72px] truncate text-[12px] text-[#727693]">
                {friend.displayName}
              </span>
            </button>
          ))}
          <button
            onClick={() => void loadOnlineFriends()}
            className="flex shrink-0 flex-col items-center justify-center gap-1.5"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0e1126] text-[#727693] transition hover:bg-[#1a1f3a] hover:text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[11px] text-[#727693]">Ver todos</span>
          </button>
        </div>
      </section>

      {/* ============ BARRA DE PESTAÑAS (Sub-header) ============ */}
      <section className="mb-0">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none scroll-snap-x">
          <TabButton
            active={subTab === 'chats'}
            onClick={() => setSubTab('chats')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M21 12a8 8 0 11-3.6-6.7L21 4l-1.3 3.6A8 8 0 0121 12z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label="Chats"
            count={dms.filter((d) => d.status === 'ACCEPTED').length}
          />
          <TabButton
            active={subTab === 'grupos'}
            onClick={() => setSubTab('grupos')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <circle cx="9" cy="9" r="3.5" />
                <circle cx="17" cy="10" r="2.5" />
                <path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 19c0-2 2-4 4-4s2.5 1.5 2.5 3" strokeLinecap="round" />
              </svg>
            }
            label="Grupos"
          />
          <TabButton
            active={subTab === 'informacion'}
            onClick={() => setSubTab('informacion')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" />
              </svg>
            }
            label="Información"
          />
          <TabButton
            active={subTab === 'solicitudes'}
            onClick={() => setSubTab('solicitudes')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="7" r="4" />
                <path d="M19 8v6M16 11h6" strokeLinecap="round" />
              </svg>
            }
            label="Solicitudes"
            count={pendingCount}
            danger={pendingCount > 0}
          />
        </div>
      </section>
      </div>

      {/* ============ LISTA DE CHATS ============ */}
      <section>
        {loadingList ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b228e] border-t-transparent" />
          </div>
        ) : subTab === 'grupos' ? (
          <GroupsList
            groups={myGroups}
            loading={loadingGroups}
            onRefresh={() => void loadMyGroups()}
          />
        ) : subTab === 'informacion' ? (
          <AppInfo />
        ) : filteredDms.length === 0 ? (
          <div className="mt-8 text-center text-sm text-[#727693]">
            {subTab === 'solicitudes'
              ? 'No tienes solicitudes pendientes.'
              : 'Todavía no tienes conversaciones.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDms.map((dm) => (
              <ChatCard
                key={dm.id}
                conversation={dm}
                online={onlineIds.has(dm.peer.id)}
                unread={unreadConversations.has(dm.id)}
                onSelect={() => {
                  setUnreadConversations((prev) => {
                    const next = new Set(prev);
                    next.delete(dm.id);
                    return next;
                  });
                  onSelectConversation(dm.id);
                }}
                onOpenProfile={() => onOpenProfile(dm.peer.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ================================================================== */
/*  BOTÓN DE PESTAÑA                                                   */
/* ================================================================== */

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-all ${
        active
          ? 'bg-[#3b228e] text-white'
          : 'bg-[#0e1126] text-[#727693] hover:bg-[#1a1f3a] hover:text-white'
      }`}
    >
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`ml-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-semibold ${
            danger
              ? 'bg-red-500/90 text-white'
              : active
                ? 'bg-white/20 text-white'
                : 'bg-[#3b228e]/30 text-[#3b228e]'
          }`}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

/* ================================================================== */
/*  TARJETA DE CHAT                                                    */
/* ================================================================== */

function ChatCard({
  conversation,
  online = false,
  unread = false,
  onSelect,
  onOpenProfile,
}: {
  conversation: ConversationSummary;
  online?: boolean;
  unread?: boolean;
  onSelect: () => void;
  onOpenProfile: () => void;
}) {
  const { peer, lastMessage, status, pendingForMe } = conversation;
  const preview = getConversationPreview(lastMessage);
  const time = formatHora(lastMessage?.createdAt ?? conversation.createdAt);

  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-4 rounded-2xl p-4 transition hover:bg-[#1a1f3a] active:scale-[0.98] ${
        unread ? 'bg-[#1a1040] ring-1 ring-[#3b228e]/50' : 'bg-[#0e1126]'
      }`}
    >
      {/* Avatar */}
      <button onClick={(e) => { e.stopPropagation(); onOpenProfile(); }} className="shrink-0">
        <OnlineAvatar
          displayName={peer.displayName}
          avatarUrl={peer.avatarUrl}
          size={52}
          online={online}
        />
      </button>

      {/* Info central — ocupa el espacio flexible */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[15px] font-semibold ${unread ? 'text-white' : 'text-white'}`}>
            {peer.displayName ?? 'Anónimo'}
          </span>
          {unread && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#7c5cff] shadow-[0_0_6px_#7c5cff]" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {status === 'PENDING' ? (
            <span className="truncate text-[13px] text-[#f59e0b]">
              {pendingForMe
                ? '✉️ Solicitud de chat'
                : '⏳ Esperando respuesta'}
            </span>
          ) : status === 'REJECTED' ? (
            <span className="truncate text-[13px] text-red-400">Solicitud rechazada</span>
          ) : (
            <span className={`truncate text-[13px] ${unread ? 'font-medium text-white/90' : 'text-[#727693]'}`}>
              {preview || 'Conversación activa'}
            </span>
          )}
        </div>
      </div>

      {/* Hora + Botón Chat — columna derecha */}
      <div className="relative flex shrink-0 flex-col items-end gap-2">
        <span className="text-[11px] text-[#727693]">{time}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="rounded-full bg-[#3b228e] px-5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#4a2da8] active:scale-95"
        >
          Chat
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  LISTA DE GRUPOS                                                    */
/* ================================================================== */

function GroupsList({
  groups,
  loading,
  onRefresh,
}: {
  groups: GroupSummary[];
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b228e] border-t-transparent" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="mt-8 text-center text-sm text-[#727693]">
        <p>No estás en ningún grupo todavía.</p>
        <button
          onClick={onRefresh}
          className="mt-3 rounded-full bg-[#3b228e] px-5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#4a2da8]"
        >
          Actualizar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.id}
          className="flex cursor-pointer items-center gap-4 rounded-2xl bg-[#0e1126] p-4 transition hover:bg-[#1a1f3a] active:scale-[0.98]"
        >
          {/* Icono del grupo */}
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#1a1f3a]">
            {group.iconUrl ? (
              <img
                src={resolveMediaUrl(group.iconUrl)}
                alt={group.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-lg font-bold text-[#3b228e]">
                {group.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <span className="truncate text-[15px] font-semibold text-white">
              {group.name}
            </span>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="truncate text-[13px] text-[#727693]">
                {group.memberCount} miembro{group.memberCount !== 1 ? 's' : ''}
              </span>
              {group.description && (
                <>
                  <span className="text-[#3b228e]">·</span>
                  <span className="truncate text-[13px] text-[#727693]">
                    {group.description}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Rol */}
          <div className="shrink-0">
            <span className="rounded-full bg-[#3b228e]/20 px-3 py-1 text-[11px] font-medium text-[#3b228e]">
              {group.myRole === 'GROUP_ADMIN'
                ? 'Admin'
                : group.myRole === 'GROUP_MODERATOR'
                  ? 'Mod'
                  : 'Miembro'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  INFORMACIÓN DE LA APP                                              */
/* ================================================================== */

function AppInfo() {
  return (
    <div className="space-y-4">
      {/* Tarjeta principal */}
      <div className="rounded-2xl bg-[#0e1126] p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#3b228e]">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" width="24" height="24">
              <path d="M21 12a8 8 0 11-3.6-6.7L21 4l-1.3 3.6A8 8 0 0121 12z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">AppChat</h2>
            <p className="text-[13px] text-[#727693]">v1.0.0</p>
          </div>
        </div>
        <p className="text-[14px] leading-relaxed text-[#a0a3b5]">
          AppChat es una plataforma de mensajería y comunicación en tiempo real.
          Conéctate con tus amigos, crea grupos, comparte imágenes y notas de voz,
          y disfruta de una experiencia de chat moderna y segura.
        </p>
      </div>

      {/* Características */}
      <div className="rounded-2xl bg-[#0e1126] p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Características</h3>
        <div className="space-y-3">
          {[
            { icon: '💬', label: 'Mensajes directos', desc: 'Chat privado con otros usuarios' },
            { icon: '👥', label: 'Grupos', desc: 'Crea y únete a grupos por intereses' },
            { icon: '🎤', label: 'Notas de voz', desc: 'Graba y envía mensajes de voz' },
            { icon: '🖼', label: 'Compartir imágenes', desc: 'Envía fotos y archivos' },
            { icon: '🔒', label: 'Cifrado', desc: 'Tus conversaciones están protegidas' },
          ].map((feat) => (
            <div key={feat.label} className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">{feat.icon}</span>
              <div>
                <span className="text-[14px] font-medium text-white">{feat.label}</span>
                <p className="text-[12px] text-[#727693]">{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contacto */}
      <div className="rounded-2xl bg-[#0e1126] p-5">
        <h3 className="mb-2 text-sm font-semibold text-white">Contacto</h3>
        <p className="text-[13px] text-[#727693]">
          Para soporte o sugerencias, contacta a los administradores.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  VOICE NOTE                                                         */
/* ================================================================== */

function VoiceNote({ attachment, src }: { attachment: DMAttachment; src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTime = () => {
      if (!audio.duration) { setProgress(0); return; }
      setProgress(audio.currentTime / audio.duration);
    };
    const onEnded = () => { setIsPlaying(false); setProgress(0); audio.currentTime = 0; };
    const onPause = () => setIsPlaying(false);
    const onPlay = () => { audio.volume = 1; setIsPlaying(true); };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, []);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) { await audio.play(); }
      else { audio.pause(); }
    } catch {
      audio.load();
      await audio.play().catch(() => undefined);
    }
  }

  return (
    <div className="bg-transparent px-0 py-0 min-w-[220px] max-w-[260px]" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} preload="metadata">
        <source src={src} type={attachment.mimeType ?? 'audio/webm'} />
      </audio>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void togglePlay()} className="h-10 w-10 rounded-full bg-white text-[#111722] flex items-center justify-center shrink-0">
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <rect x="7" y="6" width="3.5" height="12" rx="1" />
              <rect x="13.5" y="6" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M8 6v12l10-6-10-6z" />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 h-6">
            {Array.from({ length: 22 }).map((_, i) => {
              const threshold = (i + 1) / 22;
              const active = progress >= threshold;
              const height = 8 + ((i * 7) % 16);
              return <span key={i} className={active ? 'w-1 rounded-full bg-[#7c5cff]' : 'w-1 rounded-full bg-white/20'} style={{ height }} />;
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-white/55 mt-1">
            <span>{formatVoiceDuration(progress > 0 && duration ? progress * duration : duration)}</span>
            <span>Nota de voz</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ATTACHMENT PREVIEW                                                 */
/* ================================================================== */

function AttachmentPreview({ attachment, onOpenImage }: { attachment: DMAttachment; onOpenImage?: (url: string) => void }) {
  const src = resolveAttachmentUrl(attachment.url);
  if (attachment.kind === 'image') {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpenImage?.(src); }} className="block w-full text-left">
        <img src={src} alt={attachment.fileName ?? 'Imagen del chat'} className="w-full max-h-60 object-cover rounded-[14px]" />
      </button>
    );
  }
  return <VoiceNote attachment={attachment} src={src} />;
}
