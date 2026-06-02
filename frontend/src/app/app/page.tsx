'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api-client';
import { normalizeMediaUrl, resolveMediaUrl } from '@/lib/media-url';
import { getSocket } from '@/lib/socket-client';
import { useAuth } from '@/store/auth.store';
import ChatsView from '@/features/chats/ChatsView';

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
  reputationScore?: number;
  reputationLikes?: number;
  reputationDislikes?: number;
  userVoteType?: 1 | -1 | null;
  isOnline?: boolean;
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
  authorId?: string;
  authorAvatarUrl?: string | null;
  createdAt?: string;
  likeCount?: number;
  likedByMe?: boolean;
  replies?: Array<{
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    authorAvatarUrl?: string | null;
    createdAt?: string;
  }>;
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
  isOnline,
}: {
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  isOnline?: boolean;
}) {
  const initials = (displayName ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="relative shrink-0">
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
      {isOnline !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0f1520] ${
            isOnline ? 'bg-[#3beb75] shadow-[0_0_6px_rgba(59,235,117,.4)]' : 'bg-[#6b7280]'
          }`}
          style={{ width: Math.max(10, Math.round(size * 0.22)), height: Math.max(10, Math.round(size * 0.22)) }}
        />
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
  const [unreadDmsCount, setUnreadDmsCount] = useState(0);
  const [liveDmNotice, setLiveDmNotice] = useState<LiveDmNotice | null>(null);
  const [liveInteractionNotice, setLiveInteractionNotice] = useState<LiveInteractionNotice | null>(null);
  const [openGroupCreatorOnTabChange, setOpenGroupCreatorOnTabChange] = useState(false);
  const tabRef = useRef<Tab>('feed');
  const selectedConvRef = useRef<string | null>(null);

  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { selectedConvRef.current = selectedConversationId; }, [selectedConversationId]);

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
      return;
    }

    const nextTab = searchParams.get('tab');
    if (nextTab === 'feed' || nextTab === 'chats' || nextTab === 'groups' || nextTab === 'profile') {
      setTab(nextTab);
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
      if (tabRef.current !== 'chats' || selectedConvRef.current !== payload.conversationId) {
        setUnreadDmsCount((c) => c + 1);
      }
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
    router.push(`/app?tab=profile&profileUserId=${encodeURIComponent(userId)}`);
  }

  function handleSelectTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab === 'chats') {
      setUnreadDmsCount(0);
    }
    if (nextTab === 'profile') {
      setProfileUserId(user?.id ?? null);
      if (user?.id) {
        router.push(`/app?tab=profile&profileUserId=${encodeURIComponent(user.id)}`);
        return;
      }
    }
    router.push(nextTab === 'feed' ? '/app?tab=feed' : `/app?tab=${nextTab}`);
  }

  function handleOpenConversation(conversationId: string) {
    setTab('chats');
    router.push('/app?tab=chats');
    setSelectedConversationId(conversationId);
    setConversationRefreshToken((current) => current + 1);
    void refreshPendingChatsCount();
    setUnreadDmsCount(0);
  }

  function handleConversationChanged() {
    setConversationRefreshToken((current) => current + 1);
    void refreshPendingChatsCount();
  }

  return (
    <div className="app-shell">
      {tab === 'groups' ? <TopBar onOpenProfile={handleOpenProfile} currentTab={tab} /> : null}

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
          selectedConversationId ? (
            <ChatsTab
              selectedConversationId={selectedConversationId}
              refreshToken={conversationRefreshToken}
              onSelectConversation={setSelectedConversationId}
              onOpenProfile={handleOpenProfile}
              onConversationChanged={handleConversationChanged}
            />
          ) : (
            <ChatsView
              selectedConversationId={selectedConversationId}
              refreshToken={conversationRefreshToken}
              onSelectConversation={setSelectedConversationId}
              onOpenProfile={handleOpenProfile}
              onConversationChanged={handleConversationChanged}
            />
          )
        ) : null}
        {tab === 'groups' ? (
          <GroupsTab
            openCreatorOnMount={openGroupCreatorOnTabChange}
            onCreatorOpened={() => setOpenGroupCreatorOnTabChange(false)}
          />
        ) : null}
        {tab === 'profile' ? (
          <ProfileTab
            viewedUserId={profileUserId}
            onOpenChats={() => setTab('chats')}
            onOpenConversation={handleOpenConversation}
            onRelationshipChanged={() => void refreshPendingChatsCount()}
            onOpenProfile={handleOpenProfile}
            onOpenGroupCreator={() => {
              setOpenGroupCreatorOnTabChange(true);
              setTab('groups');
            }}
          />
        ) : null}
      </main>

      <BottomNav tab={tab} setTab={handleSelectTab} pendingChatsCount={pendingChatsCount} unreadDmsCount={unreadDmsCount} />
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
  const [activeFriendsCount, setActiveFriendsCount] = useState(0);
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
    if (!user?.id) return;
    const socket = getSocket('/presence');
    const onlineIds = new Set<string>();
    const onPresence = (payload: { userId: string; online: boolean }) => {
      if (payload.online) {
        onlineIds.add(payload.userId);
      } else {
        onlineIds.delete(payload.userId);
      }
      setActiveFriendsCount(onlineIds.size);
    };
    socket.on('presence', onPresence);
    socket.emit('presence:subscribe', { userId: user.id });
    return () => {
      socket.off('presence', onPresence);
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
    <header className="app-topbar">
      <div className="app-topbar-left">
        <div className="app-topbar-avatar">
          <button
            type="button"
            aria-label="Abrir mi perfil"
            onClick={() => { if (user?.id) onOpenProfile(user.id); }}
            className="block w-full h-full"
          >
            <img
              src={user?.avatarUrl ? resolveAttachmentUrl(user.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName ?? user?.email ?? 'U')}&background=4d26b3&color=fff&bold=true`}
              alt={user?.displayName ?? 'Avatar'}
            />
          </button>
          <span className="online-dot" />
        </div>
        <div className="app-topbar-greeting">
          <div className="greeting-text">{getGreeting()},</div>
          <div className="greeting-name">@{user?.displayName ?? user?.email?.split('@')[0] ?? 'usuario'} 👋</div>
          <div className="greeting-active">{activeFriendsCount > 0 ? `${activeFriendsCount} amigos activos ahora` : 'Conectado'}</div>
        </div>
      </div>
      <div className="app-topbar-actions">
        <button className="icon-btn relative" aria-label="Notificaciones" onClick={() => void toggleNotifications()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M12 4a4 4 0 00-4 4v2.4c0 .72-.2 1.42-.58 2.03L6 15h12l-1.42-2.57a4.04 4.04 0 01-.58-2.03V8a4 4 0 00-4-4z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 18a2 2 0 004 0" strokeLinecap="round" />
          </svg>
          {unreadNotifications > 0 ? <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[#4d26b3] px-1 py-0.5 text-[9px] font-bold leading-none text-white">{Math.min(99, unreadNotifications)}</span> : null}
        </button>
        <button className="icon-btn" aria-label="Buscar" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {notificationsOpen ? (
        <div className="absolute right-3 top-full mt-2 z-50 w-[min(320px,calc(100vw-32px))] max-h-[300px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1126]/95 p-2 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="text-sm font-semibold text-white/90">Notificaciones</div>
            <button className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55 hover:text-white" onClick={() => void markAllNotificationsRead()}>
              Marcar todo
            </button>
          </div>
          {notifications.length === 0 ? <div className="px-3 py-6 text-sm text-white/55">Todavía no tienes notificaciones.</div> : null}
          {notifications.slice(0, 5).map((notification) => (
            <button
              key={notification.id}
              className={`flex w-full items-start gap-2 rounded-2xl px-2 py-2 text-left hover:bg-white/5 ${notification.isRead ? 'opacity-75' : ''}`}
              onClick={() => void markNotificationRead(notification.id)}
            >
              <UserAvatar
                displayName={notification.actor?.displayName ?? 'Actividad'}
                avatarUrl={notification.actor?.avatarUrl}
                size={32}
                className="rounded-[10px]"
                onClick={notification.actor?.id ? (event) => {
                  event.stopPropagation();
                  onOpenProfile(notification.actor!.id!);
                } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-sm font-semibold text-white/90">{notification.title}</div>
                  {!notification.isRead ? <span className="h-2 w-2 rounded-full bg-[#4d26b3] shrink-0" /> : null}
                </div>
                <div className="mt-0.5 text-xs text-white/62 line-clamp-1">{notification.body}</div>
              </div>
            </button>
          ))}
          <button type="button" onClick={() => { setNotificationsOpen(false); router.push('/notifications'); }} className="block w-full text-center text-[11px] text-[#4d26b3] font-semibold pt-2 pb-1 hover:underline bg-transparent border-none cursor-pointer">Ver todas →</button>
        </div>
      ) : null}

      {open && canSearch ? (
        <div className="absolute left-3 right-3 top-full mt-2 z-50 rounded-2xl border border-white/10 bg-[#0e1126]/95 backdrop-blur shadow-2xl overflow-hidden">
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

/* ========== NUEVO FEED TAB REDISEÑADO ========== */

function OnlineDot({ online }: { online: boolean }) {
  return <span className={online ? 'online-dot' : 'offline-dot'} />;
}

function FriendAvatar({ name, avatarUrl, online, onClick }: { name: string; avatarUrl?: string | null; online: boolean; onClick?: () => void }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="friend-avatar-wrapper" onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' && onClick) onClick(); }} role="button" tabIndex={0}>
      <div className="shrink-0 overflow-hidden flex items-center justify-center bg-[#101521] border border-white/10 text-white/90"
        style={{ width: 44, height: 44, borderRadius: 14, fontSize: 14 }}>
        {avatarUrl ? (
          <img src={resolveAttachmentUrl(avatarUrl)} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="font-semibold">{initials}</span>
        )}
      </div>
      <OnlineDot online={online} />
      <div className="friend-name">{name}</div>
    </div>
  );
}

function InterestPerson({ name, avatarUrl, online, onClick }: { name: string; avatarUrl?: string | null; online: boolean; onClick?: () => void }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="interest-person" onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' && onClick) onClick(); }} role="button" tabIndex={0}>
      <div className="avatar-wrapper">
        <div className="shrink-0 overflow-hidden flex items-center justify-center bg-[#101521] border border-white/10 text-white/90"
          style={{ width: 52, height: 52, borderRadius: 16, fontSize: 16 }}>
          {avatarUrl ? (
            <img src={resolveAttachmentUrl(avatarUrl)} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span className="font-semibold">{initials}</span>
          )}
        </div>
        <OnlineDot online={online} />
      </div>
      <div className="person-name">{name}</div>
    </div>
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
  const [openReplyCommentId, setOpenReplyCommentId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [commentLikePending, setCommentLikePending] = useState<Set<string>>(new Set());
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const remainingChars = POST_CONTENT_MAX_LENGTH - composer.length;

  // --- Nuevo estado para el feed rediseñado ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [groupSearchResults, setGroupSearchResults] = useState<Group[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showActivePeople, setShowActivePeople] = useState(false);
  const [activePeople, setActivePeople] = useState<Array<{ id: string; displayName: string; avatarUrl?: string | null }>>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [friends, setFriends] = useState<Array<{ id: string; displayName: string; avatarUrl?: string | null }>>([]);
  const [topUsers, setTopUsers] = useState<Array<{ id: string; displayName: string; avatarUrl?: string | null; reputationScore: number }>>([]);
  const [interestPeople, setInterestPeople] = useState<Array<{ id: string; displayName: string; avatarUrl?: string | null }>>([]);
  const [activeFilter, setActiveFilter] = useState<'todos' | 'amigos' | 'tendencia'>('todos');
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // Cargar datos iniciales
  async function loadInitialData() {
    try {
      const [postsData, notifsData, unreadData] = await Promise.all([
        api<FeedPost[]>('/posts'),
        api<NotificationItem[]>('/notifications?limit=5'),
        api<{ count: number }>('/notifications/unread-count'),
      ]);
      setPosts(postsData);
      setNotifications(notifsData);
      setUnreadNotifications(unreadData.count);
    } catch {
      // partial fallback
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

  // Cargar amigos (usuarios que sigo)
  useEffect(() => {
    if (!user?.id) return;
    api<Array<{ id: string; displayName: string; avatarUrl?: string | null }>>(`/users/${user.id}/following`)
      .then((rows) => {
        // Filtrar el propio usuario por si acaso
        const mapped = rows.filter(r => r.id !== user.id).slice(0, 8).map((r) => ({
          id: r.id,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
        }));
        setFriends(mapped);
        setInterestPeople(mapped.slice(0, 6));
        setActivePeople(mapped.filter((p) => onlineUserIds.has(p.id)));
      })
      .catch(() => {});
  }, [user?.id]);

  // Cargar top 5 usuarios por reputación
  useEffect(() => {
    if (!user?.id) return;
    api<Array<{ id: string; displayName: string; avatarUrl?: string | null; reputationScore: number }>>('/users/top')
      .then((rows) => setTopUsers(rows))
      .catch(() => {});
  }, [user?.id]);

  // Socket events
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
    const onNotification = (payload: NotificationItem) => {
      if (!payload?.id) return;
      setUnreadNotifications((c) => c + (payload.isRead ? 0 : 1));
      setNotifications((current) => [payload, ...current.filter((n) => n.id !== payload.id)].slice(0, 20));
    };
    socket.on('feed_post_created', onFeedPostCreated);
    socket.on('feed_post_updated', onFeedPostUpdated);
    socket.on('feed_post_deleted', onFeedPostDeleted);
    socket.on('notification_new', onNotification);
    return () => {
      socket.off('feed_post_created', onFeedPostCreated);
      socket.off('feed_post_updated', onFeedPostUpdated);
      socket.off('feed_post_deleted', onFeedPostDeleted);
      socket.off('notification_new', onNotification);
    };
  }, []);

  // Presence en tiempo real
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket('/presence');
    const onPresence = (payload: { userId: string; online: boolean }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (payload.online) {
          next.add(payload.userId);
        } else {
          next.delete(payload.userId);
        }
        return next;
      });
    };
    socket.on('presence', onPresence);
    socket.emit('presence:subscribe', { userId: user.id });
    return () => {
      socket.off('presence', onPresence);
    };
  }, [user?.id]);

  // Search debounce
  useEffect(() => {
    const raw = searchQuery.trim().replace(/^@+/, '');
    if (!raw) {
      setSearchResults([]);
      setGroupSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      Promise.all([
        api<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(raw)}`).catch(() => []),
        api<GroupsResponse>('/groups').catch(() => ({ mine: [], public: [] })),
      ]).then(([users, groups]) => {
        setSearchResults(users);
        setGroupSearchResults([...groups.mine, ...groups.public].filter((g) =>
          g.name.toLowerCase().includes(raw.toLowerCase())
        ));
      }).finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  async function toggleCommentLike(postId: string, commentId: string) {
    if (commentLikePending.has(commentId)) return;
    setCommentLikePending((s) => new Set([...s, commentId]));
    try {
      const post = await api<FeedPost>(`/posts/${postId}/comments/${commentId}/like`, { method: 'POST' });
      setPosts((current) => current.map((row) => (row.id === post.id ? post : row)));
    } catch {
      setError('No se pudo dar like al comentario.');
    } finally {
      setCommentLikePending((s) => { const next = new Set(s); next.delete(commentId); return next; });
    }
  }

  async function submitReply(postId: string, commentId: string) {
    const draft = replyDrafts[commentId]?.trim() ?? '';
    if (!draft) return;
    try {
      const post = await api<FeedPost>(`/posts/${postId}/comments/${commentId}/replies`, {
        method: 'POST',
        body: { body: draft },
      });
      setPosts((current) => current.map((row) => (row.id === post.id ? post : row)));
      setReplyDrafts((current) => ({ ...current, [commentId]: '' }));
      setOpenReplyCommentId(null);
    } catch {
      setError('No se pudo enviar la respuesta.');
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
    <section className="feed-exact-container">
      {/* Inputs ocultos para adjuntar archivos */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={onPickAudio} />

      {/* ===== HEADER: SALUDO + AVATAR ===== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: 44, height: 44 }}>
            <button
              type="button"
              aria-label="Abrir mi perfil"
              onClick={() => { if (user?.id) onOpenProfile(user.id); }}
              style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', border: '2px solid #4d26b3', padding: 0, background: 'none', cursor: 'pointer' }}
            >
              <img
                src={user?.avatarUrl ? resolveAttachmentUrl(user.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName ?? user?.email ?? 'U')}&background=4d26b3&color=fff&bold=true`}
                alt={user?.displayName ?? 'Avatar'}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              />
            </button>
            <span style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, backgroundColor: '#2ecc71', border: '2px solid #060713', borderRadius: '50%' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#727693' }}>{getGreeting()},</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#f0f4ff' }}>@{user?.displayName ?? user?.email?.split('@')[0] ?? 'usuario'} 👋</div>
            <div style={{ fontSize: 11, color: '#4d26b3', fontWeight: 500, marginTop: 1 }}>{friends.filter(f => onlineUserIds.has(f.id)).length} amigos activos</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button type="button" aria-label="Notificaciones" onClick={() => setShowNotifications(!showNotifications)} style={{ background: '#11142a', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#727693" strokeWidth="1.8" width="18" height="18">
                <path d="M12 4a4 4 0 00-4 4v2.4c0 .72-.2 1.42-.58 2.03L6 15h12l-1.42-2.57a4.04 4.04 0 01-.58-2.03V8a4 4 0 00-4-4z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 18a2 2 0 004 0" strokeLinecap="round" />
              </svg>
              {unreadNotifications > 0 ? <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, borderRadius: 8, background: '#4d26b3', padding: '1px 4px', fontSize: 9, fontWeight: 700, lineHeight: '14px', color: '#fff' }}>{Math.min(99, unreadNotifications)}</span> : null}
            </button>
            {/* ===== NOTIFICACIONES (dropdown pequeño) ===== */}
            {showNotifications && (
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4, width: 'min(280px,calc(100vw - 32px))', maxHeight: 260, overflowY: 'auto', background: '#0e1126', borderRadius: 16, border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 8px 32px rgba(0,0,0,.5)', padding: 10, zIndex: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#f0f4ff' }}>Notificaciones</span>
                  <button type="button" onClick={() => { setNotifications((current) => current.map((item) => ({ ...item, isRead: true }))); setUnreadNotifications(0); api('/notifications/read-all', { method: 'POST' }).catch(() => {}); }} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#727693', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Marcar todo
                  </button>
                </div>
                {notifications.length === 0 ? <div style={{ padding: '6px 0', fontSize: 12, color: '#727693' }}>Todavía no tienes notificaciones.</div> : null}
                {notifications.slice(0, 3).map((n) => (
                  <button key={n.id} type="button" onClick={() => {
                    if (!n.isRead) {
                      setNotifications((current) => current.map((item) => item.id === n.id ? { ...item, isRead: true } : item));
                      setUnreadNotifications((current) => Math.max(0, current - 1));
                      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
                    }
                    if (n.postId) {
                      setShowNotifications(false);
                      setTimeout(() => {
                        const el = document.getElementById(`post-${n.postId}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }
                  }} style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: 8, padding: '8px 0', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', opacity: n.isRead ? 0.75 : 1, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <UserAvatar displayName={n.actor?.displayName ?? 'Actividad'} avatarUrl={n.actor?.avatarUrl} size={32} className="rounded-[10px]" />
                      {n.kind === 'POST_LIKED' ? (
                        <span style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#ff4d6d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff"><path d="M12 20.4 4.9 13.8A4.8 4.8 0 0 1 12 7.5a4.8 4.8 0 0 1 7.1 6.3L12 20.4Z"/></svg>
                        </span>
                      ) : n.kind === 'POST_COMMENTED' ? (
                        <span style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff"><path d="M7 17.2 3.8 20V6.9A2.9 2.9 0 0 1 6.7 4h10.6a2.9 2.9 0 0 1 2.9 2.9v7.4a2.9 2.9 0 0 1-2.9 2.9H7Z"/></svg>
                        </span>
                      ) : null}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#f0f4ff' }}>{n.title}</span>
                        {!n.isRead ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4d26b3', flexShrink: 0 }} /> : null}
                      </div>
                      <div style={{ fontSize: 11, color: '#727693', marginTop: 1, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</div>
                    </div>
                  </button>
                ))}
                <button type="button" onClick={() => { setShowNotifications(false); window.location.href = '/notifications'; }} style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: 11, color: '#4d26b3', fontWeight: 600, padding: '6px 0 0', background: 'none', border: 'none', cursor: 'pointer' }}>Ver todas →</button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar…"
              style={{ background: '#11142a', border: 'none', borderRadius: 18, padding: '8px 12px 8px 32px', fontSize: 13, color: '#f0f4ff', outline: 'none', width: 120 }}
            />
            <svg viewBox="0 0 24 24" fill="none" stroke="#727693" strokeWidth="1.8" width="14" height="14" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            {searchQuery.trim() && (
              <button type="button" onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#727693', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>×</button>
            )}
            {/* Resultados de búsqueda */}
            {searchQuery.trim() && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 260, background: '#11142a', borderRadius: 16, border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 8px 32px rgba(0,0,0,.5)', overflow: 'hidden', zIndex: 100 }}>
                {searchLoading ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#727693', fontSize: 13 }}>Buscando...</div>
                ) : searchResults.length === 0 && groupSearchResults.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#727693', fontSize: 13 }}>Sin resultados</div>
                ) : (
                  <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {searchResults.length > 0 && (
                      <div>
                        <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#727693' }}>Usuarios</div>
                        {searchResults.map((u) => (
                          <button key={u.id} type="button" onClick={() => { onOpenProfile(u.id); setSearchQuery(''); }} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                            <img src={u.avatarUrl ? resolveAttachmentUrl(u.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName)}&background=4d26b3&color=fff&size=24`} alt={u.displayName} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                            <span style={{ fontSize: 13, color: '#f0f4ff' }}>{u.displayName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {groupSearchResults.length > 0 && (
                      <div>
                        <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#727693' }}>Grupos</div>
                        {groupSearchResults.map((g) => (
                          <button key={g.id} type="button" onClick={() => { setSearchQuery(''); }} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                            <img src={g.iconUrl ? resolveAttachmentUrl(g.iconUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(g.name)}&background=2a1f5e&color=fff&size=24`} alt={g.name} style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} />
                            <span style={{ fontSize: 13, color: '#f0f4ff' }}>{g.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>



      {/* ===== TOP USERS POR REPUTACIÓN (reemplaza stories) ===== */}
      <div className="feed-exact-stories">
        {topUsers.length === 0 && friends.filter(p => p.id !== user?.id).slice(0, 8).map((person) => (
          <div key={person.id} className="feed-exact-story" onClick={() => onOpenProfile(person.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person.id); }} role="button" tabIndex={0}>
            <div className="feed-exact-story-ring">
              <img
                src={person.avatarUrl ? resolveAttachmentUrl(person.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(person.displayName)}&background=4d26b3&color=fff&bold=true`}
                alt={person.displayName}
              />
              {onlineUserIds.has(person.id) ? <span className="status-dot" /> : null}
            </div>
            <span className="feed-exact-story-name">{person.displayName.split(' ')[0]}</span>
          </div>
        ))}
        {topUsers.map((person) => (
          <div key={person.id} className="feed-exact-story" onClick={() => onOpenProfile(person.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person.id); }} role="button" tabIndex={0}>
            <div className="feed-exact-story-ring">
              <img
                src={person.avatarUrl ? resolveAttachmentUrl(person.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(person.displayName)}&background=4d26b3&color=fff&bold=true`}
                alt={person.displayName}
              />
              {onlineUserIds.has(person.id) ? <span className="status-dot" /> : null}
            </div>
            <span className="feed-exact-story-name">{person.displayName.split(' ')[0]}</span>
          </div>
        ))}
      </div>

      {/* ===== CREATE POST BOX - UNA SOLA LÍNEA CON ICONOS A LA DERECHA ===== */}
      <div style={{ background: '#0e1126', borderRadius: 20, padding: '10px 14px', margin: '0 14px', border: '1px solid transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
        <img
          src={user?.avatarUrl ? resolveAttachmentUrl(user.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName ?? 'U')}&background=4d26b3&color=fff&bold=true`}
          alt={user?.displayName ?? 'Avatar'}
          style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
        <input
          type="text"
          value={composer}
          onChange={(e) => setComposer(e.target.value.slice(0, POST_CONTENT_MAX_LENGTH))}
          placeholder="¿Qué estás pensando?"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && composer.trim()) { e.preventDefault(); void publishPost(); } }}
          style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 14, color: '#f0f4ff', outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => imageInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>
          <button type="button" onClick={() => audioInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M9 8h6M12 8v8" />
            </svg>
          </button>
          {composer.trim() || pendingAttachments.length > 0 ? (
            <>
              <span style={{ fontSize: 11, color: remainingChars < 20 ? '#ff6b6b' : '#727693', fontWeight: 500, flexShrink: 0 }}>{remainingChars}</span>
              <button type="button" onClick={() => void publishPost()} disabled={publishing} style={{ background: '#4d26b3', border: 'none', borderRadius: 10, padding: '5px 12px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: publishing ? 0.5 : 1 }}>
                {publishing ? '...' : 'Publicar'}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {pendingAttachments.length > 0 && (
        <div style={{ margin: '6px 14px 0', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {pendingAttachments.map((att, idx) => (
            <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
              {att.kind === 'image' ? (
                <img src={resolveAttachmentUrl(att.url)} alt="" style={{ height: 50, borderRadius: 8, objectFit: 'cover' }} />
              ) : null}
              <button type="button" onClick={() => removePendingAttachment(idx)} style={{ position: 'absolute', top: -3, right: -3, width: 16, height: 16, borderRadius: '50%', background: '#ff4d6d', border: 'none', color: '#fff', fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
          ))}
        </div>
      )}
      {error ? <div style={{ margin: '4px 14px 0', fontSize: 12, color: '#ff6b6b' }}>{error}</div> : null}

      {/* ===== FILTER PILLS ===== */}
      <div className="feed-exact-pills-row">
        <div className="feed-exact-pills">
          <button type="button" className={`feed-exact-pill ${activeFilter === 'todos' ? 'active' : ''}`} onClick={() => setActiveFilter('todos')}>Todos</button>
          <button type="button" className={`feed-exact-pill ${activeFilter === 'amigos' ? 'active' : ''}`} onClick={() => setActiveFilter('amigos')}>Amigos</button>
          <button type="button" className={`feed-exact-pill ${activeFilter === 'tendencia' ? 'active' : ''}`} onClick={() => setActiveFilter('tendencia')}>Tendencia</button>
        </div>
      </div>

      {/* ===== LISTA DE PUBLICACIONES (POST CARDS) ===== */}
      {(() => {
        const friendIds = new Set(friends.map(f => f.id));
        const filteredPosts = activeFilter === 'todos' ? posts
          : activeFilter === 'amigos' ? posts.filter(p => friendIds.has(p.authorId))
          : activeFilter === 'tendencia' ? [...posts].sort((a, b) => b.likeCount - a.likeCount).slice(0, 5)
          : posts;
        return loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#727693', fontSize: 14 }}>Cargando publicaciones...</div>
        ) : filteredPosts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#727693', fontSize: 14 }}>No hay publicaciones en esta categoría.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredPosts.map((post) => (
            <article key={post.id} id={`post-${post.id}`} className="feed-exact-post-card">
              {/* Header */}
              <div className="feed-exact-post-header">
                <div className="feed-exact-post-user">
                  <img
                    src={post.author.avatarUrl ? resolveAttachmentUrl(post.author.avatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(post.author.displayName)}&background=4d26b3&color=fff&bold=true`}
                    alt={post.author.displayName}
                    onClick={(e) => { e.stopPropagation(); onOpenProfile(post.author.id); }}
                    style={{ cursor: 'pointer' }}
                  />
                  <div className="feed-exact-post-user-meta">
                    <h4>
                      {post.author.displayName}
                      {post.author.id === user?.id ? (
                        <span className="feed-exact-badge you">Tú</span>
                      ) : (
                        <span className="feed-exact-badge">Amigo</span>
                      )}
                    </h4>
                    <p className="post-time">{formatShortTime(post.createdAt)}</p>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <button type="button" className="feed-exact-post-options" onClick={(e) => { e.stopPropagation(); setPostActionMenuId((current) => current === post.id ? null : post.id); }} aria-label="Opciones">
                    ⋯
                  </button>
                  {/* Menú de opciones como popup posicionado */}
                  {postActionMenuId === post.id && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 180, background: '#1a1d35', borderRadius: 14, border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 8px 32px rgba(0,0,0,.5)', padding: 6, zIndex: 50, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {post.authorId === user?.id ? (
                        <button style={{ background: 'none', border: 'none', color: '#ff6b6b', padding: '10px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => void deletePost(post.id)}>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                          Eliminar publicación
                        </button>
                      ) : (
                        <button style={{ background: 'none', border: 'none', color: '#f0f4ff', padding: '10px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => void reportPost(post.id, post.author.displayName)}>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                          Reportar publicación
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Contenido */}
              {post.content && <p className="feed-exact-post-content">{post.content}</p>}

              {/* Adjuntos */}
              {post.attachments?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {post.attachments.map((att) => (
                    <div key={`${post.id}-${att.url}`}>
                      {att.kind === 'image' ? (
                        <button type="button" style={{ width: '100%', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setImagePopupUrl(resolveAttachmentUrl(att.url))}>
                          <img src={resolveAttachmentUrl(att.url)} alt={att.fileName ?? 'Imagen'} style={{ width: '100%', borderRadius: 16, objectFit: 'cover', maxHeight: 180 }} />
                        </button>
                      ) : (
                        <audio controls style={{ width: '100%' }}>
                          <source src={resolveAttachmentUrl(att.url)} type={att.mimeType ?? 'audio/webm'} />
                        </audio>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions row */}
              <div className="feed-exact-post-actions-row">
                <div className="feed-exact-interaction-buttons">
                  <button type="button" onClick={() => toggleLike(post.id)} className={`feed-exact-action-btn ${post.likedByMe ? 'liked' : ''}`}>
                    <svg viewBox="0 0 24 24" fill={post.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20.4 4.9 13.8A4.8 4.8 0 0 1 12 7.5a4.8 4.8 0 0 1 7.1 6.3L12 20.4Z" />
                    </svg>
                    {post.likeCount}
                  </button>
                  <button type="button" onClick={() => toggleCommentBox(post.id)} className="feed-exact-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17.2 3.8 20V6.9A2.9 2.9 0 0 1 6.7 4h10.6a2.9 2.9 0 0 1 2.9 2.9v7.4a2.9 2.9 0 0 1-2.9 2.9H7Z" />
                    </svg>
                    {post.comments?.length ?? 0}
                  </button>
                </div>
                <div className="feed-exact-avatar-stack">
                  {post.comments && post.comments.length > 0 && post.comments.slice(0, 3).map((c, i) => (
                    <img
                      key={c.id}
                      src={c.authorAvatarUrl ? resolveAttachmentUrl(c.authorAvatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(c.authorName)}&background=4d26b3&color=fff&size=18`}
                      alt={c.authorName}
                      title={c.authorName}
                      style={{ marginLeft: i > 0 ? -8 : 0, position: 'relative', zIndex: 3 - i }}
                    />
                  ))}
                  {post.comments && post.comments.length > 3 && (
                    <span className="counter" style={{ marginLeft: 2 }}>+{post.comments.length - 3}</span>
                  )}
                </div>
              </div>

              {/* Comentarios */}
              {openCommentPostId === post.id && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      value={commentDrafts[post.id] ?? ''}
                      onChange={(e) => setCommentDrafts((current) => ({ ...current, [post.id]: e.target.value.slice(0, 80) }))}
                      placeholder="Escribe un comentario..."
                      style={{ flex: 1, background: '#11142a', border: 'none', borderRadius: 12, padding: '8px 12px', fontSize: 13, color: '#f0f4ff', outline: 'none' }}
                    />
                    <button type="button" onClick={() => submitComment(post.id)} style={{ background: '#4d26b3', border: 'none', borderRadius: 12, padding: '8px 14px', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      Enviar
                    </button>
                  </div>

                  {post.comments?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {post.comments.map((comment) => (
                        <div key={comment.id} style={{ background: '#11142a', borderRadius: 12, padding: '8px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <img
                                src={comment.authorAvatarUrl ? resolveAttachmentUrl(comment.authorAvatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.authorName)}&background=4d26b3&color=fff&size=20`}
                                alt={comment.authorName}
                                style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }}
                              />
                              <span style={{ fontSize: 12, fontWeight: 600, color: '#cdbfff' }}>{comment.authorName}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button type="button" onClick={() => void toggleCommentLike(post.id, comment.id)} disabled={commentLikePending.has(comment.id)} style={{ background: 'none', border: 'none', color: comment.likedByMe ? '#ff4d6d' : '#727693', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill={comment.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5"><path d="M12 20.4 4.9 13.8A4.8 4.8 0 0 1 12 7.5a4.8 4.8 0 0 1 7.1 6.3L12 20.4Z" /></svg>
                                {(comment.likeCount ?? 0) > 0 && <span>{comment.likeCount}</span>}
                              </button>
                              <button type="button" onClick={() => setOpenReplyCommentId((c) => (c === comment.id ? null : comment.id))} style={{ background: 'none', border: 'none', color: '#727693', cursor: 'pointer', fontSize: 11, padding: 0 }}>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, color: '#e2e4f0' }}>{comment.body}</div>

                          {/* Replies */}
                          {(comment.replies?.length ?? 0) > 0 && (
                            <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid rgba(77,38,179,.3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {comment.replies?.map((reply) => (
                                <div key={reply.id} style={{ fontSize: 12, color: '#c8cce0', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <img
                                    src={reply.authorAvatarUrl ? resolveAttachmentUrl(reply.authorAvatarUrl) : `https://ui-avatars.com/api/?name=${encodeURIComponent(reply.authorName)}&background=4d26b3&color=fff&size=16`}
                                    alt={reply.authorName}
                                    style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                                  />
                                  <span style={{ fontWeight: 600, color: '#cdbfff' }}>{reply.authorName}: </span>
                                  <span>{reply.body}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Reply input */}
                          {openReplyCommentId === comment.id && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <input
                                value={replyDrafts[comment.id] ?? ''}
                                onChange={(e) => setReplyDrafts((current) => ({ ...current, [comment.id]: e.target.value.slice(0, 80) }))}
                                placeholder="Responder..."
                                style={{ flex: 1, background: '#0e1126', border: 'none', borderRadius: 10, padding: '6px 10px', fontSize: 12, color: '#f0f4ff', outline: 'none' }}
                              />
                              <button type="button" onClick={() => void submitReply(post.id, comment.id)} style={{ background: '#4d26b3', border: 'none', borderRadius: 10, padding: '6px 12px', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>OK</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
        );
      })()}

      {imagePopupUrl ? (
        <button type="button" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setImagePopupUrl(null)}>
          <img src={imagePopupUrl} alt="Vista completa" className="max-h-[88vh] w-auto max-w-full rounded-[24px] object-contain" />
        </button>
      ) : null}

      {/* Composer inline - ya no hay popup */}
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
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const swipeStartRef = useRef<{ messageId: string; startX: number } | null>(null);
  const suppressMenuRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressLongPressClickRef = useRef(false);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef<number>(0);
  const dmMessagesRef = useRef<HTMLDivElement>(null);
  const dmInitialLoadRef = useRef(true);

  async function loadConversations() {
    setLoadingList(true);
    setError(null);
    try {
      const rows = await api<ConversationSummary[]>('/dm');
      const sorted = rows.slice().sort((a, b) => {
        const ta = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
        const tb = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
        return tb - ta;
      });
      setDms(sorted);
      if (selectedConversationId) {
        const current = sorted.find((row) => row.id === selectedConversationId) ?? null;
        setActiveConversation(current);
      }
    } catch {
      setError('No se pudieron cargar las conversaciones.');
    } finally {
      setLoadingList(false);
    }
  }

  function updateLastMessage(msg: DMMessage) {
    setDms((current) => {
      const updated = current.map((d) =>
        d.id === msg.conversationId
          ? { ...d, lastMessage: { content: msg.content, createdAt: msg.createdAt, authorId: msg.authorId, attachments: msg.attachments } }
          : d,
      );
      return updated.slice().sort((a, b) => {
        const ta = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
        const tb = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
        return tb - ta;
      });
    });
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

  useEffect(() => {
    if (!activeConversation) return;
    const socket = getSocket('/social');
    const peerId = activeConversation.peer.id;
    const convId = activeConversation.id;
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
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      setPeerIsTyping(false);
    };
  }, [activeConversation?.id, activeConversation?.peer.id]);

  useEffect(() => {
    dmMessagesRef.current?.scrollTo({ top: dmMessagesRef.current.scrollHeight, behavior: dmInitialLoadRef.current ? 'auto' : 'smooth' });
    dmInitialLoadRef.current = false;
  }, [messages.length]);

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
      updateLastMessage(sent);
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
                <div ref={dmMessagesRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[radial-gradient(circle_at_top,#1f2a3a_0%,#111722_45%,#0b0d12_100%)] min-h-0">
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

                {peerIsTyping ? (
                  <div className="px-4 py-1.5 flex items-center gap-2 text-xs text-white/45 bg-[#0d131d] border-t border-white/5">
                    <span className="flex gap-[3px] items-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
                    </span>
                    <span>{activeConversation?.peer.displayName} está escribiendo</span>
                  </div>
                ) : null}

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
                      onChange={(e) => {
                        setComposer(e.target.value);
                        if (activeConversation && canWrite) {
                          const now = Date.now();
                          if (now - lastTypingEmitRef.current > 3000) {
                            lastTypingEmitRef.current = now;
                            getSocket('/social').emit('dm_typing', { conversationId: activeConversation.id, peerId: activeConversation.peer.id });
                          }
                        }
                      }}
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

  // Escuchar estado online/offline en el sheet
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket('/presence');
    const onPresenceUpdate = (payload: { userId: string; online: boolean }) => {
      if (payload.userId === userId) {
        setProfile((current) => (current ? { ...current, isOnline: payload.online } : current));
      }
    };
    const onPresenceList = (list: { userId: string; online: boolean }[]) => {
      const entry = list.find((p) => p.userId === userId);
      if (entry) {
        setProfile((current) => (current ? { ...current, isOnline: entry.online } : current));
      }
    };
    socket.on('presence:update', onPresenceUpdate);
    socket.on('presence:list', onPresenceList);
    socket.emit('presence:subscribe', { userIds: [userId] });
    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('presence:list', onPresenceList);
    };
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
                <UserAvatar displayName={profile.displayName} avatarUrl={profile.avatarUrl} size={68} className="rounded-[24px]" isOnline={profile.isOnline} />
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
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
function GroupsTab({
  openCreatorOnMount,
  onCreatorOpened,
}: {
  openCreatorOnMount?: boolean;
  onCreatorOpened?: () => void;
}) {
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
    if (openCreatorOnMount) {
      setCreateComposerOpen(true);
      if (onCreatorOpened) onCreatorOpened();
    }
  }, [openCreatorOnMount, onCreatorOpened]);

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
  onOpenGroupCreator,
}: {
  viewedUserId?: string | null;
  onOpenChats: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRelationshipChanged: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenGroupCreator?: () => void;
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
  const [connectionsList, setConnectionsList] = useState<ProfileRelationshipUser[]>([]);
  const [userVoteOnProfile, setUserVoteOnProfile] = useState<1 | -1 | null>(null);
  const [votingInProgress, setVotingInProgress] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const targetUserId = viewedUserId ?? user?.id ?? null;
  const isOwnProfile = !!user?.id && targetUserId === user.id;

  useEffect(() => {
    if (!targetUserId) return;
    setLoading(true);
    setPostsLoading(true);
    setError(null);
    setUserVoteOnProfile(null);
    const profileRequest = api<UserProfile>(`/users/${targetUserId}`);
    const postsRequest = api<FeedPost[]>(`/posts?authorId=${encodeURIComponent(targetUserId)}&limit=24`);
    const ownDataRequest = isOwnProfile
      ? Promise.all([
          api<{ code: string; usesCount: number; maxUses: number }>('/invitations/me'),
          api<GroupsResponse>('/groups'),
        ])
      : Promise.resolve<[null, { mine: Group[]; public: Group[] }]>([null, { mine: [], public: [] }]);
    const followersRequest = api<ProfileRelationshipUser[]>(`/users/${targetUserId}/followers`).catch(() => []);

    Promise.all([profileRequest, ownDataRequest, postsRequest, followersRequest])
      .then(([profileData, [inviteData, groupsData], postsData, followersData]) => {
        setProfile(profileData);
        setUserVoteOnProfile(profileData.userVoteType ?? null);
        setInvite(inviteData);
        setMyGroups(groupsData.mine);
        setPublicGroups(groupsData.public);
        setProfilePosts(postsData);
        setConnectionsList(followersData || []);
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

  // Escuchar estado online/offline del perfil via presencia
  useEffect(() => {
    if (!targetUserId) return;
    const socket = getSocket('/presence');
    const onPresenceUpdate = (payload: { userId: string; online: boolean }) => {
      if (payload.userId === targetUserId) {
        setProfile((current) => (current ? { ...current, isOnline: payload.online } : current));
      }
    };
    const onPresenceList = (list: { userId: string; online: boolean }[]) => {
      const entry = list.find((p) => p.userId === targetUserId);
      if (entry) {
        setProfile((current) => (current ? { ...current, isOnline: entry.online } : current));
      }
    };
    socket.on('presence:update', onPresenceUpdate);
    socket.on('presence:list', onPresenceList);
    socket.emit('presence:subscribe', { userIds: [targetUserId] });
    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('presence:list', onPresenceList);
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

  async function handleVoteOnProfile(voteType: 1 | -1) {
    if (!profile || isOwnProfile || votingInProgress) return;
    setVotingInProgress(true);
    setError(null);
    try {
      if (userVoteOnProfile === voteType) {
        // Remove vote if clicking same button
        await api(`/users/${profile.id}/reputation`, { method: 'DELETE' });
        setUserVoteOnProfile(null);
        setProfile((current) =>
          current
            ? {
                ...current,
                reputationScore: (current.reputationScore || 0) + (voteType === 1 ? -1 : 1),
                reputationLikes: voteType === 1 ? (current.reputationLikes || 0) - 1 : current.reputationLikes,
                reputationDislikes: voteType === -1 ? (current.reputationDislikes || 0) - 1 : current.reputationDislikes,
              }
            : current,
        );
      } else if (userVoteOnProfile) {
        // Switch vote
        const endpoint = voteType === 1 ? 'like' : 'dislike';
        await api(`/users/${profile.id}/reputation/${endpoint}`, { method: 'POST' });
        const oldVote = userVoteOnProfile;
        setUserVoteOnProfile(voteType);
        setProfile((current) =>
          current
            ? {
                ...current,
                reputationScore: (current.reputationScore || 0) + (oldVote === 1 ? -1 : 1) + (voteType === 1 ? 1 : -1),
                reputationLikes: 
                  oldVote === 1 ? (current.reputationLikes || 0) - 1 : (current.reputationLikes || 0) + (voteType === 1 ? 1 : 0),
                reputationDislikes:
                  oldVote === -1 ? (current.reputationDislikes || 0) - 1 : (current.reputationDislikes || 0) + (voteType === -1 ? 1 : 0),
              }
            : current,
        );
      } else {
        // Add new vote
        const endpoint = voteType === 1 ? 'like' : 'dislike';
        await api(`/users/${profile.id}/reputation/${endpoint}`, { method: 'POST' });
        setUserVoteOnProfile(voteType);
        setProfile((current) =>
          current
            ? {
                ...current,
                reputationScore: (current.reputationScore || 0) + (voteType === 1 ? 1 : -1),
                reputationLikes: voteType === 1 ? (current.reputationLikes || 0) + 1 : current.reputationLikes,
                reputationDislikes: voteType === -1 ? (current.reputationDislikes || 0) + 1 : current.reputationDislikes,
              }
            : current,
        );
      }
    } catch (err) {
      setError('No se pudo procesar tu voto.');
      setVotingInProgress(false);
      return;
    } finally {
      setVotingInProgress(false);
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
    <section className="relative overflow-hidden px-3.5 pb-8 pt-1">
      {/* Luces decorativas de fondo muy sutiles */}
      <div className="pointer-events-none absolute inset-x-[-18%] top-[-110px] h-[180px] rounded-full bg-[#66ffd9]/4 blur-[92px]" />
      <div className="pointer-events-none absolute right-[-18%] top-[110px] h-[200px] w-[200px] rounded-full bg-[#b026ff]/6 blur-[108px]" />

      <div className="relative mx-auto max-w-[356px] pt-1 flex flex-col gap-2.5">
        
        {/* TARJETA 1: PERFIL */}
        <div className="relative rounded-[26px] border border-white/[0.04] bg-[#0c0d19]/90 px-4 pb-4 pt-4 shadow-[0_12px_32px_rgba(0,0,0,.3)] backdrop-blur-[12px]">
          
          {/* Botones de acción arriba a la derecha (Compartir y Opciones) */}
          <div className="absolute right-3.5 top-3.5 flex items-center gap-1.5">
            <button
              type="button"
              className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.06] text-white/60 backdrop-blur-sm transition-colors hover:bg-white/[0.08]"
              aria-label="Compartir perfil"
              onClick={() => {
                const url = window.location.origin + `/app/profile/${encodeURIComponent(displayName)}`;
                navigator.clipboard.writeText(url)
                  .then(() => setError('¡Enlace de perfil copiado al portapapeles!'))
                  .catch(() => setError('No se pudo copiar el enlace.'));
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setProfileMenuOpen((current) => !current)}
              className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.06] text-white/60 backdrop-blur-sm transition-colors hover:bg-white/[0.08]"
              aria-label="Opciones de perfil"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
                <circle cx="5" cy="12" r="1.5" />
              </svg>
            </button>
          </div>

          {/* Menú de opciones de perfil */}
          {profileMenuOpen ? (
            <div className="absolute right-4 top-12.5 z-20 w-[180px] overflow-hidden rounded-[18px] border border-white/10 bg-[#141524] shadow-[0_12px_32px_rgba(0,0,0,.5)] backdrop-blur-[12px]">
              {isOwnProfile ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      logout().then(() => router.replace('/login'));
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-medium text-white/80 hover:bg-white/5 transition-colors border-b border-white/5"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" className="text-white/50">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Cerrar sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      avatarInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-medium text-white/80 hover:bg-white/5 transition-colors border-b border-white/5"
                    disabled={uploadingAvatar}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" className="text-white/50">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {uploadingAvatar ? 'Subiendo...' : 'Cambiar foto'}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setError('Esta función estará disponible pronto.');
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-medium text-white/80 hover:bg-white/5 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" className="text-white/50">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Editar biografía
              </button>
            </div>
          ) : null}

          {/* Información de Perfil (Avatar a la izquierda, textos a la derecha en la misma fila) */}
          <div className="flex items-center gap-4 text-left w-full">
            {/* Foto de Perfil Compacta con Halo degradado igual a la imagen */}
            <div className="relative shrink-0">
              <div className="relative p-[2.5px] rounded-full bg-gradient-to-tr from-[#5cedfc] via-[#b65dfa] to-[#51ff85] shadow-[0_0_18px_rgba(182,93,250,.15)]">
                {avatarUrl ? (
                  <img
                    src={resolveAttachmentUrl(avatarUrl)}
                    alt={displayName}
                    className="h-[76px] w-[76px] rounded-full border-[3px] border-[#0c0d19] object-cover"
                  />
                ) : (
                  <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-[3px] border-[#0c0d19] bg-[#141624] text-[18px] font-black text-white/90">
                    {displayName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                {/* Indicador de estado online/offline dinámico */}
                <span className={`absolute bottom-[1px] right-[3px] h-5 w-5 rounded-full border-[3px] border-[#0c0d19] ${profile?.isOnline ? 'bg-[#3beb75] shadow-[0_0_8px_rgba(59,235,117,.35)]' : 'bg-[#6b7280]'}`} />
              </div>
            </div>

            {/* Datos de usuario a la derecha, muy juntos, aprovechando todo el ancho horizontal */}
            <div className="flex-1 flex flex-col gap-0.5 min-w-0 pr-8">
              {/* @Nombre de usuario verificado */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[20px] font-extrabold tracking-tight text-white leading-none truncate">@{displayName}</span>
                <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#583cf2] text-white shrink-0" title="Verificado">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.2 w-2.2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              </div>

              {/* Correo electrónico pequeño y sutil pegado al nombre */}
              <div className="text-[12px] text-white/35 font-medium leading-none truncate mt-0.5">
                {isOwnProfile ? user?.email ?? 'misuttakojima@gmail.com' : `${displayName.toLowerCase()}@gmail.com`}
              </div>

              {/* Etiqueta compacta de USER/ADMIN */}
              <div className="mt-2 inline-flex rounded-lg border border-[#7c3aed]/25 bg-[#7c3aed]/8 px-2.5 py-0.5 text-[8.5px] font-bold tracking-[0.06em] text-[#a78bfa] uppercase w-max leading-none">
                {roleLabel}
              </div>
            </div>

            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>

          {/* Botones de Seguir y Chat si NO es el propio perfil */}
          {!isOwnProfile ? (
            <div className="relative mt-3.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="h-9 rounded-[14px] border border-[#62f5d7]/25 bg-[#62f5d7]/8 px-3 text-[12px] font-bold text-[#8fffe7] hover:bg-[#62f5d7]/15 transition-all"
                onClick={() => void toggleFollow()}
                disabled={busy}
              >
                {busy ? 'Procesando...' : profile?.isFollowing ? 'Dejar de seguir' : 'Seguir'}
              </button>
              <button
                type="button"
                className="h-9 rounded-[14px] border border-white/5 bg-white/[0.04] px-3 text-[12px] font-medium text-white/80 hover:bg-white/[0.08] transition-all"
                onClick={() => void startConversation()}
                disabled={busy}
              >
                Chat
              </button>
            </div>
          ) : null}
        </div>

        {/* TARJETA 2: CONEXIONES - Rediseño 100% Horizontal e Interactivo */}
        <div className="relative rounded-[20px] border border-white/[0.04] bg-[#0c0d19]/90 px-4 py-3 flex items-center justify-between shadow-[0_10px_24px_rgba(0,0,0,.2)] z-10">
          {/* Fila única horizontal */}
          <div className="flex items-center gap-4">
            
            {/* 1. Icono de conexiones + etiqueta abajo */}
            <div className="flex flex-col items-center justify-center leading-none select-none">
              <span className="text-[#7c3aed] mb-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4.2 w-4.2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <span className="text-[8.5px] font-black tracking-[0.06em] text-white/25 uppercase mt-0.5">Conexiones</span>
            </div>

            {/* Separador vertical fino */}
            <div className="w-[1px] h-6 bg-white/[0.06]" />

            {/* 2. Seguidores (Cliqueable y con feedback de cursor) */}
            <button
              type="button"
              onClick={() => void openRelationshipModal('followers')}
              className="flex flex-col items-center justify-center hover:opacity-100 hover:scale-105 active:scale-95 transition-all cursor-pointer leading-none group text-left"
              title="Ver seguidores reales"
            >
              <span className="text-[18px] font-black text-white leading-none group-hover:text-[#a78bfa] transition-colors">{followersCount}</span>
              <span className="text-[10px] text-white/35 mt-1 leading-none font-medium group-hover:text-white/50 transition-colors">Seguidores</span>
            </button>

            {/* Separador vertical fino */}
            <div className="w-[1px] h-6 bg-white/[0.06]" />

            {/* 3. Seguidos (Cliqueable y con feedback de cursor) */}
            <button
              type="button"
              onClick={() => void openRelationshipModal('following')}
              className="flex flex-col items-center justify-center hover:opacity-100 hover:scale-105 active:scale-95 transition-all cursor-pointer leading-none group text-left"
              title="Ver seguidos reales"
            >
              <span className="text-[18px] font-black text-white leading-none group-hover:text-[#a78bfa] transition-colors">{followingCount}</span>
              <span className="text-[10px] text-white/35 mt-1 leading-none font-medium group-hover:text-white/50 transition-colors">Seguidos</span>
            </button>
          </div>

          {/* 4. Avatares apilados dinámicos de SEGUIDORES REALES en el extremo derecho */}
          <div className="flex items-center -space-x-1.5 shrink-0 select-none">
            {connectionsList.length > 0 ? (
              connectionsList.slice(0, 3).map((person) => {
                const initials = person.displayName.slice(0, 2).toUpperCase();
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => onOpenProfile(person.id)}
                    className="h-[22px] w-[22px] rounded-full border-1.5 border-[#0c0d19] overflow-hidden bg-[#141624] flex items-center justify-center text-[7.5px] font-black text-[#a78bfa] shrink-0 cursor-pointer hover:scale-110 hover:z-10 active:scale-95 transition-all shadow-sm"
                    title={`Ver perfil de @${person.displayName}`}
                  >
                    {person.avatarUrl ? (
                      <img
                        src={resolveAttachmentUrl(person.avatarUrl)}
                        alt={person.displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </button>
                );
              })
            ) : (
              /* Respaldos estáticos interactivos en caso de que no tenga seguidores reales aún (para rellenar la UI) */
              <>
                <div className="h-[22px] w-[22px] rounded-full border-1.5 border-[#0c0d19] bg-[#141624] flex items-center justify-center text-[7px] font-bold text-white/45 select-none cursor-not-allowed">
                  -
                </div>
              </>
            )}

            {/* Botón acumulador del remanente, abre el listado de seguidores */}
            {connectionsList.length > 3 ? (
              <button
                type="button"
                onClick={() => void openRelationshipModal('followers')}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-1.5 border-[#0c0d19] bg-[#18152c] text-[8px] font-black text-[#a78bfa] hover:scale-110 active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm"
                title="Ver lista de seguidores"
              >
                +{connectionsList.length - 3}
              </button>
            ) : connectionsList.length > 0 && connectionsList.length <= 3 ? (
              /* Si tiene seguidores pero son 3 o menos, permitimos cliquear un botón de lista extra */
              <button
                type="button"
                onClick={() => void openRelationshipModal('followers')}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-1.5 border-[#0c0d19] bg-[#18152c]/50 text-[10px] font-black text-[#a78bfa]/60 hover:scale-110 active:scale-95 transition-all shrink-0 cursor-pointer"
                title="Ver listado"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-2.5 w-2.5">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {/* FILA DE DOS COLUMNAS: INVITACIÓN Y REPUTACIÓN */}
        <div className="grid grid-cols-2 gap-2.5">
          
          {/* TARJETA 3: INVITACIÓN - Solo visible para el dueño del perfil */}
          <div className="rounded-[20px] border border-white/[0.04] bg-[#0c0d19]/90 p-3.5 flex flex-col justify-between shadow-[0_10px_24px_rgba(0,0,0,.2)] min-h-[114px]">
            <div>
              {/* Fila de Icono y Columna de Textos */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#18152c] text-[#7c3aed] shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0 leading-none justify-center">
                  <span className="text-[9px] font-extrabold tracking-[0.08em] text-white/30 uppercase leading-none">{isOwnProfile ? 'Invitación' : 'Estado'}</span>
                  {isOwnProfile ? (
                    <span className="mt-0.5 font-black text-[15.5px] tracking-wide text-[#a78bfa] leading-none">
                      {invite?.code ?? '------'}
                    </span>
                  ) : (
                    <span className="mt-0.5 text-[11px] font-bold text-white/50 leading-none">
                      {profile?.followsYou ? 'Te sigue' : 'Perfil público'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {isOwnProfile && (
              <div className="mt-2">
                <div className="text-[10px] text-white/35 leading-none">
                  {invite?.usesCount ?? 0}/{invite?.maxUses ?? 3} usos
                </div>
                {/* Barra de progreso */}
                <div className="w-full h-[3.5px] bg-white/5 rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[#7c3aed] rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, (((invite?.usesCount ?? 0) / (invite?.maxUses ?? 3)) * 100)))}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* TARJETA 4: REPUTACIÓN - Rediseño Horizontal para Título y Valor */}
          <div className="rounded-[20px] border border-white/[0.04] bg-[#0c0d19]/90 p-3.5 flex flex-col justify-between shadow-[0_10px_24px_rgba(0,0,0,.2)] min-h-[114px]">
            <div>
              {/* Fila de Icono y Columna de Textos - Sin espaciado vertical intermedio */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#18152c] text-[#7c3aed] shrink-0">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5 justify-center">
                  <span className="text-[9px] font-extrabold tracking-[0.08em] text-white/30 uppercase leading-none">Reputación</span>
                  <span className="text-[11px] font-bold text-white/80 leading-tight mt-0.5">
                    {profile?.reputationScore ?? 0} puntos
                  </span>
                </div>
              </div>
            </div>

            {/* Like/Dislike Buttons */}
            {!isOwnProfile && (
              <div className="mt-2 flex items-center gap-1">
                <button
                  onClick={() => handleVoteOnProfile(1)}
                  disabled={votingInProgress}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    userVoteOnProfile === 1
                      ? 'bg-[#10b981]/30 text-[#34d399]'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                  } disabled:opacity-50`}
                  title="Me gusta"
                >
                  👍
                </button>
                <button
                  onClick={() => handleVoteOnProfile(-1)}
                  disabled={votingInProgress}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    userVoteOnProfile === -1
                      ? 'bg-red-500/30 text-red-400'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                  } disabled:opacity-50`}
                  title="No me gusta"
                >
                  👎
                </button>
              </div>
            )}
            {isOwnProfile && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#10b981]/8 border border-[#10b981]/15 px-2 py-0.5 text-[9px] font-bold text-[#34d399] w-max leading-none">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5 shrink-0">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Perfil propio
              </div>
            )}
          </div>
        </div>

        {/* TARJETA 5: GRUPOS */}
        <div className="relative rounded-[20px] border border-white/[0.04] bg-[#0c0d19]/90 p-3.5 shadow-[0_10px_24px_rgba(0,0,0,.2)]">
          
          {/* Cabecera compacta */}
          <div className="flex items-center gap-1.5 text-white/30 leading-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="text-[9px] font-bold tracking-[0.14em] uppercase leading-none">Grupos</span>
          </div>

          <div className="mt-2.5">
            <div className="text-[11px] font-bold text-white/60 leading-none">
              Mis grupos ({groupsCount})
            </div>

            {/* Lista de grupos reales del usuario si existen */}
            {showMyGroups ? (
              <div className="flex flex-col gap-1.5 mt-2">
                {ownedGroups.map((group) => (
                  <Link
                    key={group.id}
                    href={`/app/groups/${group.id}`}
                    className="flex items-center justify-between rounded-xl bg-[#060710] p-2 border border-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {group.iconUrl ? (
                        <img
                          src={resolveAttachmentUrl(group.iconUrl)}
                          alt={group.name}
                          className="h-8 w-8 rounded-lg object-cover border border-white/5"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#141624] border border-white/5 text-[10px] font-bold text-[#befff1]">
                          {group.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      
                      <div className="flex flex-col leading-none justify-center">
                        <span className="text-[12px] font-bold text-white/80 leading-none">{group.name}</span>
                        <div className="flex items-center gap-1 text-[9.5px] text-white/35 mt-1 leading-none">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#3beb75]" />
                          <span>{group.memberCount ?? 4} miembros</span>
                        </div>
                      </div>
                    </div>

                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-white/20">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            ) : (
              /* Si el usuario real no tiene grupos, no se renderiza ninguna maqueta genérica sino un discreto texto de vacío */
              <div className="text-[10px] text-white/25 text-center py-5 bg-[#060710]/40 rounded-xl border border-white/[0.01] mt-2 select-none">
                Sin grupos todavía
              </div>
            )}

            {/* Botón "+ Crear nuevo grupo" punteado exacto y compacto */}
            {isOwnProfile ? (
              <button
                type="button"
                onClick={() => {
                  if (onOpenGroupCreator) {
                    onOpenGroupCreator();
                  } else {
                    setError('Función para crear grupo disponible en la sección de Grupos.');
                  }
                }}
                className="w-full flex items-center justify-center gap-1 py-2 mt-2 border border-dashed border-[#7c3aed]/20 rounded-xl text-[10px] font-bold text-[#a78bfa] bg-transparent hover:bg-[#7c3aed]/5 transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Crear nuevo grupo
              </button>
            ) : null}
          </div>
        </div>

        {/* SECCIÓN POSTS (MANTENIDA COMPACTA Y FUNCIONAL) */}
        <div className="relative mt-0.5 overflow-hidden rounded-[20px] border border-white/[0.04] bg-[#0c0d19]/90 p-3.5 shadow-[0_10px_24px_rgba(0,0,0,.2)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[9px] font-bold tracking-[0.14em] text-white/30 uppercase">Posts</div>
            <div className="text-[9.5px] text-white/35 font-bold">{postsLoading ? '...' : profilePosts.length}</div>
          </div>

          {postsLoading ? (
            <div className="text-[10px] text-white/40 py-1">Cargando...</div>
          ) : profilePosts.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-white/5 bg-white/[0.01] py-4 text-center text-[10px] text-white/30">
              Sin publicaciones todavía.
            </div>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
              {profilePosts.map((post) => {
                const imageAttachment = post.attachments.find((attachment) => attachment.kind === 'image');
                const hasVoice = post.attachments.some((attachment) => attachment.kind === 'voice');
                const mine = post.authorId === user?.id;

                return (
                  <article key={post.id} className="relative min-w-[154px] max-w-[154px] rounded-[14px] border border-white/5 bg-[#060710]/40 p-2.5 shadow-md flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <UserAvatar
                          displayName={post.author.displayName}
                          avatarUrl={post.author.avatarUrl}
                          size={20}
                          className="rounded-[6px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenProfile(post.author.id);
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[9.5px] font-bold text-white/80">@{post.author.displayName}</div>
                          <div className="text-[7.5px] text-white/30">{formatShortTime(post.createdAt)}</div>
                        </div>
                        <button type="button" className="icon-btn !h-5 !w-5 !rounded-[6px]" aria-label="Opciones del post" onClick={() => setProfilePostMenuId((current) => current === post.id ? null : post.id)}>
                          <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="12">
                            <circle cx="5" cy="12" r="1.3" />
                            <circle cx="12" cy="12" r="1.3" />
                            <circle cx="19" cy="12" r="1.3" />
                          </svg>
                        </button>
                      </div>

                      {profilePostMenuId === post.id ? (
                        <div className="absolute right-2 top-8 z-20 w-32 rounded-lg border border-white/10 bg-[#141524] p-1 shadow-2xl">
                          {mine ? (
                            <button className="w-full rounded-md px-2 py-1 text-left text-[9.5px] text-red-300 hover:bg-white/5 transition-colors" onClick={() => void deleteProfilePost(post.id)}>
                              Eliminar
                            </button>
                          ) : (
                            <button className="w-full rounded-md px-2 py-1 text-left text-[9.5px] text-white/80 hover:bg-white/5 transition-colors" onClick={() => void reportProfilePost(post.id, post.author.displayName)}>
                              Reportar
                            </button>
                          )}
                        </div>
                      ) : null}

                      {imageAttachment ? (
                        <button type="button" className="mt-1.5 block w-full hover:opacity-90 transition-opacity" onClick={() => setProfileImagePopupUrl(resolveAttachmentUrl(imageAttachment.url))}>
                          <img src={resolveAttachmentUrl(imageAttachment.url)} alt={imageAttachment.fileName ?? 'Post'} className="h-[76px] w-full rounded-[10px] object-cover border border-white/5" />
                        </button>
                      ) : hasVoice ? (
                        <div className="mt-1.5 flex h-[76px] items-center justify-center rounded-[10px] border border-white/5 bg-[#141524]/50 text-[9px] font-bold uppercase tracking-[0.06em] text-white/25">
                          Audio
                        </div>
                      ) : null}

                      {post.content ? (
                        <p className="mt-1.5 text-[10px] leading-[1.3] text-white/65" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {post.content}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-1.5 pt-1.5 border-t border-white/5 flex items-center gap-1.5 text-[8.5px] font-bold text-white/25">
                      <span>{post.likeCount} likes</span>
                      <span>{post.comments.length} c.</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* FEEDBACK MENSAJE / ERROR */}
        {error ? (
          <div className="mt-0.5 px-2.5 py-1.5 text-[10.5px] rounded-lg bg-[#7c3aed]/5 border border-[#7c3aed]/15 text-[#a78bfa] text-center shadow">
            {error}
          </div>
        ) : null}
      </div>

      {/* POPUP MODAL: SEGUIDORES / SEGUIDOS */}
      {relationshipModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setRelationshipModal(null)}>
          <div className="w-full max-w-[328px] rounded-[24px] border border-white/[0.08] bg-[#0f111d] shadow-2xl flex flex-col max-h-[75vh]" onClick={(event) => event.stopPropagation()}>
            {/* Cabecera */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3.5">
              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30 leading-none">Listado</span>
                <div className="text-sm font-bold text-white mt-0.5">
                  {relationshipModal.mode === 'followers' ? 'Seguidores' : 'Seguidos'}
                </div>
              </div>
              <button
                type="button"
                className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.06] text-white/60 hover:bg-white/[0.08] transition-colors cursor-pointer"
                onClick={() => setRelationshipModal(null)}
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Listado de usuarios */}
            <div className="overflow-y-auto px-2.5 py-3 flex flex-col gap-1.5 scrollbar-hide">
              {relationshipModal.loading ? (
                <div className="text-xs text-white/40 text-center py-8">Cargando lista...</div>
              ) : null}
              
              {!relationshipModal.loading && relationshipModal.items.length === 0 ? (
                <div className="text-xs text-white/30 text-center py-8">
                  No hay usuarios en esta lista.
                </div>
              ) : null}

              {!relationshipModal.loading
                ? relationshipModal.items.map((person) => {
                    const initials = person.displayName.slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={`${relationshipModal.mode}-${person.id}`}
                        type="button"
                        onClick={() => {
                          setRelationshipModal(null);
                          onOpenProfile(person.id);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-left bg-white/[0.01] hover:bg-white/[0.04] transition-colors cursor-pointer border border-white/[0.01]"
                      >
                        {/* Avatar redondo compacto */}
                        <div className="h-9 w-9 rounded-full border border-white/10 overflow-hidden shrink-0 bg-[#141624] flex items-center justify-center text-xs font-bold text-white">
                          {person.avatarUrl ? (
                            <img src={resolveAttachmentUrl(person.avatarUrl)} alt={person.displayName} className="h-full w-full object-cover" />
                          ) : (
                            initials
                          )}
                        </div>
                        <div className="min-w-0 flex-1 leading-none">
                          <div className="truncate text-xs font-bold text-white/90">@{person.displayName}</div>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <BadgeRow badges={person.badges} />
                          </div>
                        </div>
                      </button>
                    );
                  })
                : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL DEL HISTORIAL DE IMAGEN */}
      {profileImagePopupUrl ? (
        <button type="button" className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setProfileImagePopupUrl(null)}>
          <img src={profileImagePopupUrl} alt="Vista completa" className="max-h-[85vh] w-auto max-w-full rounded-[24px] object-contain shadow-2xl border border-white/10" />
        </button>
      ) : null}
    </section>
  );
}

/* -------------------- Bottom nav -------------------- */
function BottomNav({ tab, setTab, pendingChatsCount, unreadDmsCount }: { tab: Tab; setTab: (t: Tab) => void; pendingChatsCount: number; unreadDmsCount: number }) {
  const user = useAuth((state) => state.user);
  const items: { id: Tab | 'search'; label: string; icon: React.ReactNode }[] = [
    {
      id: 'feed',
      label: 'Inicio',
      icon: (
        <svg viewBox="0 0 24 24" fill={tab === 'feed' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={tab === 'feed' ? 0 : 1.8}>
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'chats',
      label: 'Chats',
      icon: (
        <svg viewBox="0 0 24 24" fill={tab === 'chats' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={tab === 'chats' ? 0 : 1.8}>
          <path d="M21 12a8 8 0 11-3.6-6.7L21 4l-1.3 3.6A8 8 0 0121 12z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'groups',
      label: 'Amigos',
      icon: (
        <svg viewBox="0 0 24 24" fill={tab === 'groups' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={tab === 'groups' ? 0 : 1.8}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'profile',
      label: 'Perfil',
      icon: (
        <svg viewBox="0 0 24 24" fill={tab === 'profile' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={tab === 'profile' ? 0 : 1.8}>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((it) => {
        return (
          <button
            key={it.id}
            aria-label={it.label}
            className={tab === it.id ? 'active' : ''}
            onClick={() => setTab(it.id as Tab)}
          >
            <span className="nav-icon">
              {it.icon}
              {it.id === 'chats' && (pendingChatsCount + unreadDmsCount) > 0 ? (
                <span className="absolute -right-2 -top-1 min-w-[16px] h-[16px] px-0.5 rounded-full bg-[#ff4343] text-white text-[8px] leading-[16px] text-center font-bold">
                  {(pendingChatsCount + unreadDmsCount) > 9 ? '9+' : pendingChatsCount + unreadDmsCount}
                </span>
              ) : null}
              {tab === it.id ? <span className="nav-indicator" /> : null}
            </span>
            <span className="nav-label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
