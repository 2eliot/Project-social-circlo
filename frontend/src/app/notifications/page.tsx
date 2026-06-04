'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuth } from '@/store/auth.store';
import { resolveMediaUrl } from '@/lib/media-url';

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  isRead: boolean;
  postId?: string | null;
  createdAt: string;
  actor?: {
    id?: string;
    displayName?: string;
    avatarUrl?: string | null;
  } | null;
}

export default function NotificationsPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function markAsRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
    } catch {}
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api('/notifications/read-all', { method: 'POST' });
    } catch {}
  }

  return (
    <div className="min-h-screen bg-[#070a1a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/10 bg-[#070a1a]/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-lg font-bold">Notificaciones</h1>
        <button
          onClick={() => void markAllRead()}
          className="ml-auto text-xs font-semibold uppercase tracking-wider text-[#4d26b3]"
        >
          Marcar todo
        </button>
      </div>

      {/* Lista */}
      <div className="mx-auto max-w-lg px-4 py-4">
        {loading ? (
          <div className="py-12 text-center text-sm text-white/40">Cargando...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-sm text-white/40">No tienes notificaciones.</div>
        ) : (
          <div className="space-y-1">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  void markAsRead(n.id);
                  if (n.postId) {
                    router.push(`/app?post=${n.postId}`);
                  }
                }}
                className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-white/5 ${
                  n.isRead ? 'opacity-60' : ''
                }`}
              >
                <div className="shrink-0 overflow-hidden flex items-center justify-center bg-[#101521] border border-white/10 text-white/90 rounded-[14px]" style={{ width: 40, height: 40 }}>
                  {n.actor?.avatarUrl ? (
                    <img src={resolveMediaUrl(n.actor.avatarUrl)} alt={n.actor.displayName ?? 'Avatar'} className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-semibold tracking-[0.06em] text-sm">{(n.actor?.displayName ?? '?').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{n.title}</span>
                    {!n.isRead && (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#4d26b3]" />
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-white/50">{n.body}</div>
                  <div className="mt-1 text-[10px] text-white/30">
                    {new Date(n.createdAt).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
