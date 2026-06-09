'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuth } from '@/store/auth.store';
import { resolveMediaUrl } from '@/lib/media-url';

interface NotificationMetadata {
  conversationId?: string;
  messageId?: string;
  peerHandle?: string;
}

interface NotificationItem {
  id: string;
  kind: 'POST_LIKED' | 'POST_COMMENTED' | 'COMMENT_REPLIED' | 'DM_MESSAGE';
  title: string;
  body: string;
  isRead: boolean;
  postId?: string | null;
  metadata?: NotificationMetadata | null;
  createdAt: string;
  actor?: {
    id?: string;
    displayName?: string;
    avatarUrl?: string | null;
  } | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `hace ${mins} min`;
  if (hrs < 24) return `hace ${hrs} h`;
  if (days < 7) return `hace ${days} d`;
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.push('/login');
      return;
    }
    api<NotificationItem[]>('/notifications?limit=50')
      .then(setNotifications)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, hydrated, router]);

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
    } catch {}
  }, []);

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api('/notifications/read-all', { method: 'POST' });
    } catch {}
  }

  function handleAction(action: string, n: NotificationItem) {
    void markAsRead(n.id);

    if (n.kind === 'DM_MESSAGE' && n.metadata?.conversationId) {
      if (action === 'reply') {
        router.push(`/app?dm=${n.metadata.conversationId}&tab=chats`);
      } else if (action === 'profile') {
        const handle = n.metadata.peerHandle ?? n.actor?.id;
        router.push(`/app?profile=${handle}`);
      } else if (action === 'mute') {
        // TODO: implementar mutear notificaciones
        setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      }
    } else if (n.postId) {
      if (action === 'reply') {
        router.push(`/app?post=${n.postId}`);
      } else if (action === 'profile') {
        router.push(`/app?profile=${n.actor?.id ?? ''}`);
      } else if (action === 'mute') {
        setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/8 bg-[#0b0f1a]/95 px-4 py-3 backdrop-blur-md">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/60 hover:bg-white/15 transition"
          aria-label="Volver"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-lg font-bold tracking-tight">Notificaciones</h1>
        <button
          onClick={() => void markAllRead()}
          className="ml-auto text-xs font-semibold uppercase tracking-wider text-[#6c3fd4] hover:text-[#8b5cf6] transition"
        >
          Marcar todo
        </button>
      </div>

      {/* Lista */}
      <div className="mx-auto max-w-lg px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-[#6c3fd4]" />
            <span className="text-sm text-white/30">Cargando notificaciones...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" className="text-white/20">
                <path d="M15 17h5l-1.4-1.4A2.4 2.4 0 0018 14V10a6 6 0 00-12 0v4a2.4 2.4 0 00-.6 1.6L4 17h5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 17a3 3 0 11-6 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm text-white/30">No tienes notificaciones aún</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => {
              const isExpanded = expandedId === n.id;
              return (
                <div
                  key={n.id}
                  className={`notification-card overflow-hidden rounded-2xl border transition-all duration-200 ${
                    isExpanded
                      ? 'border-white/15 bg-white/6'
                      : n.isRead
                        ? 'border-white/5 bg-white/3'
                        : 'border-[#6c3fd4]/20 bg-white/5'
                  }`}
                >
                  {/* ───── Header: app brand + time + expand ───── */}
                  <div className="notification-header flex items-center gap-2.5 px-4 py-3">
                    {/* App icon */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#6c3fd4]/15">
                      <svg viewBox="0 0 24 24" fill="none" width="16" height="16" className="text-[#6c3fd4]">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </div>

                    {/* App name · time */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold text-white/70">Social Circle</span>
                      <span className="h-1 w-1 shrink-0 rounded-full bg-white/25" />
                      <span className="text-xs text-white/35 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                    </div>

                    {/* Unread dot */}
                    {!n.isRead && (
                      <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-[#6c3fd4]" />
                    )}

                    {/* Expand/collapse chevron */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(n.id);
                      }}
                      className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white/80 transition"
                      aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        width="16"
                        height="16"
                        className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      >
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>

                  {/* ───── Body: sender + message + avatar ───── */}
                  <button
                    onClick={() => {
                      void markAsRead(n.id);
                      if (!isExpanded) toggleExpand(n.id);
                    }}
                    className="notification-body flex w-full items-center gap-3 px-4 pb-3 text-left"
                  >
                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white/90 truncate">{n.title}</p>
                      <p className={`text-xs text-white/50 mt-0.5 ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {n.body}
                      </p>
                    </div>

                    {/* Sender avatar */}
                    <div
                      className="shrink-0 flex items-center justify-center bg-[#151b2a] border border-white/10 rounded-full overflow-hidden"
                      style={{ width: 42, height: 42 }}
                    >
                      {n.actor?.avatarUrl ? (
                        <img
                          src={resolveMediaUrl(n.actor.avatarUrl)}
                          alt={n.actor.displayName ?? 'Avatar'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="font-semibold tracking-[0.06em] text-sm text-white/50">
                          {(n.actor?.displayName ?? '?').slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* ───── Expanded actions ───── */}
                  {isExpanded && (
                    <div className="notification-actions flex items-center gap-2 border-t border-white/8 px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction('reply', n);
                        }}
                        className="btn-action btn-primary flex items-center gap-1.5 rounded-xl bg-[#6c3fd4] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#7c4fe4] active:scale-[0.97]"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <path d="M3 10l7-7m0 0l7 7m-7-7v18" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Responder
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction('profile', n);
                        }}
                        className="btn-action btn-secondary flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 active:scale-[0.97]"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
                        </svg>
                        Ver perfil
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction('mute', n);
                        }}
                        className="btn-action btn-secondary flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 active:scale-[0.97]"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <path d="M15 17h5l-1.4-1.4A2.4 2.4 0 0018 14V10a6 6 0 00-9.5-4.8" strokeLinecap="round" strokeLinejoin="round" />
                          <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
                        </svg>
                        Silenciar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(n.id);
                        }}
                        className="btn-action-more ml-auto flex h-8 w-8 items-center justify-center rounded-xl text-white/30 hover:bg-white/10 hover:text-white/60 transition"
                        aria-label="Cerrar"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                          <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
