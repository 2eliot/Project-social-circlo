'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api-client';
import { normalizeMediaUrl, resolveMediaUrl } from '@/lib/media-url';
import { getSocket } from '@/lib/socket-client';
import { useAuth } from '@/store/auth.store';

type Tab = 'feed' | 'chats' | 'groups' | 'profile';

type GroupPrivacy = 'PUBLIC_INVITE' | 'PRIVATE' | 'SECRET';

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

type MessageActionMenuState = {
  messageId: string;
  mine: boolean;
  side: 'left' | 'right';
  x: number;
  y: number;
};

type UserSearchResult = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  followersCount: number;
  badges?: string[];
};

type ProfileRelationshipUser = {
  id: string;
  displayName: string;
  profilePath?: string;
  avatarUrl?: string | null;
  badges?: string[];
};

type UserProfile = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  globalRole: string;
  badges?: string[];
  followsYou: boolean;
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
};

type Group = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  privacy?: GroupPrivacy;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  ownerId: string;
  owner?: { id: string; displayName: string; avatarUrl?: string | null };
  memberCount?: number;
  bannedCount?: number;
  moderatorsCount?: number;
  currentUserRole?: 'GROUP_ADMIN' | 'GROUP_MODERATOR' | 'GROUP_MEMBER' | null;
  channelSummary?: {
    total: number;
    text: number;
    voice: number;
    video: number;
  };
};

type GroupsResponse = {
  mine: Group[];
  public: Group[];
};

type FeedPost = {
  id: string;
  authorId: string;
  content: string | null;
  createdAt: string;
  attachments: DMAttachment[];
  likedByMe: boolean;
  likeCount: number;
  comments: FeedComment[];
  author: { id: string; displayName: string; avatarUrl?: string | null; globalRole?: string; isVerifiedModerator?: boolean; badges?: string[] };
};

type FeedComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt?: string;
};

type FeedPostDeletedEvent = {
  id: string;
};

type LiveDmNotice = {
  conversationId: string;
  authorDisplayName: string;
  authorAvatarUrl?: string | null;
  preview: string;
};

type NotificationItem = {
  id: string;
  kind: 'POST_LIKED' | 'POST_COMMENTED';
  title: string;
  body: string;
  postId: string | null;
  isRead: boolean;
  createdAt: string;
  actor: {
    id: string | null;
    displayName: string;
    avatarUrl?: string | null;
    globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
    isVerifiedModerator: boolean;
  } | null;
};

type LiveInteractionNotice = {
  id: string;
  title: string;
  body: string;
  actorDisplayName: string;
  actorAvatarUrl?: string | null;
};

const POST_CONTENT_MAX_LENGTH = 120;

function UserAvatar({
  displayName,
  avatarUrl,
  size = 56,
  className = '',
  onClick,
}: {
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const initials = (displayName ?? '?').slice(0, 2).toUpperCase();

  return (
    <div
      className={`shrink-0 overflow-hidden flex items-center justify-center bg-[#101521] border border-white/10 text-white/90 ${className}`.trim()}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.34), fontSize: Math.max(14, Math.round(size * 0.32)) }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(event as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? `Abrir perfil de ${displayName ?? 'usuario'}` : undefined}
    >
      {avatarUrl ? (
        <img src={resolveAttachmentUrl(avatarUrl)} alt={displayName ?? 'Avatar'} className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold tracking-[0.06em]">{initials}</span>
      )}
    </div>
  );
}

function getBadgeLabels(input?: { globalRole?: string | null; isVerifiedModerator?: boolean | null; badges?: string[] | null }) {
  if (input?.badges?.length) return input.badges;
  const badges: string[] = [];
  if (input?.globalRole === 'SUPER_ADMIN') badges.push('Admin');
  if (input?.globalRole === 'GLOBAL_MODERATOR' || input?.isVerifiedModerator) badges.push('Moderador');
  return badges;
}

function BadgeRow({ badges }: { badges?: string[] | null }) {
  if (!badges?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span key={badge} className="rounded-full border border-[#f4d58d]/20 bg-[#f4d58d]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#ffe7ad]">
          {badge}
        </span>
      ))}
    </div>
  );
}

export default function AppHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((state) => state.user);
  const [tab, setTab] = useState<Tab>('feed');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationRefreshToken, setConversationRefreshToken] = useState(0);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [pendingChatsCount, setPendingChatsCount] = useState(0);
  const [liveDmNotice, setLiveDmNotice] = useState<LiveDmNotice | null>(null);
  const [liveInteractionNotice, setLiveInteractionNotice] = useState<LiveInteractionNotice | null>(null);

  async function refreshPendingChatsCount() {
    try {
      const rows = await api<ConversationSummary[]>('/dm');
      setPendingChatsCount(rows.filter((row) => row.pendingForMe).length);
    } catch {
      setPendingChatsCount(0);
    }
  }

  useEffect(() => {
    void refreshPendingChatsCount();
  }, []);

  useEffect(() => {
    const nextProfileUserId = searchParams.get('profileUserId');
    if (nextProfileUserId) {
      setProfileUserId(nextProfileUserId);
      setTab('profile');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket('/social');
    const onDmMessage = (payload: {
      conversationId: string;
      authorId: string;
      authorDisplayName?: string;
      authorAvatarUrl?: string | null;
      content?: string | null;
      attachments?: DMAttachment[];
    }) => {
      if (!payload || payload.authorId === user.id) return;
      setConversationRefreshToken((current) => current + 1);
      void refreshPendingChatsCount();
      const preview = getConversationPreview({
        content: payload.content ?? '',
        createdAt: new Date().toISOString(),
        authorId: payload.authorId,
        attachments: payload.attachments,
      }) || 'Te llego un mensaje nuevo';
      setLiveDmNotice({
        conversationId: payload.conversationId,
        authorDisplayName: payload.authorDisplayName ?? 'Nuevo mensaje',
        authorAvatarUrl: payload.authorAvatarUrl ?? null,
        preview,
      });
    };

    const onNotification = (payload: NotificationItem) => {
      if (!payload?.id) return;
      setLiveInteractionNotice({
        id: payload.id,
        title: payload.title,
        body: payload.body,
        actorDisplayName: payload.actor?.displayName ?? 'Actividad',
        actorAvatarUrl: payload.actor?.avatarUrl ?? null,
      });
    };

    socket.on('dm_message_new', onDmMessage);
    socket.on('notification_new', onNotification);
    return () => {
      socket.off('dm_message_new', onDmMessage);
      socket.off('notification_new', onNotification);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!liveDmNotice) return;
    const timer = window.setTimeout(() => setLiveDmNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [liveDmNotice]);

  useEffect(() => {
    if (!liveInteractionNotice) return;
    const timer = window.setTimeout(() => setLiveInteractionNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [liveInteractionNotice]);

  function handleOpenProfile(userId: string) {
    setProfileUserId(userId);
    setTab('profile');
  }

  function handleSelectTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab === 'profile') {
      setProfileUserId(user?.id ?? null);
    }
  }

  function handleOpenConversation(conversationId: string) {
    setTab('chats');
    setSelectedConversationId(conversationId);
    setConversationRefreshToken((current) => current + 1);
    void refreshPendingChatsCount();
  }

  function handleConversationChanged() {
    setConversationRefreshToken((current) => current + 1);
    void refreshPendingChatsCount();
  }

  return (
    <div className="app-shell">
      {tab === 'feed' || tab === 'groups' ? <TopBar onOpenProfile={handleOpenProfile} currentTab={tab} /> : null}

      {liveDmNotice ? (
        <button
          type="button"
          className="mx-auto mt-3 flex w-[min(392px,calc(100%-42px))] items-center gap-3 rounded-[22px] border border-[#8fffe7]/16 bg-[rgba(18,24,34,.88)] px-3 py-3 text-left shadow-[0_16px_32px_rgba(0,0,0,.3)] backdrop-blur-[18px]"
          onClick={() => {
            handleOpenConversation(liveDmNotice.conversationId);
            setLiveDmNotice(null);
          }}
        >
          <UserAvatar displayName={liveDmNotice.authorDisplayName} avatarUrl={liveDmNotice.authorAvatarUrl} size={42} className="rounded-[14px]" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[#c9fff3]">{liveDmNotice.authorDisplayName}</div>
            <div className="truncate text-[12px] text-white/72">{liveDmNotice.preview}</div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9fffe8]">Chat</div>
        </button>
      ) : null}

      {liveInteractionNotice ? (
        <button
          type="button"
          className="mx-auto mt-3 flex w-[min(392px,calc(100%-42px))] items-center gap-3 rounded-[22px] border border-[#ffe08c]/16 bg-[rgba(28,24,18,.88)] px-3 py-3 text-left shadow-[0_16px_32px_rgba(0,0,0,.3)] backdrop-blur-[18px]"
          onClick={() => {
            setTab('feed');
            setLiveInteractionNotice(null);
          }}
        >
          <UserAvatar displayName={liveInteractionNotice.actorDisplayName} avatarUrl={liveInteractionNotice.actorAvatarUrl} size={42} className="rounded-[14px]" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[#ffe9b6]">{liveInteractionNotice.title}</div>
            <div className="truncate text-[12px] text-white/72">{liveInteractionNotice.body}</div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffe09a]">Feed</div>
        </button>
      ) : null}

      <main className="app-content">
        {tab === 'feed' ? <FeedTab onOpenProfile={handleOpenProfile} /> : null}
        {tab === 'chats' ? (
          <ChatsTab
            selectedConversationId={selectedConversationId}
            refreshToken={conversationRefreshToken}
            onSelectConversation={setSelectedConversationId}
            onOpenProfile={handleOpenProfile}
            onConversationChanged={handleConversationChanged}
          />
        ) : null}
        {tab === 'groups' ? <GroupsTab /> : null}
        {tab === 'profile' ? <ProfileTab viewedUserId={profileUserId} onOpenChats={() => setTab('chats')} onOpenConversation={handleOpenConversation} onRelationshipChanged={() => void refreshPendingChatsCount()} onOpenProfile={handleOpenProfile} /> : null}
      </main>

      <BottomNav tab={tab} setTab={handleSelectTab} pendingChatsCount={pendingChatsCount} />
    </div>
  );
}

function TopBar({ onOpenProfile, currentTab }: { onOpenProfile: (userId: string) => void; currentTab: Tab }) {
  const user = useAuth((state) => state.user);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [groupResults, setGroupResults] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const canSearch = currentTab === 'feed' || currentTab === 'groups';

  async function loadNotifications() {
    try {
      const rows = await api<NotificationItem[]>('/notifications?limit=20');
      setNotifications(rows);
    } catch {
      setNotifications([]);
    }
  }

  async function loadUnreadCount() {
    try {
      const payload = await api<{ count: number }>('/notifications/unread-count');
      setUnreadNotifications(payload.count);
    } catch {
      setUnreadNotifications(0);
    }
  }

  useEffect(() => {
    if (canSearch) return;
    setOpen(false);
    setQuery('');
    setResults([]);
    setGroupResults([]);
    setLoading(false);
    setError(null);
  }, [canSearch]);

  useEffect(() => {
    void loadUnreadCount();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket('/social');
    const onNotification = (payload: NotificationItem) => {
      setUnreadNotifications((current) => current + (payload.isRead ? 0 : 1));
      setNotifications((current) => [payload, ...current.filter((row) => row.id !== payload.id)].slice(0, 20));
    };
    socket.on('notification_new', onNotification);
    return () => {
      socket.off('notification_new', onNotification);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!open || !canSearch) return;
    const raw = currentTab === 'groups' ? query.trim() : query.trim().replace(/^@+/, '');
    if (!raw) {
      setResults([]);
      setGroupResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const handle = setTimeout(() => {
      if (currentTab === 'groups') {
        api<GroupsResponse>('/groups')
          .then((payload) => {
            const normalized = raw.toLowerCase();
            setGroupResults([...payload.mine, ...payload.public].filter((group) => group.name.toLowerCase().includes(normalized)));
            setResults([]);
          })
          .catch(() => setError('No se pudo buscar grupos.'))
          .finally(() => setLoading(false));
        return;
      }

      api<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(raw)}`)
        .then((rows) => {
          setResults(rows);
          setGroupResults([]);
        })
        .catch(() => setError('No se pudo buscar.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [canSearch, query, open, currentTab]);

  function resetSearch() {
    setOpen(false);
    setQuery('');
    setResults([]);
    setGroupResults([]);
    setError(null);
  }

  function openProfile(userId: string) {
    resetSearch();
    onOpenProfile(userId);
  }

  function openGroup(groupId: string) {
    resetSearch();
    router.push(`/app/groups/${groupId}`);
  }

  async function toggleNotifications() {
    const next = !notificationsOpen;
    setNotificationsOpen(next);
    if (next) {
      await loadNotifications();
    }
  }

  async function markNotificationRead(notificationId: string) {
    setNotifications((current) => current.map((item) => (item.id === notificationId ? { ...item, isRead: true } : item)));
    setUnreadNotifications((current) => Math.max(0, current - 1));
    try {
      await api(`/notifications/${notificationId}/read`, { method: 'POST' });
    } catch {}
  }

  async function markAllNotificationsRead() {
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadNotifications(0);
    try {
      await api('/notifications/read-all', { method: 'POST' });
    } catch {}
  }

  return (
    <header className="app-topbar" style={{ position: 'relative' }}>
      <button
        type="button"
        className="shrink-0"
        aria-label="Abrir mi perfil"
        onClick={() => {
          if (user?.id) onOpenProfile(user.id);
        }}
      >
        <UserAvatar displayName={user?.displayName ?? user?.email} avatarUrl={user?.avatarUrl} size={40} className="rounded-[14px] shadow-[0_0_18px_rgba(124,92,255,.22)]" />
      </button>
      {open && canSearch ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={currentTab === 'groups' ? 'Buscar grupos por nombre' : '@nick para iniciar un chat'}
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm outline-none focus:border-white/30"
          />
          <button className="icon-btn" aria-label="Cerrar buscador" onClick={resetSearch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : canSearch ? (
        <div className="flex gap-2 ml-auto">
          <button className="icon-btn relative" aria-label="Notificaciones" onClick={() => void toggleNotifications()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
              <path d="M12 4a4 4 0 00-4 4v2.4c0 .72-.2 1.42-.58 2.03L6 15h12l-1.42-2.57a4.04 4.04 0 01-.58-2.03V8a4 4 0 00-4-4z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 18a2 2 0 004 0" strokeLinecap="round" />
            </svg>
            {unreadNotifications > 0 ? <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#ff8a5b] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{Math.min(99, unreadNotifications)}</span> : null}
          </button>
          <button className="icon-btn" aria-label="Buscar" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="ml-auto h-11 w-11" />
      )}

      {notificationsOpen ? (
        <div className="absolute right-3 top-full mt-2 z-50 w-[min(390px,calc(100vw-24px))] rounded-2xl border border-white/10 bg-[#101725]/95 p-2 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="text-sm font-semibold text-white/90">Notificaciones</div>
            <button className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55 hover:text-white" onClick={() => void markAllNotificationsRead()}>
              Marcar todo
            </button>
          </div>
          {notifications.length === 0 ? <div className="px-3 py-6 text-sm text-white/55">Todavía no tienes notificaciones.</div> : null}
          {notifications.map((notification) => (
            <button
              key={notification.id}
              className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left hover:bg-white/5 ${notification.isRead ? 'opacity-75' : ''}`}
              onClick={() => void markNotificationRead(notification.id)}
            >
              <UserAvatar
                displayName={notification.actor?.displayName ?? 'Actividad'}
                avatarUrl={notification.actor?.avatarUrl}
                size={38}
                className="rounded-[12px]"
                onClick={notification.actor?.id ? (event) => {
                  event.stopPropagation();
                  onOpenProfile(notification.actor!.id!);
                } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-semibold text-white/90">{notification.title}</div>
                  {!notification.isRead ? <span className="h-2.5 w-2.5 rounded-full bg-[#ff8a5b]" /> : null}
                </div>
                <div className="mt-1 text-xs text-white/62">{notification.body}</div>
                <div className="mt-2 flex items-center gap-2">
                  <BadgeRow badges={getBadgeLabels(notification.actor ?? undefined)} />
                  <div className="text-[11px] text-white/38">{formatShortTime(notification.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {open && canSearch ? (
        <div className="absolute left-3 right-3 top-full mt-2 z-50 rounded-2xl border border-white/10 bg-[#101725]/95 backdrop-blur shadow-2xl overflow-hidden">
          {loading ? <div className="px-4 py-3 text-sm opacity-70">Buscando...</div> : null}
          {!loading && error ? <div className="px-4 py-3 text-sm text-red-400">{error}</div> : null}
          {!loading && !error && (currentTab === 'groups' ? query.trim().length === 0 : query.trim().replace(/^@+/, '').length === 0) ? (
            <div className="px-4 py-3 text-sm opacity-70">{currentTab === 'groups' ? 'Escribe el nombre del grupo para encontrarlo.' : <>Escribe <span className="opacity-100">@nombre</span> para encontrar personas.</>}</div>
          ) : null}
          {!loading && !error && currentTab === 'groups' && query.trim().length > 0 && groupResults.length === 0 ? (
            <div className="px-4 py-3 text-sm opacity-70">Sin grupos.</div>
          ) : null}
          {!loading && !error && currentTab !== 'groups' && query.trim().replace(/^@+/, '').length > 0 && results.length === 0 ? (
            <div className="px-4 py-3 text-sm opacity-70">Sin resultados.</div>
          ) : null}
          {!loading && currentTab === 'groups'
            ? groupResults.map((groupResult) => (
                <button
                  key={groupResult.id}
                  onClick={() => openGroup(groupResult.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 disabled:opacity-50 text-left"
                >
                  <div className="h-11 w-11 overflow-hidden rounded-[14px] border border-white/10 bg-white/5">
                    {groupResult.iconUrl ? <img src={resolveAttachmentUrl(groupResult.iconUrl)} alt={groupResult.name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium text-white/90">{groupResult.name}</div>
                    <div className="truncate text-xs opacity-60">#{groupResult.slug}</div>
                  </div>
                </button>
              ))
            : null}
          {!loading && currentTab !== 'groups'
            ? results.map((userResult) => (
                <button
                  key={userResult.id}
                  onClick={() => openProfile(userResult.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 disabled:opacity-50 text-left"
                >
                  <UserAvatar displayName={userResult.displayName} avatarUrl={userResult.avatarUrl} size={42} className="rounded-[14px]" />
                  <div className="flex-1">
                    <div className="font-medium">@{userResult.displayName}</div>
                    <div className="text-xs opacity-60">{userResult.followersCount} seguidores · Ver perfil</div>
                    <div className="mt-1"><BadgeRow badges={userResult.badges} /></div>
                  </div>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </header>
  );
}

function FeedTab({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const user = useAuth((state) => state.user);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [composer, setComposer] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<DMAttachment[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePopupUrl, setImagePopupUrl] = useState<string | null>(null);
  const [openCommentPostId, setOpenCommentPostId] = useState<string | null>(null);
  const [postActionMenuId, setPostActionMenuId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const remainingChars = POST_CONTENT_MAX_LENGTH - composer.length;

  async function loadPosts() {
    setLoading((current) => (posts.length === 0 ? true : current));
    setError(null);
    try {
      const rows = await api<FeedPost[]>('/posts');
      setPosts(rows);
    } catch {
      setError('No se pudieron cargar las publicaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  useEffect(() => {
    const socket = getSocket('/social');
    const onFeedPostCreated = (post: FeedPost) => {
      setPosts((current) => [post, ...current.filter((row) => row.id !== post.id)]);
    };
    const onFeedPostUpdated = (post: FeedPost) => {
      setPosts((current) => current.map((row) => (row.id === post.id ? post : row)));
    };
    const onFeedPostDeleted = ({ id }: FeedPostDeletedEvent) => {
      setPosts((current) => current.filter((row) => row.id !== id));
    };
    socket.on('feed_post_created', onFeedPostCreated);
    socket.on('feed_post_updated', onFeedPostUpdated);
    socket.on('feed_post_deleted', onFeedPostDeleted);
    return () => {
      socket.off('feed_post_created', onFeedPostCreated);
      socket.off('feed_post_updated', onFeedPostUpdated);
      socket.off('feed_post_deleted', onFeedPostDeleted);
    };
  }, []);

  async function addAttachment(file: File) {
    setUploading(true);
    setError(null);
    try {
      const attachment = await uploadPostAttachment(file);
      if (attachment) {
        setPendingAttachments((current) => [...current, attachment].slice(0, 4));
      }
    } catch {
      setError('No se pudo subir el archivo de la publicacion.');
    } finally {
      setUploading(false);
    }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await addAttachment(file);
    e.target.value = '';
  }

  async function onPickAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await addAttachment(file);
    e.target.value = '';
  }

  async function publishPost() {
    if (!composer.trim() && pendingAttachments.length === 0) return;
    if (publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const post = await api<FeedPost>('/posts', {
        method: 'POST',
        body: { content: composer, attachments: pendingAttachments },
      });
      setComposer('');
      setPendingAttachments([]);
      setComposerOpen(false);
      setPosts((current) => [post, ...current.filter((row) => row.id !== post.id)]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(`La publicacion necesita texto o archivo y el texto no puede pasar de ${POST_CONTENT_MAX_LENGTH} caracteres.`);
      } else {
        setError('No se pudo publicar.');
      }
    } finally {
      setPublishing(false);
    }
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function toggleLike(postId: string) {
    try {
      const post = await api<FeedPost>(`/posts/${postId}/like`, { method: 'POST' });
      setPosts((current) => current.map((row) => (row.id === post.id ? post : row)));
    } catch {
      setError('No se pudo actualizar el like.');
    }
  }

  function toggleCommentBox(postId: string) {
    setOpenCommentPostId((current) => (current === postId ? null : postId));
  }

  async function submitComment(postId: string) {
    const draft = commentDrafts[postId]?.trim() ?? '';
    if (!draft) return;
    try {
      const post = await api<FeedPost>(`/posts/${postId}/comments`, {
        method: 'POST',
        body: { body: draft },
      });
      setPosts((current) => current.map((row) => (row.id === post.id ? post : row)));
      setCommentDrafts((current) => ({ ...current, [postId]: '' }));
    } catch {
      setError('No se pudo guardar el comentario.');
    }
  }

  async function reportPost(postId: string, authorName: string) {
    const reason = window.prompt(`Cuéntanos por qué quieres reportar la publicación de @${authorName}`)?.trim();
    if (!reason) return;
    try {
      await api(`/posts/${postId}/report`, { method: 'POST', body: { reason } });
      setPostActionMenuId(null);
      setError('Reporte enviado.');
    } catch {
      setError('No se pudo reportar la publicación.');
    }
  }

  async function deletePost(postId: string) {
    if (!window.confirm('¿Eliminar esta publicación?')) return;
    try {
      await api(`/posts/${postId}`, { method: 'DELETE' });
      setPosts((current) => current.filter((row) => row.id !== postId));
      setPostActionMenuId(null);
    } catch {
      setError('No se pudo eliminar la publicación.');
    }
  }

  return (
    <section>
      <h1 className="section-title">Publicaciones</h1>

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={onPickAudio} />

      {loading ? <div className="glass-card text-sm opacity-70">Cargando publicaciones...</div> : null}
      {!loading && posts.length === 0 ? <div className="glass-card text-sm opacity-70">Todavia no hay publicaciones.</div> : null}

      {posts.map((post) => (
        <article key={post.id} className="glass-card relative">
          <div className="author-row">
            <UserAvatar
              displayName={post.author.displayName}
              avatarUrl={post.author.avatarUrl}
              size={38}
              className="rounded-[14px]"
              onClick={(event) => {
                event.stopPropagation();
                onOpenProfile(post.author.id);
              }}
            />
            <div className="min-w-0">
              <div className="font-medium truncate">{post.author.displayName}</div>
              <BadgeRow badges={getBadgeLabels(post.author)} />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="opacity-50 shrink-0">· {formatShortTime(post.createdAt)}</span>
              <button type="button" className="icon-btn !h-8 !w-8 !rounded-[10px]" aria-label="Opciones de la publicación" onClick={() => setPostActionMenuId((current) => current === post.id ? null : post.id)}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <circle cx="5" cy="12" r="1.7" />
                  <circle cx="12" cy="12" r="1.7" />
                  <circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
            </div>
          </div>
          {postActionMenuId === post.id ? (
            <div className="absolute right-4 top-14 z-20 w-48 rounded-2xl border border-white/10 bg-[#151d2a] p-2 shadow-2xl">
              {post.authorId === user?.id ? (
                <button className="w-full rounded-xl px-3 py-2 text-left text-sm text-red-300 hover:bg-white/5" onClick={() => void deletePost(post.id)}>
                  Eliminar publicación
                </button>
              ) : (
                <button className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => void reportPost(post.id, post.author.displayName)}>
                  Reportar publicación
                </button>
              )}
            </div>
          ) : null}
          {post.content ? <p className="mt-3 text-[15px] leading-snug opacity-95">{post.content}</p> : null}
          {post.attachments?.length ? (
            <div className="mt-3 space-y-2">
              {post.attachments.map((attachment) => (
                <div key={`${post.id}-${attachment.url}`}>
                  {attachment.kind === 'image' ? (
                    <button type="button" className="block w-full" onClick={() => setImagePopupUrl(resolveAttachmentUrl(attachment.url))}>
                      <img src={resolveAttachmentUrl(attachment.url)} alt={attachment.fileName ?? 'Imagen'} className="w-full rounded-[16px] object-cover max-h-72" />
                    </button>
                  ) : (
                    <div className="rounded-[16px] border border-white/10 bg-white/5 p-3">
                      <audio controls className="w-full">
                        <source src={resolveAttachmentUrl(attachment.url)} type={attachment.mimeType ?? 'audio/webm'} />
                      </audio>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2 text-[11px] text-white/55">
            <button
              type="button"
              onClick={() => toggleLike(post.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition ${post.likedByMe ? 'border-[#ff7aa2]/35 bg-[#ff7aa2]/10 text-[#ffd3df]' : 'border-white/8 bg-white/5 text-white/58'}`}
              aria-label="Me gusta"
            >
              <LikeTinyIcon filled={post.likedByMe} />
              <span className="text-[10px] leading-none">{post.likeCount}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleCommentBox(post.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition ${openCommentPostId === post.id ? 'border-[#86e6ff]/30 bg-[#86e6ff]/10 text-[#d6f8ff]' : 'border-white/8 bg-white/5 text-white/58'}`}
              aria-label="Comentar"
            >
              <CommentTinyIcon />
              <span className="text-[10px] leading-none">{post.comments?.length ?? 0}</span>
            </button>
          </div>

          {openCommentPostId === post.id ? (
            <div className="mt-2 rounded-[16px] border border-white/8 bg-white/[0.04] p-2">
              <div className="flex items-center gap-2">
                <input
                  value={commentDrafts[post.id] ?? ''}
                  onChange={(e) => setCommentDrafts((current) => ({ ...current, [post.id]: e.target.value.slice(0, 80) }))}
                  placeholder="Comenta"
                  className="h-8 rounded-[12px] border border-white/8 bg-white/[0.04] px-3 py-0 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => submitComment(post.id)}
                  className="h-8 shrink-0 rounded-[12px] border border-white/8 bg-white/5 px-2 text-[10px] font-semibold text-white/70"
                >
                  Enviar
                </button>
              </div>
              {post.comments?.length ? (
                <div className="mt-2 space-y-1">
                  {post.comments.map((comment) => (
                    <div key={comment.id} className="rounded-[12px] bg-black/10 px-2 py-1.5 text-[10px] leading-[1.3] text-white/70">
                      <span className="mr-1 font-semibold text-white/82">{comment.authorName}:</span>
                      <span>{comment.body}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}

      {imagePopupUrl ? (
        <button type="button" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setImagePopupUrl(null)}>
          <img src={imagePopupUrl} alt="Vista completa" className="max-h-[88vh] w-auto max-w-full rounded-[24px] object-contain" />
        </button>
      ) : null}

      {composerOpen ? (
        <>
          <button type="button" className="feed-composer-backdrop" aria-label="Cerrar publicacion" onClick={() => setComposerOpen(false)} />
          <div className="feed-composer-sheet">
            <div className="feed-composer-sheet__handle" />
            <div className="flex items-start gap-3">
              <UserAvatar displayName={user?.displayName ?? user?.email} avatarUrl={user?.avatarUrl} size={44} className="rounded-[14px]" />
              <div className="flex-1">
                <textarea
                  rows={3}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value.slice(0, POST_CONTENT_MAX_LENGTH))}
                  placeholder={`Comparte algo en ${POST_CONTENT_MAX_LENGTH} caracteres o menos`}
                  className="min-h-[92px] resize-none rounded-[18px] border border-white/10 bg-white/5 text-sm"
                />
                <div className="mt-2 flex items-center justify-end">
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${remainingChars <= 8 ? 'border-[#ff8a8a]/35 bg-[#ff8a8a]/12 text-[#ffd4d4]' : remainingChars <= 15 ? 'border-[#ffd37a]/30 bg-[#ffd37a]/10 text-[#ffe7b0]' : 'border-white/10 bg-white/5 text-white/60'}`}
                  >
                    {composer.length} de {POST_CONTENT_MAX_LENGTH} caracteres
                  </span>
                </div>
              </div>
            </div>

            {pendingAttachments.length > 0 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {pendingAttachments.map((attachment, index) => (
                  <div key={`${attachment.url}-${index}`} className="min-w-[120px] rounded-[18px] border border-white/10 bg-white/5 p-2">
                    {attachment.kind === 'image' ? (
                      <button type="button" onClick={() => setImagePopupUrl(resolveAttachmentUrl(attachment.url))} className="block w-full">
                        <img src={resolveAttachmentUrl(attachment.url)} alt="Adjunto" className="h-20 w-full rounded-[14px] object-cover" />
                      </button>
                    ) : (
                      <audio controls className="w-full h-10">
                        <source src={resolveAttachmentUrl(attachment.url)} type={attachment.mimeType ?? 'audio/webm'} />
                      </audio>
                    )}
                    <button type="button" className="mt-2 text-[11px] text-white/65" onClick={() => removePendingAttachment(index)}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="icon-btn !w-auto px-4" onClick={() => imageInputRef.current?.click()} disabled={uploading || publishing}>
                Foto
              </button>
              <button type="button" className="icon-btn !w-auto px-4" onClick={() => audioInputRef.current?.click()} disabled={uploading || publishing}>
                Audio
              </button>
              <button type="button" className="primary ml-auto" onClick={() => void publishPost()} disabled={uploading || publishing || (!composer.trim() && pendingAttachments.length === 0)}>
                {publishing ? 'Publicando...' : uploading ? 'Subiendo...' : 'Publicar'}
              </button>
            </div>
            {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="feed-compose-fab"
        onClick={() => setComposerOpen(true)}
        aria-label="Crear publicacion"
      >
        +
      </button>
    </section>
  );
}

function LikeTinyIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill={filled ? 'currentColor' : 'none'}>
      <path
        d="M12 20.4 4.9 13.8A4.8 4.8 0 0 1 12 7.5a4.8 4.8 0 0 1 7.1 6.3L12 20.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
      <path
        d="M7 17.2 3.8 20V6.9A2.9 2.9 0 0 1 6.7 4h10.6a2.9 2.9 0 0 1 2.9 2.9v7.4a2.9 2.9 0 0 1-2.9 2.9H7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatsTab({
  selectedConversationId,
  refreshToken,
  onSelectConversation,
  onOpenProfile,
  onConversationChanged,
}: {
  selectedConversationId: string | null;
  refreshToken: number;
  onSelectConversation: (conversationId: string | null) => void;
  onOpenProfile: (userId: string) => void;
  onConversationChanged: () => void;
}) {
  const { user } = useAuth();
  const [dms, setDms] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<DMAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [imagePopupUrl, setImagePopupUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [replyingTo, setReplyingTo] = useState<DMMessage | null>(null);
  const [messageActionMenu, setMessageActionMenu] = useState<MessageActionMenuState | null>(null);
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const swipeStartRef = useRef<{ messageId: string; startX: number } | null>(null);
  const suppressMenuRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressLongPressClickRef = useRef(false);

  async function loadConversations() {
    setLoadingList(true);
    setError(null);
    try {
      const rows = await api<ConversationSummary[]>('/dm');
      setDms(rows);
      if (selectedConversationId) {
        const current = rows.find((row) => row.id === selectedConversationId) ?? null;
        setActiveConversation(current);
      }
    } catch {
      setError('No se pudieron cargar las conversaciones.');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadConversation(conversationId: string) {
    setLoadingConversation(true);
    setError(null);
    try {
      const [conversation, rows] = await Promise.all([
        api<ConversationSummary>(`/dm/${conversationId}`),
        api<DMMessage[]>(`/dm/${conversationId}/messages`),
      ]);
      setActiveConversation(conversation);
      setMessages(
        rows.slice().sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
      );
      setMessageActionMenu(null);
    } catch {
      setError('No se pudo cargar el chat.');
      setActiveConversation(null);
      setMessages([]);
      setMessageActionMenu(null);
    } finally {
      setLoadingConversation(false);
    }
  }

  async function refreshAll(conversationId: string | null = selectedConversationId) {
    await loadConversations();
    if (conversationId) {
      await loadConversation(conversationId);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedConversationId) {
      setActiveConversation(null);
      setMessages([]);
      setComposer('');
      setPendingAttachments([]);
      setReplyingTo(null);
      setMessageActionMenu(null);
      return;
    }
    void loadConversation(selectedConversationId);
  }, [selectedConversationId, refreshToken]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!isRecording || !recordingStartedAt) return;
    const timer = window.setInterval(() => {
      setRecordingElapsed(Math.floor((Date.now() - recordingStartedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording, recordingStartedAt]);

  async function addAttachment(file: File) {
    setUploadingAttachment(true);
    setError(null);
    try {
      const attachment = await uploadDmAttachment(file);
      if (attachment) {
        setPendingAttachments((current) => [...current, attachment].slice(0, 4));
      }
    } catch {
      setError('No se pudo subir el archivo.');
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await addAttachment(file);
    e.target.value = '';
  }

  async function toggleVoiceRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no soporta grabar notas de voz.');
      return;
    }

    try {
      if (!window.isSecureContext) {
        setError('La grabacion de voz necesita un contexto seguro. Usa localhost o HTTPS.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [track] = stream.getAudioTracks();
      const settings = track?.getSettings?.();
      if (track && settings) {
        await track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }).catch(() => undefined);
      }
      const mimeType = getSupportedVoiceMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        recordedChunksRef.current = [];
        setRecordingStartedAt(null);
        setRecordingElapsed(0);
        if (blob.size > 0) {
          const extension = getVoiceFileExtension(blob.type || mimeType);
          await addAttachment(new File([blob], `nota-de-voz-${Date.now()}.${extension}`, { type: blob.type || mimeType || 'audio/webm' }));
        }
      };
      recorder.start();
      setIsRecording(true);
      setRecordingStartedAt(Date.now());
      setRecordingElapsed(0);
    } catch (err) {
      setError(getVoiceRecordingErrorMessage(err));
    }
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function sendMessage() {
    if (!activeConversation || (!composer.trim() && pendingAttachments.length === 0) || !user) return;
    setSending(true);
    setError(null);
    const tempContent = composer;
    const tempAttachments = [...pendingAttachments];
    const tempReplyingTo = replyingTo;
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const optimisticMessage: DMMessage = {
      id: tempId,
      conversationId: activeConversation.id,
      authorId: user.id,
      content: tempContent,
      createdAt: new Date().toISOString(),
      author: { id: user.id, displayName: user.displayName ?? user.email, avatarUrl: user.avatarUrl },
      attachments: tempAttachments,
      parent: tempReplyingTo,
    };
    setMessages((current) => [...current, optimisticMessage]);
    setComposer('');
    setPendingAttachments([]);
    setReplyingTo(null);
    setMessageActionMenu(null);
    try {
      const sent = await api<DMMessage>(`/dm/${activeConversation.id}/messages`, {
        method: 'POST',
        body: { content: tempContent, attachments: tempAttachments, parentId: tempReplyingTo?.id },
      });
      setMessages((current) => current.map((msg) => (msg.id === tempId ? sent : msg)));
      onConversationChanged();
    } catch (err) {
      setMessages((current) => current.filter((msg) => msg.id !== tempId));
      setComposer(tempContent);
      setPendingAttachments(tempAttachments);
      setReplyingTo(tempReplyingTo);
      if (err instanceof ApiError && err.status === 403) {
        setError('No puedes enviar más mensajes hasta que acepten tu solicitud.');
      } else {
        setError('No se pudo enviar el mensaje.');
      }
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(messageId: string) {
    if (!activeConversation) return;
    setError(null);
    try {
      setMessageActionMenu(null);
      await api(`/dm/${activeConversation.id}/messages/${messageId}`, { method: 'DELETE' });
      setMessages((current) => current.filter((msg) => msg.id !== messageId));
      onConversationChanged();
    } catch {
      setError('No se pudo eliminar el mensaje.');
    }
  }

  async function deleteConversation() {
    if (!activeConversation) return;
    if (!window.confirm(`Eliminar toda la conversación con ${activeConversation.peer.displayName}?`)) return;
    setActing(true);
    setError(null);
    try {
      await api(`/dm/${activeConversation.id}`, { method: 'DELETE' });
      setMessageActionMenu(null);
      setReplyingTo(null);
      onConversationChanged();
      onSelectConversation(null);
      await loadConversations();
    } catch {
      setError('No se pudo eliminar la conversación.');
    } finally {
      setActing(false);
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function beginSwipe(message: DMMessage, clientX: number, element: HTMLDivElement) {
    clearLongPressTimer();
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
      openMessageActionMenu(message, element);
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

  function finishSwipe(message: DMMessage) {
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      swipeStartRef.current = null;
      setSwipingMessageId(null);
      setSwipeOffset(0);
      return;
    }

    if (swipeStartRef.current?.messageId === message.id && swipeOffset >= 64) {
      suppressMenuRef.current = true;
      setMessageActionMenu(null);
      setReplyingTo(message);
    }
    swipeStartRef.current = null;
    setSwipingMessageId(null);
    setSwipeOffset(0);
  }

  function openMessageActionMenu(message: DMMessage, element: HTMLDivElement) {
    if (suppressMenuRef.current) {
      suppressMenuRef.current = false;
      return;
    }

    const mine = message.authorId === user?.id;
    const rect = element.getBoundingClientRect();
    setMessageActionMenu({
      messageId: message.id,
      mine,
      side: mine ? 'right' : 'left',
      x: mine ? Math.min(window.innerWidth - 16, rect.right) : Math.max(16, rect.left),
      y: Math.max(18, rect.top - 10),
    });
  }

  async function answerRequest(action: 'accept' | 'reject') {
    if (!activeConversation) return;
    setActing(true);
    setError(null);
    try {
      await api(`/dm/${activeConversation.id}/${action}`, { method: 'POST' });
      onConversationChanged();
      await refreshAll(activeConversation.id);
    } catch {
      setError('No se pudo actualizar la solicitud.');
    } finally {
      setActing(false);
    }
  }

  async function answerRequestFromList(conversationId: string, action: 'accept' | 'reject') {
    setActing(true);
    setError(null);
    try {
      await api(`/dm/${conversationId}/${action}`, { method: 'POST' });
      if (action === 'accept') {
        onSelectConversation(conversationId);
      }
      onConversationChanged();
      await refreshAll(action === 'accept' ? conversationId : null);
    } catch {
      setError('No se pudo responder la solicitud.');
    } finally {
      setActing(false);
    }
  }

    const canWrite = Boolean(activeConversation && (activeConversation.canReply || activeConversation.canSendIntro));

    return (
      <section>
        <h1 className="section-title">Chats</h1>

        {!selectedConversationId ? (
          <>
            {loadingList ? (
              <div className="glass-card text-sm opacity-70">Cargando conversaciones...</div>
            ) : dms.length === 0 ? (
              <div className="glass-card text-sm opacity-70">Todavía no tienes conversaciones directas.</div>
            ) : (
              dms.map((d) => (
                <div key={d.id} className="glass-card">
                  <button className="w-full text-left flex items-center gap-3" onClick={() => onSelectConversation(d.id)}>
                    <UserAvatar
                      displayName={d.peer?.displayName}
                      avatarUrl={d.peer?.avatarUrl}
                      size={46}
                      className="rounded-[16px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenProfile(d.peer.id);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium truncate">{d.peer?.displayName ?? 'Anónimo'}</div>
                        <span className="text-[11px] opacity-45">{formatShortTime(d.lastMessage?.createdAt ?? d.createdAt)}</span>
                      </div>
                      <div className="text-xs opacity-60 truncate">
                        {d.status === 'PENDING'
                          ? d.pendingForMe
                            ? 'Te enviaron una solicitud de chat'
                            : getConversationPreview(d.lastMessage) || 'Envía tu mensaje inicial'
                          : d.status === 'REJECTED'
                            ? 'Solicitud rechazada'
                            : getConversationPreview(d.lastMessage) || 'Conversación lista'}
                      </div>
                    </div>
                    <span className={d.status === 'ACCEPTED' ? 'chip' : d.pendingForMe ? 'chip !bg-red-500/15 !text-red-200 !border-red-400/20' : 'chip !bg-white/10 !text-white/80 !border-white/10'}>
                      {d.status === 'PENDING' ? (d.pendingForMe ? 'Nuevo' : 'Esperando') : d.status === 'REJECTED' ? 'Rechazado' : 'Chat'}
                    </span>
                  </button>

                  {d.pendingForMe ? (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                      <button className="primary flex-1" disabled={acting} onClick={() => void answerRequestFromList(d.id, 'accept')}>
                        {acting ? 'Procesando...' : 'Aceptar'}
                      </button>
                      <button className="icon-btn !w-auto px-4" disabled={acting} onClick={() => void answerRequestFromList(d.id, 'reject')}>
                        Rechazar
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </>
        ) : (
          <div className="glass-card !p-0 overflow-hidden flex flex-col h-[calc(100dvh-190px)] min-h-[520px]">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-white/5">
              <button className="icon-btn shrink-0" onClick={() => onSelectConversation(null)} aria-label="Volver al listado de chats">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="flex items-center gap-3 text-left min-w-0" onClick={() => activeConversation && onOpenProfile(activeConversation.peer.id)}>
                <UserAvatar displayName={activeConversation?.peer.displayName} avatarUrl={activeConversation?.peer.avatarUrl} size={44} className="rounded-[16px]" />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{activeConversation?.peer.displayName ?? 'Chat'}</div>
                  <div className="text-xs opacity-60">
                    {activeConversation?.status === 'ACCEPTED'
                      ? 'Conversación activa'
                      : activeConversation?.pendingForMe
                        ? 'Solicitud por responder'
                        : activeConversation?.status === 'REJECTED'
                          ? 'Solicitud rechazada'
                          : 'Esperando aceptación'}
                  </div>
                </div>
              </button>
              <button className="icon-btn shrink-0 ml-auto" disabled={acting} onClick={() => void deleteConversation()} aria-label="Eliminar conversación">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                  <path d="M4 7h16" strokeLinecap="round" />
                  <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M7 7l.6 11a1 1 0 001 .94h6.8a1 1 0 001-.94L17 7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10 11v4M14 11v4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {loadingConversation ? (
              <div className="px-4 py-10 text-sm opacity-70">Cargando chat...</div>
            ) : error ? (
              <div className="px-4 py-10 text-sm text-red-400">{error}</div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[radial-gradient(circle_at_top,#1f2a3a_0%,#111722_45%,#0b0d12_100%)] min-h-0">
                  {activeConversation?.status === 'PENDING' && activeConversation.pendingForMe ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm space-y-3 sticky top-0 z-10 backdrop-blur-sm">
                      <div className="font-semibold text-emerald-200">Solicitud de conversación</div>
                      <div className="opacity-80">Acepta para seguir conversando o rechaza para cerrar esta solicitud.</div>
                      <div className="flex gap-2">
                        <button className="primary" disabled={acting} onClick={() => void answerRequest('accept')}>
                          {acting ? 'Procesando...' : 'Aceptar'}
                        </button>
                        <button className="icon-btn !w-auto px-4" disabled={acting} onClick={() => void answerRequest('reject')}>
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {activeConversation?.status === 'PENDING' && !activeConversation.pendingForMe ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm opacity-80">
                      {messages.length === 0
                        ? 'Puedes enviar un solo mensaje inicial. Luego tendrás que esperar a que la otra persona acepte.'
                        : 'Ya enviaste tu mensaje inicial. Espera a que acepten para seguir hablando.'}
                    </div>
                  ) : null}

                  {activeConversation?.status === 'REJECTED' ? (
                    <div className="rounded-2xl border border-red-400/15 bg-red-500/10 p-4 text-sm text-red-200">
                      Esta solicitud fue rechazada. Puedes volver a intentarlo desde el perfil del usuario.
                    </div>
                  ) : null}

                  {messages.length === 0 ? (
                    <div className="text-center text-sm opacity-55 py-8">Todavía no hay mensajes.</div>
                  ) : (
                    messages.map((message) => {
                      const mine = message.authorId === user?.id;
                      const offset = swipingMessageId === message.id ? swipeOffset : 0;
                      const hasText = Boolean(message.content?.trim());
                      const hasReply = Boolean(message.parent);
                      const hasAttachments = Boolean(message.attachments?.length);
                      const attachmentOnly = hasAttachments && !hasText && !hasReply;
                      const shortText = (message.content ?? '').trim();
                      const showCompactTimestamp = Boolean(
                        shortText && !hasAttachments && !hasReply && shortText.length <= 24 && !shortText.includes('\n'),
                      );
                      const bubbleClassName = attachmentOnly
                        ? 'max-w-[80%] px-0 py-0 text-white shadow-none cursor-pointer bg-transparent border-0'
                        : mine
                          ? 'max-w-[78%] rounded-[16px] rounded-br-[8px] bg-[#7c5cff] px-3 py-2 text-white shadow-sm cursor-pointer'
                          : 'max-w-[78%] rounded-[16px] rounded-bl-[8px] bg-[#1a2330] px-3 py-2 text-white/90 border border-white/6 cursor-pointer';

                      return (
                        <div key={message.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                          <div className={mine ? 'flex items-center justify-end w-full gap-2' : 'flex items-center w-full gap-2'}>
                            <div className={offset > 24 ? 'text-xs text-[#cdbfff] opacity-90' : 'text-xs text-[#cdbfff] opacity-0'}>
                              Responder
                            </div>
                            <div
                              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); beginSwipe(message, e.clientX, e.currentTarget); }}
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
                                openMessageActionMenu(message, e.currentTarget);
                              }}
                              className={bubbleClassName}
                              style={{ transform: `translateX(${offset}px)`, transition: swipingMessageId === message.id ? 'none' : 'transform 120ms ease-out', touchAction: 'pan-y' }}
                            >
                              {message.parent ? (
                                <div className={mine ? 'rounded-2xl bg-black/15 border border-white/10 px-3 py-2 mb-2' : 'rounded-2xl bg-white/5 border border-white/10 px-3 py-2 mb-2'}>
                                  <div className="text-[11px] font-semibold opacity-80">{message.parent.author?.displayName ?? 'Mensaje'}</div>
                                  <div className="text-[12px] opacity-70 truncate">{getReplyPreview(message.parent)}</div>
                                </div>
                              ) : null}
                              {message.attachments?.length ? (
                                <div className="space-y-2 mb-2">
                                  {message.attachments.map((attachment) => (
                                    <AttachmentPreview
                                      key={`${message.id}-${attachment.url}`}
                                      attachment={attachment}
                                      onOpenImage={(url) => setImagePopupUrl(url)}
                                    />
                                  ))}
                                </div>
                              ) : null}
                              {message.content ? (
                                showCompactTimestamp ? (
                                  <div className="flex items-end gap-2">
                                    <div className="text-[14px] leading-snug whitespace-pre-wrap break-words">{message.content}</div>
                                    <div className={mine ? 'text-[10px] leading-none text-white/60 shrink-0' : 'text-[10px] leading-none text-white/40 shrink-0'}>
                                      {formatShortTime(message.createdAt)}
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="text-[14px] leading-snug whitespace-pre-wrap break-words">{message.content}</div>
                                    <div className={mine ? 'text-[10px] leading-none text-white/60 mt-1.5' : 'text-[10px] leading-none text-white/40 mt-1.5'}>
                                      {formatShortTime(message.createdAt)}
                                    </div>
                                  </>
                                )
                              ) : (
                                <div className={mine ? 'text-[10px] leading-none text-white/60 mt-1' : 'text-[10px] leading-none text-white/40 mt-1'}>
                                  {formatShortTime(message.createdAt)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="px-3 py-2 border-t border-white/5 bg-[#0d131d]">
                  {replyingTo ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[#cdbfff]">Respondiendo a {replyingTo.author?.displayName ?? (replyingTo.authorId === user?.id ? 'ti' : 'mensaje')}</div>
                        <div className="text-xs opacity-70 truncate">{getReplyPreview(replyingTo)}</div>
                      </div>
                      <button className="text-xs opacity-60 shrink-0" onClick={() => setReplyingTo(null)}>Cancelar</button>
                    </div>
                  ) : null}
                  {pendingAttachments.length > 0 ? (
                    <div className="flex gap-2 flex-wrap mb-2">
                      {pendingAttachments.map((attachment, index) => (
                        <div key={`${attachment.url}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2 flex items-center gap-2 max-w-full">
                          {attachment.kind === 'image' ? (
                            <button className="shrink-0" onClick={() => setImagePopupUrl(resolveAttachmentUrl(attachment.url))}>
                              <img src={resolveAttachmentUrl(attachment.url)} alt="Vista previa" className="h-12 w-12 rounded-xl object-cover border border-white/10" />
                            </button>
                          ) : (
                            <div className="h-12 w-12 rounded-xl bg-[#182131] border border-white/10 flex items-center justify-center text-xs text-white/80">
                              Voz
                            </div>
                          )}
                          <div className="text-xs opacity-80 truncate max-w-[170px]">{attachment.kind === 'image' ? 'Imagen lista' : 'Nota de voz lista'}</div>
                          <button className="text-xs opacity-60" onClick={() => removePendingAttachment(index)}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-end gap-2">
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                    <button className="icon-btn shrink-0" disabled={!canWrite || sending || uploadingAttachment || isRecording} onClick={() => imageInputRef.current?.click()} aria-label="Enviar imagen">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                        <rect x="4" y="5" width="16" height="14" rx="3" />
                        <circle cx="9" cy="10" r="1.5" />
                        <path d="M20 16l-4.5-4.5L8 19" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className={isRecording ? 'icon-btn shrink-0 !bg-red-500/20 !border-red-400/25 !text-red-200' : 'icon-btn shrink-0'} disabled={!canWrite || sending || uploadingAttachment} onClick={() => void toggleVoiceRecording()} aria-label="Grabar nota de voz">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                        <rect x="9" y="4" width="6" height="11" rx="3" />
                        <path d="M6 11a6 6 0 0012 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <textarea
                      rows={1}
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      placeholder={
                        activeConversation?.canReply
                          ? 'Escribe un mensaje'
                          : activeConversation?.canSendIntro
                            ? 'Escribe tu único mensaje inicial'
                            : 'No puedes escribir ahora'
                      }
                      className="min-h-[42px] max-h-24 rounded-[18px] resize-none text-sm"
                      disabled={!canWrite || sending || uploadingAttachment}
                    />
                    <button className="primary h-[42px] px-4" disabled={!canWrite || sending || uploadingAttachment || (!composer.trim() && pendingAttachments.length === 0)} onClick={() => void sendMessage()}>
                      {sending ? 'Enviando...' : uploadingAttachment ? 'Subiendo...' : activeConversation?.canReply ? 'Enviar' : 'Solicitar'}
                    </button>
                  </div>
                  {isRecording ? (
                    <div className="flex items-center gap-2 text-xs text-red-200 mt-2 rounded-full bg-red-500/10 border border-red-400/15 px-3 py-2 w-fit">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
                      <span>Grabando {formatVoiceDuration(recordingElapsed)}</span>
                      <span className="opacity-70">pulsa el micro para detener</span>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}

        {imagePopupUrl ? (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setImagePopupUrl(null)}>
            <div className="relative max-w-[92vw] max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn absolute right-3 top-3 z-10" onClick={() => setImagePopupUrl(null)} aria-label="Cerrar imagen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
              <img src={imagePopupUrl} alt="Imagen ampliada" className="max-w-[92vw] max-h-[88vh] rounded-[24px] object-contain border border-white/10 shadow-2xl" />
            </div>
          </div>
        ) : null}

        {messageActionMenu ? (
          <div className="fixed inset-0 z-40" onClick={() => setMessageActionMenu(null)}>
            <div
              className="message-action-menu"
              data-side={messageActionMenu.side}
              style={{ left: messageActionMenu.x, top: messageActionMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="message-action-menu__eyebrow">Accion rapida</div>
              <button className="message-action-menu__button message-action-menu__button--danger" onClick={() => void deleteMessage(messageActionMenu.messageId)}>
                {messageActionMenu.mine ? 'Eliminar' : 'Eliminar para mi'}
              </button>
              <div className="message-action-menu__hint">
                {messageActionMenu.mine ? 'Se elimina para ambos participantes.' : 'Solo desaparece de tu chat.'}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

function UserProfileSheet({
  userId,
  onClose,
  onOpenConversation,
  onRelationshipChanged,
}: {
  userId: string;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRelationshipChanged: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<UserProfile>(`/users/${userId}`);
      setProfile(data);
    } catch {
      setProfile(null);
      setError('No se pudo cargar el perfil.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [userId]);

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    try {
      await api(`/users/${profile.id}/follow`, { method: profile.isFollowing ? 'DELETE' : 'POST' });
      await loadProfile();
      onRelationshipChanged();
    } catch {
      setError('No se pudo actualizar el seguimiento.');
    } finally {
      setBusy(false);
    }
  }

  async function startConversation() {
    if (!profile) return;
    setBusy(true);
    try {
      const conversation = await api<ConversationSummary>(`/dm/open/${profile.id}`, { method: 'POST' });
      onRelationshipChanged();
      onOpenConversation(conversation.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('No puedes iniciar conversación con este usuario.');
      } else {
        setError('No se pudo abrir la conversación.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function blockUser() {
    if (!profile) return;
    if (!window.confirm(`Bloquear a @${profile.displayName}? Ya no podrán escribirse.`)) return;
    setBusy(true);
    try {
      await api(`/blocks/${profile.id}`, { method: 'POST' });
      onRelationshipChanged();
      onClose();
    } catch {
      setError('No se pudo bloquear al usuario.');
    } finally {
      setBusy(false);
    }
  }

  async function reportUser() {
    if (!profile) return;
    const reason = window.prompt(`Cuéntanos por qué quieres reportar a @${profile.displayName}`)?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await api(`/users/${profile.id}/report`, { method: 'POST', body: { reason } });
      setMenuOpen(false);
      setError('Reporte enviado.');
    } catch {
      setError('No se pudo enviar el reporte.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-end justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-[30px] border border-white/10 bg-[#0f1520] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-white/35">Perfil</div>
            <div className="font-semibold text-white/90">Usuario</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button className="icon-btn" aria-label="Acciones del usuario" onClick={() => setMenuOpen((value) => !value)}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <circle cx="5" cy="12" r="1.7" />
                  <circle cx="12" cy="12" r="1.7" />
                  <circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-white/10 bg-[#151d2a] p-2 shadow-2xl">
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/5 text-sm" onClick={() => void reportUser()}>
                    Reportar usuario
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/5 text-sm text-red-300" onClick={() => void blockUser()}>
                    Bloquear usuario
                  </button>
                </div>
              ) : null}
            </div>
            <button className="icon-btn" aria-label="Cerrar perfil" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-sm opacity-70">Cargando perfil...</div>
        ) : !profile ? (
          <div className="px-5 py-10 text-sm text-red-300">{error ?? 'Perfil no disponible.'}</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(124,92,255,.35),rgba(124,92,255,.08)_40%,rgba(11,13,18,.3)_75%)] p-5">
              <div className="flex items-start gap-4">
                <UserAvatar displayName={profile.displayName} avatarUrl={profile.avatarUrl} size={68} className="rounded-[24px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xl font-semibold truncate">@{profile.displayName}</div>
                  <div className="mt-2"><BadgeRow badges={profile.badges} /></div>
                  <div className="text-sm opacity-65 mt-1">
                    {profile.followsYou ? 'Te sigue' : 'Perfil público'} · {profile.globalRole}
                  </div>
                  <div className="flex gap-2 flex-wrap mt-3">
                    <span className="chip">{profile.followersCount} seguidores</span>
                    <span className="chip !bg-white/8 !text-white/80 !border-white/10">{profile.followingCount} siguiendo</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button className="primary w-full" disabled={busy} onClick={() => void toggleFollow()}>
                {busy ? 'Procesando...' : profile.isFollowing ? 'Siguiendo' : 'Seguir'}
              </button>
              <button className="icon-btn !w-full !h-auto py-3 rounded-[16px]" disabled={busy} onClick={() => void startConversation()}>
                Iniciar conversación
              </button>
            </div>

            <div className="rounded-[22px] border border-white/6 bg-white/5 p-4 text-sm space-y-2">
              <div className="font-semibold text-white/90">Qué pasará al bloquear</div>
              <div className="opacity-70">Si bloqueas o te bloquean, ya no podrán escribirse y el contenido del chat dejará de aparecer.</div>
            </div>

            {error ? <div className="text-sm text-white/75">{error}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function formatShortTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function getConversationPreview(lastMessage?: ConversationSummary['lastMessage']) {
  if (!lastMessage) return '';
  if (lastMessage.content?.trim()) return lastMessage.content;
  const attachments = lastMessage.attachments ?? [];
  if (attachments.some((attachment) => attachment.kind === 'image')) return 'Imagen';
  if (attachments.some((attachment) => attachment.kind === 'voice')) return 'Nota de voz';
  return '';
}

function getReplyPreview(message?: Pick<DMMessage, 'content' | 'attachments'> | null) {
  if (!message) return 'Mensaje';
  if (message.content?.trim()) return message.content;
  if (message.attachments?.some((attachment) => attachment.kind === 'image')) return 'Imagen';
  if (message.attachments?.some((attachment) => attachment.kind === 'voice')) return 'Nota de voz';
  return 'Mensaje';
}

function AttachmentPreview({ attachment, onOpenImage }: { attachment: DMAttachment; onOpenImage?: (url: string) => void }) {
  const src = resolveAttachmentUrl(attachment.url);
  if (attachment.kind === 'image') {
    return (
      <button type="button" onClick={(e) => {
        e.stopPropagation();
        onOpenImage?.(src);
      }} className="block w-full text-left">
        <img
          src={src}
          alt={attachment.fileName ?? 'Imagen del chat'}
          className="w-full max-h-60 object-cover rounded-[14px]"
        />
      </button>
    );
  }

  return (
    <VoiceNote attachment={attachment} src={src} />
  );
}

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
      if (!audio.duration) {
        setProgress(0);
        return;
      }
      setProgress(audio.currentTime / audio.duration);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      audio.currentTime = 0;
    };
    const onPause = () => setIsPlaying(false);
    const onPlay = () => {
      audio.volume = 1;
      setIsPlaying(true);
    };

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
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
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
            {Array.from({ length: 22 }).map((_, index) => {
              const threshold = (index + 1) / 22;
              const active = progress >= threshold;
              const height = 8 + ((index * 7) % 16);
              return <span key={index} className={active ? 'w-1 rounded-full bg-[#7c5cff]' : 'w-1 rounded-full bg-white/20'} style={{ height }} />;
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

function resolveAttachmentUrl(url: string) {
  return resolveMediaUrl(url);
}

function getSupportedVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
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
      return 'No diste permiso al microfono. Revisa el permiso del navegador para localhost.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'No se encontro ningun microfono disponible.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'El microfono esta siendo usado por otra aplicacion.';
    }
    if (err.name === 'NotSupportedError') {
      return 'Tu navegador no pudo iniciar la grabacion con un formato compatible.';
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'No se pudo iniciar la grabacion.';
}

function formatVoiceDuration(totalSeconds: number) {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function uploadDmAttachment(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ attachment: DMAttachment | null }>('/dm/upload', {
    method: 'POST',
    body: formData,
  });
  return result.attachment ? { ...result.attachment, url: normalizeMediaUrl(result.attachment.url) ?? result.attachment.url } : null;
}

async function uploadPostAttachment(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ attachment: DMAttachment | null }>('/posts/upload', {
    method: 'POST',
    body: formData,
  });
  return result.attachment ? { ...result.attachment, url: normalizeMediaUrl(result.attachment.url) ?? result.attachment.url } : null;
}

/* -------------------- Grupos -------------------- */
function GroupsTab() {
  const user = useAuth((state) => state.user);
  const [mine, setMine] = useState<Group[]>([]);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [groupView, setGroupView] = useState<'mine' | 'public'>('mine');
  const [createComposerOpen, setCreateComposerOpen] = useState(false);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<GroupPrivacy>('PRIVATE');
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrivacy, setEditPrivacy] = useState<GroupPrivacy>('PRIVATE');
  const [editIconUrl, setEditIconUrl] = useState<string | null>(null);
  const [editBannerUrl, setEditBannerUrl] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    void loadGroups();
  }, []);

  async function loadGroups() {
    try {
      const data = await api<GroupsResponse>('/groups');
      setMine(data.mine);
      setPublicGroups(data.public);
    } catch {
      setMine([]);
      setPublicGroups([]);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    setCreating(true);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const g = await api<Group>('/groups', {
        method: 'POST',
        body: { name, slug, privacy, iconUrl, bannerUrl },
      });
      setMine((groups) => [g, ...groups]);
      setPublicGroups((groups) => groups.filter((group) => group.id !== g.id));
      setName('');
      setPrivacy('PRIVATE');
      setIconUrl(null);
      setBannerUrl(null);
      setCreateComposerOpen(false);
    } finally {
      setCreating(false);
    }
  }

  async function joinGroup(groupId: string) {
    setJoiningId(groupId);
    try {
      await api(`/groups/${groupId}/join`, { method: 'POST' });
      await loadGroups();
    } finally {
      setJoiningId(null);
    }
  }

  async function onCreateIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setIconUrl(null);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      setIconUrl(await uploadGroupIcon(file));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function onEditIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      setEditIconUrl(await uploadGroupIcon(file));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function onCreateBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setBannerUrl(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      setBannerUrl(await uploadGroupBanner(file));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function onEditBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      setEditBannerUrl(await uploadGroupBanner(file));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function beginEdit(group: Group) {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditPrivacy(group.privacy ?? 'PRIVATE');
    setEditIconUrl(group.iconUrl ?? null);
    setEditBannerUrl(group.bannerUrl ?? null);
  }

  function cancelEdit() {
    setEditingGroupId(null);
    setEditName('');
    setEditPrivacy('PRIVATE');
    setEditIconUrl(null);
    setEditBannerUrl(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingGroupId || !editName) return;
    setSavingEdit(true);
    try {
      const updated = await api<Group>(`/groups/${editingGroupId}`, {
        method: 'PATCH',
        body: { name: editName, privacy: editPrivacy, iconUrl: editIconUrl, bannerUrl: editBannerUrl },
      });
      setMine((groups) => groups.map((group) => (group.id === updated.id ? updated : group)));
      cancelEdit();
      await loadGroups();
    } finally {
      setSavingEdit(false);
    }
  }

  const visibleGroups = groupView === 'mine' ? mine : publicGroups;

  return (
    <section className="group-browser">
      <div className="group-browser__toolbar">
        <div className="group-switcher">
          <button type="button" className={groupView === 'mine' ? 'active' : ''} onClick={() => setGroupView('mine')}>Mis grupos</button>
          <button type="button" className={groupView === 'public' ? 'active' : ''} onClick={() => setGroupView('public')}>Publicos</button>
        </div>
      </div>

      {createComposerOpen ? (
        <>
          <button type="button" className="feed-composer-backdrop" aria-label="Cerrar creacion de grupo" onClick={() => setCreateComposerOpen(false)} />
          <div className="feed-composer-sheet group-composer-sheet">
            <div className="feed-composer-sheet__handle" />
            <form onSubmit={createGroup} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#97fbff]">Nuevo grupo</div>
                  <div className="mt-1 text-sm text-white/68">Crea un grupo desde este popup, como el composer del inicio.</div>
                </div>
                <button type="button" className="icon-btn" aria-label="Cerrar popup de grupo" onClick={() => setCreateComposerOpen(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex items-start gap-4">
                <div className="group-create-studio__preview">
                  {iconUrl ? (
                    <img src={resolveAttachmentUrl(iconUrl)} alt="Vista previa del grupo" className="h-full w-full object-cover" />
                  ) : (
                    <span>{name.slice(0, 2).toUpperCase() || 'GR'}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <input placeholder="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <select
                      value={privacy}
                      onChange={(e) => setPrivacy(e.target.value as GroupPrivacy)}
                      className="w-full rounded-xl border border-[#1f2533] bg-[#101521] px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value="PRIVATE">Privado</option>
                      <option value="PUBLIC_INVITE">Público</option>
                      <option value="SECRET">Secreto</option>
                    </select>
                    <label className="group-command-pill cursor-pointer !justify-center !px-4" aria-label="Subir imagen del grupo">
                      <input type="file" accept="image/*" className="hidden" onChange={onCreateIconChange} />
                      <GalleryTinyIcon />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-white/55">
                <span>{uploading ? 'Subiendo portada...' : 'Portada opcional hasta 2 MB.'}</span>
                <button className="primary whitespace-nowrap" disabled={creating || uploading || !name}>
                  {creating ? 'Creando...' : 'Crear grupo'}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}

      {editingGroupId ? (
        <form onSubmit={saveEdit} className="group-create-studio glass-card space-y-4 mt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#ff97ff]">Control deck</div>
              <h2 className="mt-1 text-sm font-semibold text-white/90">Editar identidad del grupo</h2>
            </div>
            <button type="button" className="text-xs text-white/55" onClick={cancelEdit}>
              Cancelar
            </button>
          </div>
          <div className="flex gap-3 items-center">
            <div className="group-create-studio__preview">
              {editIconUrl ? (
                <img src={resolveAttachmentUrl(editIconUrl)} alt="Icono del grupo" className="h-full w-full object-cover" />
              ) : (
                <span>{editName.slice(0, 2).toUpperCase() || 'GR'}</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre del grupo" />
              <div className="flex gap-2">
                <select
                  value={editPrivacy}
                  onChange={(e) => setEditPrivacy(e.target.value as GroupPrivacy)}
                  className="w-full rounded-xl border border-[#1f2533] bg-[#101521] px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="PRIVATE">Privado</option>
                  <option value="PUBLIC_INVITE">Público</option>
                  <option value="SECRET">Secreto</option>
                </select>
                <label className="group-command-pill cursor-pointer !justify-center !px-4" aria-label="Cambiar imagen del grupo">
                  <input type="file" accept="image/*" className="hidden" onChange={onEditIconChange} />
                  <GalleryTinyIcon />
                </label>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-white/55">
            <span>{uploading ? 'Subiendo imagen...' : 'Puedes cambiar privacidad e imagen.'}</span>
            <button className="primary whitespace-nowrap" disabled={savingEdit || uploading || !editName}>
              {savingEdit ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      ) : null}

      {visibleGroups.length === 0 ? (
        <div className="glass-card text-sm opacity-70">{groupView === 'mine' ? 'Todavia no tienes grupos.' : 'No hay grupos publicos disponibles ahora mismo.'}</div>
      ) : (
        <div className="group-scroll-grid">
          {visibleGroups.map((group) => (
            <GroupTile
              key={group.id}
              group={group}
              ownerDisplayName={getGroupOwnerLabel(group, user?.displayName)}
              action={
                groupView === 'mine' ? (
                  <div className="flex gap-2">
                    <Link href={`/app/groups/${group.id}`} className="primary w-full text-center py-3 text-sm">
                      Abrir
                    </Link>
                    {group.ownerId === user?.id ? (
                      <button className="icon-btn" onClick={() => beginEdit(group)} aria-label={`Editar ${group.name}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                          <path d="M4 20h4l10-10a2.1 2.1 0 10-4-4L4 16v4z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button type="button" className="primary w-full" disabled={joiningId === group.id} onClick={() => void joinGroup(group.id)}>
                    {joiningId === group.id ? 'Uniendo...' : 'Unirme'}
                  </button>
                )
              }
            />
          ))}
        </div>
      )}

      {groupView === 'mine' ? (
        <button
          type="button"
          className="feed-compose-fab group-compose-fab"
          onClick={() => setCreateComposerOpen(true)}
          aria-label="Crear grupo"
        >
          <GroupPlusTinyIcon />
        </button>
      ) : null}
    </section>
  );
}

function GroupTile({
  group,
  action,
  featured,
  ownerDisplayName,
}: {
  group: Group;
  action?: React.ReactNode;
  featured?: boolean;
  ownerDisplayName?: string;
}) {
  const memberCount = group.memberCount ?? 0;
  return (
    <div className={`group-card ${featured ? 'group-card--featured' : ''}`}>
      <div className="group-card__media">
        {group.iconUrl ? <img src={resolveAttachmentUrl(group.iconUrl)} alt={group.name} className="h-full w-full object-cover" /> : null}
        <div className="group-card__overlay" />
        <div className="group-card__halo" />
      </div>
      <div className="group-card__content">
        <div className="group-card__topline">
          <span className="group-card__privacy">{formatPrivacy(group.privacy)}</span>
          <span className="group-card__viewers"><EyeTinyIcon /> {memberCount}</span>
        </div>
        <div className="group-card__body">
          <div className="group-card__title">{group.name}</div>
          <div className="group-card__creator">Por: {ownerDisplayName ?? 'admin del grupo'}</div>
          <div className="group-card__slug">#{group.slug}</div>
          <div className="group-card__meta">
            <span>{group.channelSummary?.voice ?? 0} voz</span>
            <span>{group.channelSummary?.video ?? 0} video</span>
            <span>{formatGroupRole(group.currentUserRole)}</span>
          </div>
        </div>
        <div className="group-card__footer">
          <div className="group-card__signal">
            <CrownTinyIcon />
            <span>{featured ? 'Destacado' : `${group.moderatorsCount ?? 0} staff`}</span>
          </div>
          <div className="group-card__actions">{action ?? <div className="text-xs text-white/45">Abrir grupo</div>}</div>
        </div>
      </div>
    </div>
  );
}

function getGroupOwnerLabel(group: Group, ownDisplayName?: string | null) {
  if (group.owner?.displayName) {
    return group.ownerId === useAuth.getState().user?.id ? ownDisplayName ?? 'Tú' : group.owner.displayName;
  }
  if (ownDisplayName && group.ownerId) return group.ownerId === useAuth.getState().user?.id ? ownDisplayName : 'admin del grupo';
  return group.ownerId === useAuth.getState().user?.id ? 'Tú' : 'admin del grupo';
}

function formatGroupRole(role?: Group['currentUserRole']) {
  if (role === 'GROUP_ADMIN') return 'Admin';
  if (role === 'GROUP_MODERATOR') return 'CoA';
  if (role === 'GROUP_MEMBER') return 'Miembro';
  return 'Invitado';
}

function EyeTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CrownTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="m4 8 4.1 4.2L12 6l3.9 6.2L20 8l-2 10H6L4 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GalleryTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="m7 15 3-3 2.5 2.5L15.5 11 18 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function StickerTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M7 4h10a3 3 0 0 1 3 3v7.5L14.5 20H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 20v-4a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="9" y="4" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M8.5 20h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function VideoTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="4" y="6" width="11" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15 10 5-2.5v9L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M12 3 5.5 5.8v5.7c0 4.2 2.7 7.8 6.5 9.5 3.8-1.7 6.5-5.3 6.5-9.5V5.8L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GroupPlusTinyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
      <path d="M9 13.5c2.2 0 4-1.8 4-4S11.2 5.5 9 5.5 5 7.3 5 9.5s1.8 4 4 4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 18.5c1.2-2.2 3-3.3 5.2-3.3s4 1.1 5.2 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.5 8v6M14.5 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function formatPrivacy(privacy?: GroupPrivacy) {
  if (privacy === 'PUBLIC_INVITE') return 'PUBLICO';
  if (privacy === 'SECRET') return 'SECRETO';
  return 'PRIVADO';
}

async function uploadGroupIcon(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ url: string | null }>('/groups/upload-icon', {
    method: 'POST',
    body: formData,
  });
  return normalizeMediaUrl(result.url);
}

async function uploadGroupBanner(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ url: string | null }>('/groups/upload-banner', {
    method: 'POST',
    body: formData,
  });
  return normalizeMediaUrl(result.url);
}

async function uploadUserAvatar(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ url: string | null }>('/users/upload-avatar', {
    method: 'POST',
    body: formData,
  });
  return normalizeMediaUrl(result.url);
}

/* -------------------- Perfil -------------------- */
function ProfileTab({
  viewedUserId,
  onOpenChats,
  onOpenConversation,
  onRelationshipChanged,
  onOpenProfile,
}: {
  viewedUserId?: string | null;
  onOpenChats: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRelationshipChanged: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const router = useRouter();
  const { user, logout, updateUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [invite, setInvite] = useState<{ code: string; usesCount: number; maxUses: number } | null>(null);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileImagePopupUrl, setProfileImagePopupUrl] = useState<string | null>(null);
  const [profilePostMenuId, setProfilePostMenuId] = useState<string | null>(null);
  const [relationshipModal, setRelationshipModal] = useState<{
    mode: 'followers' | 'following';
    items: ProfileRelationshipUser[];
    loading: boolean;
  } | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const targetUserId = viewedUserId ?? user?.id ?? null;
  const isOwnProfile = !!user?.id && targetUserId === user.id;

  useEffect(() => {
    if (!targetUserId) return;
    setLoading(true);
    setPostsLoading(true);
    setError(null);
    const profileRequest = api<UserProfile>(`/users/${targetUserId}`);
    const postsRequest = api<FeedPost[]>(`/posts?authorId=${encodeURIComponent(targetUserId)}&limit=24`);
    const ownDataRequest = isOwnProfile
      ? Promise.all([
          api<{ code: string; usesCount: number; maxUses: number }>('/invitations/me'),
          api<GroupsResponse>('/groups'),
        ])
      : Promise.resolve<[null, { mine: Group[]; public: Group[] }]>([null, { mine: [], public: [] }]);

    Promise.all([profileRequest, ownDataRequest, postsRequest])
      .then(([profileData, [inviteData, groupsData], postsData]) => {
        setProfile(profileData);
        setInvite(inviteData);
        setMyGroups(groupsData.mine);
        setPublicGroups(groupsData.public);
        setProfilePosts(postsData);
        if (isOwnProfile) {
          updateUser({ displayName: profileData.displayName, avatarUrl: profileData.avatarUrl ?? null });
        }
      })
        .catch(() => {
          setProfilePosts([]);
          setError('No se pudo cargar el perfil.');
        })
      .finally(() => {
        setLoading(false);
        setPostsLoading(false);
      });
  }, [isOwnProfile, targetUserId, updateUser]);

  useEffect(() => {
    if (!targetUserId) return;
    const socket = getSocket('/social');
    const onFeedPostCreated = (post: FeedPost) => {
      if (post.authorId !== targetUserId) return;
      setProfilePosts((current) => [post, ...current.filter((row) => row.id !== post.id)].slice(0, 24));
    };
    const onFeedPostUpdated = (post: FeedPost) => {
      if (post.authorId !== targetUserId) {
        setProfilePosts((current) => current.filter((row) => row.id !== post.id));
        return;
      }
      setProfilePosts((current) => {
        const exists = current.some((row) => row.id === post.id);
        return exists ? current.map((row) => row.id === post.id ? post : row) : [post, ...current].slice(0, 24);
      });
    };
    const onFeedPostDeleted = ({ id }: FeedPostDeletedEvent) => {
      setProfilePosts((current) => current.filter((row) => row.id !== id));
    };

    socket.on('feed_post_created', onFeedPostCreated);
    socket.on('feed_post_updated', onFeedPostUpdated);
    socket.on('feed_post_deleted', onFeedPostDeleted);
    return () => {
      socket.off('feed_post_created', onFeedPostCreated);
      socket.off('feed_post_updated', onFeedPostUpdated);
      socket.off('feed_post_deleted', onFeedPostDeleted);
    };
  }, [targetUserId]);

  async function onAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const avatarUrl = await uploadUserAvatar(file);
      if (!avatarUrl) throw new Error('Avatar upload failed');
      const updated = await api<{ id: string; displayName: string; avatarUrl: string | null }>('/users/me', {
        method: 'PATCH',
        body: { avatarUrl },
      });
      updateUser({ displayName: updated.displayName, avatarUrl: updated.avatarUrl });
      setProfile((current) => (current ? { ...current, displayName: updated.displayName, avatarUrl: updated.avatarUrl } : current));
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        setError('La foto es demasiado pesada. Usa una imagen de hasta 8 MB.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Tu sesión expiró. Recarga la app e inténtalo otra vez.');
      } else {
        setError('No se pudo actualizar la foto de perfil.');
      }
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  }

  async function toggleFollow() {
    if (!profile || isOwnProfile) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${profile.id}/follow`, { method: profile.isFollowing ? 'DELETE' : 'POST' });
      const refreshed = await api<UserProfile>(`/users/${profile.id}`);
      setProfile(refreshed);
      onRelationshipChanged();
    } catch {
      setError('No se pudo actualizar el seguimiento.');
    } finally {
      setBusy(false);
    }
  }

  async function startConversation() {
    if (!profile || isOwnProfile) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api<ConversationSummary>(`/dm/open/${profile.id}`, { method: 'POST' });
      onRelationshipChanged();
      onOpenConversation(conversation.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('No puedes iniciar conversación con este usuario.');
      } else {
        setError('No se pudo abrir la conversación.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function reportProfilePost(postId: string, authorName: string) {
    const reason = window.prompt(`Cuéntanos por qué quieres reportar la publicación de @${authorName}`)?.trim();
    if (!reason) return;
    try {
      await api(`/posts/${postId}/report`, { method: 'POST', body: { reason } });
      setProfilePostMenuId(null);
      setError('Reporte enviado.');
    } catch {
      setError('No se pudo reportar la publicación.');
    }
  }

  async function deleteProfilePost(postId: string) {
    if (!window.confirm('¿Eliminar esta publicación?')) return;
    try {
      await api(`/posts/${postId}`, { method: 'DELETE' });
      setProfilePosts((current) => current.filter((row) => row.id !== postId));
      setProfilePostMenuId(null);
    } catch {
      setError('No se pudo eliminar la publicación.');
    }
  }

  async function openRelationshipModal(mode: 'followers' | 'following') {
    if (!targetUserId) return;
    setRelationshipModal({ mode, items: [], loading: true });
    try {
      const items = await api<ProfileRelationshipUser[]>(`/users/${targetUserId}/${mode}`);
      setRelationshipModal({ mode, items, loading: false });
    } catch {
      setRelationshipModal({ mode, items: [], loading: false });
      setError(`No se pudo cargar la lista de ${mode === 'followers' ? 'seguidores' : 'seguidos'}.`);
    }
  }

  const displayName = profile?.displayName ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Usuario';
  const avatarUrl = isOwnProfile ? profile?.avatarUrl ?? user?.avatarUrl ?? null : profile?.avatarUrl ?? null;
  const invitationUsage = invite ? `${invite.usesCount}/${invite.maxUses}` : '--';
  const ownedGroups = isOwnProfile ? myGroups.filter((group) => group.ownerId === user?.id) : [];
  const groupsCount = ownedGroups.length;
  const roleLabel = (isOwnProfile ? user?.globalRole : profile?.globalRole) ?? 'USER';
  const emailLabel = isOwnProfile ? user?.email ?? 'sin-correo@app.chat' : `${profile?.followersCount ?? 0} seguidores`;
  const profileState = isOwnProfile ? 'Perfil activo y sincronizado' : profile?.followsYou ? 'Este usuario tambien te sigue' : 'Perfil publico y disponible';
  const showMyGroups = isOwnProfile && ownedGroups.length > 0;
  const followersCount = profile?.followersCount ?? 0;
  const followingCount = profile?.followingCount ?? 0;
  const inviteTitle = isOwnProfile ? 'Invitacion' : 'Estado';
  const inviteValue = isOwnProfile ? invite?.code ?? '------' : profile?.followsYou ? 'Te sigue' : 'Publico';
  const inviteMeta = isOwnProfile ? invitationUsage : roleLabel;

  return (
    <section className="relative overflow-hidden px-[10px] pb-8 pt-1">
      <div className="pointer-events-none absolute inset-x-[-18%] top-[-110px] h-[200px] rounded-full bg-[#66ffd9]/8 blur-[92px]" />
      <div className="pointer-events-none absolute right-[-18%] top-[110px] h-[220px] w-[220px] rounded-full bg-[#b026ff]/10 blur-[108px]" />

      <div className="relative mx-auto max-w-[344px] pt-1">
        <div className="relative rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(22,28,38,.86),rgba(14,18,27,.94))] px-3.5 pb-3.5 pt-3.5 shadow-[0_16px_36px_rgba(0,0,0,.34)] backdrop-blur-[14px]">
          <div className="pointer-events-none absolute inset-x-[14%] top-3 h-20 rounded-full bg-[#7bffc8]/7 blur-[52px]" />

          {isOwnProfile ? (
            <button
              type="button"
              onClick={() => setProfileMenuOpen((current) => !current)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] backdrop-blur-sm"
              aria-label="Opciones de perfil"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" className="text-white/72">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          ) : null}

          {profileMenuOpen ? (
            <div className="absolute right-3 top-12 z-20 w-[200px] overflow-hidden rounded-[20px] border border-white/12 bg-[#1a1f2e] shadow-[0_16px_40px_rgba(0,0,0,.5)] backdrop-blur-[16px]">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  logout().then(() => router.replace('/login'));
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-white/88 hover:bg-white/5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="text-white/64">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                cerrar sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  avatarInputRef.current?.click();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-white/88 hover:bg-white/5"
                disabled={uploadingAvatar}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="text-white/64">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {uploadingAvatar ? 'Subiendo...' : 'cambiar foto'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setError('Esta función estará disponible pronto.');
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-white/88 hover:bg-white/5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="text-white/64">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                editar biografía
              </button>
            </div>
          ) : null}

          <div className="relative flex flex-col items-center text-center">
            <div className="relative shrink-0">
              <div className="absolute inset-[-6px] rounded-full border border-[#7ff9dc]/38 shadow-[0_0_18px_rgba(0,255,204,.14)]" />
              <UserAvatar displayName={displayName} avatarUrl={avatarUrl} size={110} className="rounded-full border-2 border-white/15 bg-[#182122] shadow-[0_12px_28px_rgba(0,0,0,.28)]" />
            </div>

            <div className="mt-3 w-full">
              <div className="text-[22px] font-bold leading-none text-white">@{displayName}</div>
              <div className="mt-1.5 text-[12px] text-white/56">{emailLabel}</div>
              <div className="mt-2 inline-block rounded-full border border-[#8fffe7]/25 bg-[#8fffe7]/6 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#befff1]">
                {roleLabel}
              </div>
            </div>

            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>

          {!isOwnProfile ? (
            <div className="relative mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className="h-11 rounded-[20px] border border-[#62f5d7]/35 bg-[#62f5d7]/12 px-4 text-[14px] font-bold text-[#8fffe7]"
                onClick={() => void toggleFollow()}
                disabled={busy}
              >
                {busy ? 'Procesando...' : profile?.isFollowing ? 'Dejar de seguir' : 'Seguir'}
              </button>
              <button
                type="button"
                className="h-11 rounded-[20px] border border-white/10 bg-white/[0.06] px-4 text-[14px] font-medium text-white/84"
                onClick={() => void startConversation()}
                disabled={busy}
              >
                Chat
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-3 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,.84),rgba(12,16,24,.94))] px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,.28)] backdrop-blur-[14px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/48">Conexiones</div>
          <button
            type="button"
            onClick={() => void openRelationshipModal('followers')}
            className="mt-2 text-left"
          >
            <div className="text-[20px] font-semibold text-white">{followersCount} Seguidores <span className="text-white/34">•</span> {followingCount} Seguidos</div>
          </button>
        </div>

        <div className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
          <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,.84),rgba(12,16,24,.94))] px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,.28)] backdrop-blur-[14px]">
            <div className="text-center">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/48">{inviteTitle}</div>
              <div className="mt-2 font-mono text-[20px] font-bold uppercase tracking-[0.08em] text-[#c7fff2]">{inviteValue}</div>
              <div className="mt-1.5 text-[11px] text-white/54">{inviteMeta}</div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,.84),rgba(12,16,24,.94))] px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,.28)] backdrop-blur-[14px]">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/48">Reputación</div>
            <div className="mt-2 text-[14px] font-medium leading-snug text-white/88">{profileState}</div>
          </div>
        </div>

        {relationshipModal ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm" onClick={() => setRelationshipModal(null)}>
            <div className="w-full max-w-[420px] rounded-[28px] border border-white/10 bg-[#0f1520] shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-white/38">Lista</div>
                  <div className="text-sm font-semibold text-white/90">{relationshipModal.mode === 'followers' ? 'Seguidores' : 'Seguidos'}</div>
                </div>
                <button type="button" className="icon-btn" onClick={() => setRelationshipModal(null)} aria-label="Cerrar lista">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
                {relationshipModal.loading ? <div className="px-2 py-6 text-sm text-white/62">Cargando...</div> : null}
                {!relationshipModal.loading && relationshipModal.items.length === 0 ? <div className="px-2 py-6 text-sm text-white/55">No hay usuarios en esta lista.</div> : null}
                {!relationshipModal.loading
                  ? relationshipModal.items.map((person) => (
                      <button
                        key={`${relationshipModal.mode}-${person.id}`}
                        type="button"
                        onClick={() => {
                          setRelationshipModal(null);
                          onOpenProfile(person.id);
                        }}
                        className="flex w-full items-center gap-3 rounded-[18px] px-2 py-2 text-left hover:bg-white/5"
                      >
                        <UserAvatar displayName={person.displayName} avatarUrl={person.avatarUrl} size={42} className="rounded-[14px]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white/88">@{person.displayName}</div>
                          <div className="mt-1"><BadgeRow badges={person.badges} /></div>
                        </div>
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </div>
        ) : null}

        {isOwnProfile ? (
          <div className="relative mt-2.5 overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,.84),rgba(12,16,24,.94))] px-4 pb-4 pt-4 shadow-[0_14px_34px_rgba(0,0,0,.28)] backdrop-blur-[14px]">
          <div className="relative z-10">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/48">Grupos</div>

            {showMyGroups ? (
              <div className="mb-3">
                <div className="mb-2 text-[13px] font-medium text-white/64">Mis grupos ({groupsCount})</div>
                <div className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1">
                  {ownedGroups.map((group) => (
                    <Link
                      key={group.id}
                      href={`/app/groups/${group.id}`}
                      className="flex min-w-[112px] snap-start flex-col items-center rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-4 text-center backdrop-blur-[12px]"
                    >
                      <div className="mb-2.5 flex h-9 w-9 items-center justify-center overflow-hidden rounded-[12px] border border-white/12 bg-[#161c26] text-[12px] font-bold text-[#d4fff4]">
                        {group.iconUrl ? (
                          <img src={group.iconUrl} alt={group.name} className="h-full w-full object-cover" />
                        ) : (
                          group.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="w-full truncate text-[11px] font-bold uppercase tracking-[0.04em] text-white">{group.name}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="relative mx-auto mt-6 w-[160px] rounded-[18px] border border-dashed border-white/14 bg-white/[0.03] px-3 py-4 text-center text-[10px] text-white/65 backdrop-blur-[10px]">
                Sin grupos todavia
              </div>
            )}
          </div>
        </div>
        ) : (
          <div className="relative mt-2 overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,.84),rgba(12,16,24,.94))] px-3.5 py-4 text-center text-[10px] text-white/70 shadow-[0_14px_34px_rgba(0,0,0,.28)] backdrop-blur-[14px]">
            Interactua con este perfil desde los botones superiores.
            </div>
        )}

        <div className="relative mt-2 overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(21,26,40,.58),rgba(12,16,26,.76))] px-3.5 py-4 shadow-[0_16px_40px_rgba(0,0,0,.34)] backdrop-blur-[14px]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/82">Posts</div>
            <div className="text-[10px] text-white/45">{postsLoading ? '...' : profilePosts.length}</div>
          </div>

          {postsLoading ? (
            <div className="text-[10px] text-white/62">Cargando posts...</div>
          ) : profilePosts.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-white/12 bg-white/[0.03] px-3 py-4 text-center text-[10px] text-white/62">
              Este perfil todavía no tiene posts.
            </div>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {profilePosts.map((post) => {
                const imageAttachment = post.attachments.find((attachment) => attachment.kind === 'image');
                const hasVoice = post.attachments.some((attachment) => attachment.kind === 'voice');
                const mine = post.authorId === user?.id;

                return (
                  <article key={post.id} className="relative min-w-[178px] max-w-[178px] rounded-[18px] border border-white/10 bg-white/[0.04] p-3 shadow-[0_10px_24px_rgba(0,0,0,.24)]">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        displayName={post.author.displayName}
                        avatarUrl={post.author.avatarUrl}
                        size={26}
                        className="rounded-[10px]"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenProfile(post.author.id);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px] font-semibold text-white/88">@{post.author.displayName}</div>
                        <div className="text-[9px] text-white/45">{formatShortTime(post.createdAt)}</div>
                      </div>
                      <button type="button" className="icon-btn !h-7 !w-7 !rounded-[10px]" aria-label="Opciones del post" onClick={() => setProfilePostMenuId((current) => current === post.id ? null : post.id)}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                          <circle cx="5" cy="12" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="19" cy="12" r="1.7" />
                        </svg>
                      </button>
                    </div>

                    {profilePostMenuId === post.id ? (
                      <div className="absolute right-3 top-12 z-20 w-44 rounded-2xl border border-white/10 bg-[#151d2a] p-2 shadow-2xl">
                        {mine ? (
                          <button className="w-full rounded-xl px-3 py-2 text-left text-sm text-red-300 hover:bg-white/5" onClick={() => void deleteProfilePost(post.id)}>
                            Eliminar publicación
                          </button>
                        ) : (
                          <button className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => void reportProfilePost(post.id, post.author.displayName)}>
                            Reportar publicación
                          </button>
                        )}
                      </div>
                    ) : null}

                    {imageAttachment ? (
                      <button type="button" className="mt-2 block w-full" onClick={() => setProfileImagePopupUrl(resolveAttachmentUrl(imageAttachment.url))}>
                        <img src={resolveAttachmentUrl(imageAttachment.url)} alt={imageAttachment.fileName ?? 'Post'} className="h-[84px] w-full rounded-[14px] object-cover" />
                      </button>
                    ) : hasVoice ? (
                      <div className="mt-2 flex h-[84px] items-center justify-center rounded-[14px] border border-white/8 bg-black/15 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">
                        Audio
                      </div>
                    ) : null}

                    {post.content ? (
                      <p className="mt-2 text-[11px] leading-[1.35] text-white/80" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {post.content}
                      </p>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2 text-[10px] text-white/52">
                      <span>{post.likeCount} likes</span>
                      <span>{post.comments.length} comentarios</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {error ? <div className="mt-3 px-1 text-sm text-red-300">{error}</div> : null}
      </div>

      {profileImagePopupUrl ? (
        <button type="button" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setProfileImagePopupUrl(null)}>
          <img src={profileImagePopupUrl} alt="Vista completa" className="max-h-[88vh] w-auto max-w-full rounded-[24px] object-contain" />
        </button>
      ) : null}
    </section>
  );
}

/* -------------------- Bottom nav -------------------- */
function BottomNav({ tab, setTab, pendingChatsCount }: { tab: Tab; setTab: (t: Tab) => void; pendingChatsCount: number }) {
  const user = useAuth((state) => state.user);
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'feed',
      label: 'Publicaciones',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M4 10h16M9 4v16" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'chats',
      label: 'Chats',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path
            d="M21 12a8 8 0 11-3.6-6.7L21 4l-1.3 3.6A8 8 0 0121 12z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      id: 'groups',
      label: 'Grupos',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="3.5" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 19c0-2 2-4 4-4s2.5 1.5 2.5 3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'profile',
      label: 'Perfil',
      icon: <UserAvatar displayName={user?.displayName ?? user?.email} avatarUrl={user?.avatarUrl} size={22} className="rounded-[8px] border-white/10" />,
    },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((it) => (
        <button
          key={it.id}
          aria-label={it.label}
          className={tab === it.id ? 'active' : ''}
          onClick={() => setTab(it.id)}
        >
          <span className="relative inline-flex">
            {it.icon}
            {it.id === 'chats' && pendingChatsCount > 0 ? (
              <span className="absolute -right-2 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff4343] text-white text-[10px] leading-[18px] text-center font-bold">
                {pendingChatsCount > 9 ? '9+' : pendingChatsCount}
              </span>
            ) : null}
          </span>
          <span className="sr-only">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
