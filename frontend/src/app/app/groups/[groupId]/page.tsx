'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { ChannelView } from '@/features/channels/ChannelView';
import { resolveMediaUrl } from '@/lib/media-url';
import { getSocket } from '@/lib/socket-client';
import { SfuClient } from '@/lib/mediasoup-client';
import { useAuth } from '@/store/auth.store';
import { useVoiceStore } from '@/store/voice.store';

interface Channel { id: string; name: string; type: 'TEXT' | 'VOICE' | 'VIDEO'; isEnabled: boolean; }
interface GroupMember {
  userId: string;
  role: 'GROUP_ADMIN' | 'GROUP_MODERATOR' | 'GROUP_MEMBER';
  isBanned: boolean;
  joinedAt: string;
  user: { id: string; displayName: string; avatarUrl?: string | null };
}

interface GroupDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  privacy: 'PUBLIC_INVITE' | 'PRIVATE' | 'SECRET';
  iconUrl?: string | null;
  bannerUrl?: string | null;
  owner: { id: string; displayName: string; avatarUrl?: string | null };
  memberCount: number;
  bannedCount: number;
  moderatorsCount: number;
  currentUserRole: 'GROUP_ADMIN' | 'GROUP_MODERATOR' | 'GROUP_MEMBER' | null;
  channelSummary: { total: number; text: number; voice: number; video: number };
  channels: Channel[];
  members: GroupMember[];
}

interface VoiceStateUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  micMuted: boolean;
  isSpeaking?: boolean;
}

interface GroupAuditLog {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; displayName: string; avatarUrl?: string | null } | null;
  target: { id: string; displayName: string; avatarUrl?: string | null } | null;
}

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const user = useAuth((state) => state.user);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [channelToggleBusy, setChannelToggleBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceStateUser[]>([]);
  const [pendingVoiceRequests, setPendingVoiceRequests] = useState<VoiceStateUser[]>([]);
  const [voiceTotalActive, setVoiceTotalActive] = useState(0);
  const [voiceRequestPending, setVoiceRequestPending] = useState(false);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceJoinBusy, setVoiceJoinBusy] = useState(false);
  const [localMicMuted, setLocalMicMuted] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [roleChangeBusy, setRoleChangeBusy] = useState<string | null>(null);
  const [memberModerationBusy, setMemberModerationBusy] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'info' | 'settings' | 'banned' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'members' | 'coas'>('members');
  const [memberSearch, setMemberSearch] = useState('');
  const [bannedSearch, setBannedSearch] = useState('');
  const [settingsMemberSearch, setSettingsMemberSearch] = useState('');
  const [settingsMemberMenuId, setSettingsMemberMenuId] = useState<string | null>(null);
  const [bannerUploadBusy, setBannerUploadBusy] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<GroupAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [groupSaveBusy, setGroupSaveBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [destructBusy, setDestructBusy] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', privacy: 'PRIVATE' as GroupDetail['privacy'], iconUrl: null as string | null, bannerUrl: null as string | null });
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const sfuRef = useRef<SfuClient | null>(null);
  const voiceRestoredRef = useRef(false);
  // Stable refs so the mic callback in the Zustand store always reads the latest values
  const micChangeRef = useRef(handleMicMutedChange);
  micChangeRef.current = handleMicMutedChange;
  const voiceJoinedRef = useRef(voiceJoined);
  voiceJoinedRef.current = voiceJoined;
  const handleVoiceLeaveRef = useRef(handleVoiceLeave);
  handleVoiceLeaveRef.current = handleVoiceLeave;
  const voiceReconnectAsSpeakerRef = useRef(false);

  // ── Global voice store sync ──
  const voiceStoreSetActive = useVoiceStore((s) => s.setActive);
  const voiceStoreSetJoined = useVoiceStore((s) => s.setJoined);
  const voiceStoreSetMuted = useVoiceStore((s) => s.setMuted);
  const voiceStoreSetParticipants = useVoiceStore((s) => s.setParticipants);
  const voiceStoreSetRequestPending = useVoiceStore((s) => s.setRequestPending);
  const voiceStoreClear = useVoiceStore((s) => s.clear);
  const voiceStoreSetOnMicToggled = useVoiceStore((s) => s.setOnMicToggled);
  const voiceStoreSetOnLeaveRequested = useVoiceStore((s) => s.setOnLeaveRequested);
  const voiceStoreSetIsActive = useVoiceStore((s) => s.setIsActive);

  async function loadGroup() {
    const nextGroup = await api<GroupDetail>(`/groups/${groupId}`);
    setGroup(nextGroup);
  }

  async function handleJoinGroup() {
    if (joinBusy) return;
    setJoinBusy(true);
    setFeedback(null);
    try {
      await api(`/groups/${groupId}/join`, { method: 'POST' });
      await loadGroup();
    } catch (e: any) {
      setFeedback(e?.message ?? 'No se pudo unir al grupo');
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleLeaveGroup() {
    if (leaveBusy) return;
    if (!confirm('¿Abandonar el grupo? Dejarás de ser miembro y no aparecerá en tu lista.')) return;
    setLeaveBusy(true);
    try {
      await api(`/groups/${groupId}/leave`, { method: 'POST' });
      router.push('/app');
    } catch (e: any) {
      setFeedback(e?.message ?? 'No se pudo abandonar el grupo');
      setLeaveBusy(false);
    }
  }

  async function handleHardDeleteGroup() {
    if (destructBusy) return;
    if (!confirm('⚠️ ¿Eliminar el grupo PERMANENTEMENTE? Esta acción NO se puede deshacer. Se borrará el grupo, todos sus canales, mensajes, miembros, registros y archivos.')) return;
    if (prompt('Escribe exactamente "ELIMINAR PERMANENTEMENTE" para confirmar:') !== 'ELIMINAR PERMANENTEMENTE') {
      setFeedback('Eliminación cancelada: no escribiste la confirmación correctamente.');
      return;
    }
    setDestructBusy(true);
    setFeedback(null);
    try {
      await api(`/groups/${groupId}/hard-delete`, {
        method: 'POST',
        body: { confirm: 'ELIMINAR PERMANENTEMENTE' },
      });
      router.push('/app');
    } catch (e: any) {
      setFeedback(e?.message ?? 'No se pudo eliminar el grupo.');
      setDestructBusy(false);
    }
  }

  async function loadAuditLogs() {
    setAuditLoading(true);
    try {
      const rows = await api<GroupAuditLog[]>(`/groups/${groupId}/audit-logs`);
      setAuditLogs(rows);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    void loadGroup();
  }, [groupId]);

  // Subscribe to realtime channel updates (enable/disable) for this group
  useEffect(() => {
    if (!groupId) return;
    const socket = getSocket('/chat');
    socket.emit('join_group', { groupId });

    const onChannelUpdated = (channel: Channel) => {
      setGroup((current) => {
        if (!current) return current;
        return {
          ...current,
          channels: current.channels.map((c) => (c.id === channel.id ? { ...c, ...channel } : c)),
        };
      });
      // When voice channel is disabled, clear local state but keep totalActive from socket
      if ((channel.type === 'VOICE' || channel.type === 'VIDEO') && !channel.isEnabled) {
        setVoiceParticipants([]);
        setPendingVoiceRequests([]);
        setVoiceJoined(false);
        setVoiceRequestPending(false);
        sfuRef.current?.disconnect().catch(() => undefined);
        sfuRef.current = null;
      }
    };
    socket.on('channel_updated', onChannelUpdated);

    return () => {
      socket.emit('leave_group', { groupId });
      socket.off('channel_updated', onChannelUpdated);
    };
  }, [groupId]);

  // Real-time polling: keep member count, owner info & group data fresh
  useEffect(() => {
    if (!groupId) return;
    const interval = setInterval(() => {
      void loadGroup();
    }, 20_000);
    return () => clearInterval(interval);
  }, [groupId]);

  const currentGroup = group;
  const voiceChannel = currentGroup?.channels.find((channel) => channel.type === 'VOICE' || channel.type === 'VIDEO') ?? null;
  const textChannel = currentGroup?.channels.find((channel) => channel.type === 'TEXT') ?? null;
  const currentMembership = currentGroup?.members.find((member) => member.userId === user?.id) ?? null;
  const canManageChannels =
    currentGroup?.owner.id === user?.id ||
    currentGroup?.currentUserRole === 'GROUP_ADMIN' ||
    currentGroup?.currentUserRole === 'GROUP_MODERATOR' ||
    currentMembership?.role === 'GROUP_ADMIN' ||
    currentMembership?.role === 'GROUP_MODERATOR';
  const showVoicePanel = Boolean(voiceChannel?.isEnabled);
  const showTextPanel = Boolean(textChannel && (textChannel.isEnabled || canManageChannels));
  const voiceHeroMembers = voiceParticipants
    .map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      avatarUrl: participant.avatarUrl ?? null,
      micMuted: participant.micMuted,
      isSpeaker: true,
      isSelf: participant.id === user?.id,
    }))
    .sort((left, right) => Number(right.isSelf) - Number(left.isSelf))
    .slice(0, 8);
  const memberRoles = Object.fromEntries((currentGroup?.members ?? []).map((member) => [member.userId, member.role]));
  const selectedMember =
    currentGroup?.members.find((member) => member.userId === selectedMemberId)?.user ??
    voiceParticipants.find((member) => member.id === selectedMemberId) ??
    null;
  const canAssignRoles =
    currentGroup?.owner.id === user?.id ||
    currentGroup?.currentUserRole === 'GROUP_ADMIN' ||
    currentMembership?.role === 'GROUP_ADMIN';
  const canModerateMembers =
    currentGroup?.owner.id === user?.id ||
    currentGroup?.currentUserRole === 'GROUP_ADMIN' ||
    currentGroup?.currentUserRole === 'GROUP_MODERATOR' ||
    currentMembership?.role === 'GROUP_ADMIN' ||
    currentMembership?.role === 'GROUP_MODERATOR';
  const canOpenSettings = canManageChannels || canAssignRoles || canModerateMembers;
  const presenceOnlineCount = (currentGroup?.members ?? []).filter((m) => onlineUserIds.has(m.userId)).length;

  useEffect(() => {
    if (!currentGroup) return;
    setGroupForm({
      name: currentGroup.name,
      description: currentGroup.description ?? '',
      privacy: currentGroup.privacy,
      iconUrl: currentGroup.iconUrl ?? null,
      bannerUrl: (currentGroup as any).bannerUrl ?? null,
    });
  }, [currentGroup]);

  useEffect(() => {
    if (activePanel !== 'settings' || !canOpenSettings) return;
    void loadAuditLogs();
  }, [activePanel, canOpenSettings, groupId]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-dots]')) setMenuOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  // Close settings member 3-dot on outside click
  useEffect(() => {
    if (!settingsMemberMenuId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-settings-member-dots]')) setSettingsMemberMenuId(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [settingsMemberMenuId]);

  // Subscribe to presence for real online count (independent of voice channel status)
  useEffect(() => {
    if (!user) return;
    const socket = getSocket('/presence');
    let cancelled = false;

    socket.emit('presence:subscribe');

    const onInitial = ({ onlineIds }: { onlineIds: string[] }) => {
      if (cancelled) return;
      setOnlineUserIds(new Set(onlineIds));
    };
    socket.on('presence:initial', onInitial);

    const onPresence = ({ userId, online }: { userId: string; online: boolean }) => {
      if (cancelled) return;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(userId);
        else next.delete(userId);
        return next;
      });
    };
    socket.on('presence', onPresence);

    return () => {
      cancelled = true;
      socket.off('presence:initial', onInitial);
      socket.off('presence', onPresence);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!voiceChannel || !user) return;

    const socket = getSocket('/sfu');
    let mounted = true;

    const applyState = (state: { participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[]; totalActive?: number }) => {
      if (!mounted) return;
      setVoiceParticipants(
        (state.participants ?? []).map((participant) =>
          participant.id === user.id && voiceJoined ? { ...participant, micMuted: localMicMuted } : participant,
        ),
      );
      setPendingVoiceRequests(state.pendingRequests ?? []);
      setVoiceTotalActive(state.totalActive ?? (state.participants ?? []).length);
      const joined = Boolean(state.participants?.some((item) => item.id === user.id));
      const requested = Boolean(state.pendingRequests?.some((item) => item.id === user.id));
      setVoiceJoined(joined);
      setVoiceRequestPending(requested && !joined);
    };

    emit<{ participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[]; totalActive?: number }>(socket, 'watch_voice_state', { channelId: voiceChannel.id })
      .then(applyState)
      .catch(() => undefined);

    const onState = (state: { channelId: string; participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[]; totalActive?: number }) => {
      if (state.channelId === voiceChannel.id) applyState(state);
    };
    socket.on('voice_state_changed', onState);

    // When an admin/CoA approves this user's request, auto-connect as speaker.
    const onApproved = async (payload: { channelId: string }) => {
      if (!mounted) return;
      if (payload.channelId !== voiceChannel.id) return;
      try {
        await sfuRef.current?.disconnect().catch(() => undefined);
        sfuRef.current = null;
        const sfu = new SfuClient(voiceChannel.id);
        await sfu.connect();
        sfuRef.current = sfu;
        setVoiceJoined(true);
        setVoiceRequestPending(false);
        setLocalMicMuted(true);
      } catch (err) {
        console.warn('[group] auto-join after approval failed', err);
      }
    };
    socket.on('voice_request_approved', onApproved);

    return () => {
      mounted = false;
      socket.off('voice_state_changed', onState);
      socket.off('voice_request_approved', onApproved);
    };
  }, [localMicMuted, user?.id, voiceChannel?.id, voiceJoined]);

  // ── Sync voice state to global store (handles HMR/remount restore internally) ──
  useEffect(() => {
    if (!voiceChannel?.isEnabled) return;

    // On first run after mount/remount, check if the store still has live voice state.
    // If so, restore local state from the store instead of overwriting with defaults.
    if (!voiceRestoredRef.current) {
      voiceRestoredRef.current = true;
      const storeState = useVoiceStore.getState();
      if (storeState.isActive && storeState.activeGroupId === groupId) {
        // HMR / remount: the Zustand store survived but the SFU connection did not.
        // Restore UI-only state and force a reconnect via the listen-only effect.
        setLocalMicMuted(storeState.isMuted);
        if (storeState.isJoined) {
          voiceReconnectAsSpeakerRef.current = true;
        }
        // Do NOT restore voiceJoined=true — that would block the listen-only
        // reconnect effect. Set false so the effect fires and reconnects.
        setVoiceJoined(false);
        return; // re-render will re-run this effect with correct values
      }
    }

    voiceStoreSetActive(voiceChannel.id, currentGroup?.id ?? '', currentGroup?.name ?? '');
    voiceStoreSetIsActive(true);
    voiceStoreSetJoined(voiceJoined);
    voiceStoreSetMuted(localMicMuted);
    voiceStoreSetRequestPending(voiceRequestPending);
    voiceStoreSetParticipants(
      voiceParticipants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl ?? null,
        micMuted: p.micMuted,
        isSpeaking: p.id !== user?.id ? false : (!localMicMuted && voiceJoined),
        isSelf: p.id === user?.id,
      })),
    );
  }, [voiceChannel?.id, voiceChannel?.isEnabled, voiceParticipants, voiceJoined, localMicMuted, voiceRequestPending, currentGroup?.name, user?.id, voiceStoreSetActive, voiceStoreSetIsActive, voiceStoreSetJoined, voiceStoreSetMuted, voiceStoreSetRequestPending, voiceStoreSetParticipants]);

  // ── Listen for leave request from VoiceOverlay (kept as fallback for when page IS mounted) ──
  useEffect(() => {
    const onLeaveRequested = () => {
      void handleVoiceLeave();
    };
    window.addEventListener('voice:leaveRequested', onLeaveRequested);
    return () => window.removeEventListener('voice:leaveRequested', onLeaveRequested);
  }, [voiceChannel?.id]);

  // ── Register leave callback in Zustand store so VoiceOverlay can trigger leave
  //     even when the group page is unmounted ──
  useEffect(() => {
    voiceStoreSetOnLeaveRequested(() => {
      handleVoiceLeaveRef.current();
    });
    // NO cleanup — the callback MUST survive unmount because the VoiceOverlay
    // bubble is only visible when this page is unmounted.
    // On re-mount the effect re-runs and overwrites with the new callback.
  }, [voiceStoreSetOnLeaveRequested]);

  // ── Listen for mute toggle from VoiceOverlay (fallback for when page IS mounted) ──
  useEffect(() => {
    const onToggleMute = (e: Event) => {
      const detail = (e as CustomEvent<{ muted?: boolean }>).detail;
      const targetMuted = detail?.muted ?? !localMicMuted;
      handleMicMutedChange(targetMuted);
    };
    window.addEventListener('voice:toggleMute', onToggleMute);
    return () => window.removeEventListener('voice:toggleMute', onToggleMute);
  }, [localMicMuted, voiceJoined]);

  // ── Register mic-toggle callback in Zustand store so VoiceOverlay can control
  //     the real SFU mic even when the group page is unmounted ──
  useEffect(() => {
    voiceStoreSetOnMicToggled((muted: boolean) => {
      if (!voiceJoinedRef.current) return;
      micChangeRef.current(muted);
    });
    // NO cleanup — the callback MUST survive unmount because the VoiceOverlay
    // bubble is only visible when this page is unmounted.
    // On re-mount the effect re-runs and overwrites with the new callback.
  }, [voiceStoreSetOnMicToggled]);

  // ── Speaking detection sync for the local user ──
  useEffect(() => {
    if (!sfuRef.current || !voiceJoined || !user) return;
    sfuRef.current.onSpeakingChange = (isSpeaking: boolean) => {
      setVoiceParticipants((prev) =>
        prev.map((p) => (p.id === user.id ? { ...p, isSpeaking: isSpeaking } as any : p)),
      );
    };
    return () => { if (sfuRef.current) sfuRef.current.onSpeakingChange = undefined; };
  }, [voiceJoined, user?.id]);

  // Filter voice participants to only show current group members (prevents
  // clicking on kicked users and getting a 404 from the REST API).
  useEffect(() => {
    if (!currentGroup) return;
    const memberSet = new Set(currentGroup.members.map((m) => m.userId));
    setVoiceParticipants((prev) => {
      if (prev.every((p) => memberSet.has(p.id))) return prev;
      return prev.filter((p) => memberSet.has(p.id));
    });
    setPendingVoiceRequests((prev) => {
      if (prev.every((p) => memberSet.has(p.id))) return prev;
      return prev.filter((p) => memberSet.has(p.id));
    });
  }, [currentGroup?.members]);

  // Disconnect SFU when leaving the page (unless voice is active — overlay persists)
  useEffect(() => {
    return () => {
      // Only cleanup if user isn't in voice (otherwise VoiceOverlay persists)
      if (!voiceJoined && !sfuRef.current?.channelId) {
        sfuRef.current?.disconnect().catch(() => undefined);
        sfuRef.current = null;
        voiceStoreClear();
      }
    };
  }, [voiceJoined]);

  // Auto-subscribe in listen-only mode so every group member hears the voice
  // channel without explicitly joining as a speaker. When the user later clicks
  // "join", the speaker connection replaces this passive one.
  useEffect(() => {
    if (!voiceChannel) return;
    if (voiceJoined) return; // already connected as speaker
    if (sfuRef.current) return; // already have a connection
    let cancelled = false;
    const sfu = new SfuClient(voiceChannel.id);
    sfu
      .connectListenOnly()
      .then(() => {
        if (cancelled) {
          void sfu.disconnect();
          return;
        }
        sfuRef.current = sfu;
        // Mark voice as active so the overlay stays visible when user navigates away
        voiceStoreSetActive(voiceChannel.id, currentGroup?.id ?? '', currentGroup?.name ?? '');
        voiceStoreSetIsActive(true);

        // After HMR restore: if the user was speaking before, auto-upgrade
        if (voiceReconnectAsSpeakerRef.current) {
          voiceReconnectAsSpeakerRef.current = false;
          // Disconnect listener, create fresh speaker client
          sfu
            .disconnect()
            .catch(() => undefined)
            .then(() => {
              if (cancelled) return;
              const speakerSfu = new SfuClient(voiceChannel.id);
              return speakerSfu.connect().then(() => {
                if (cancelled) {
                  void speakerSfu.disconnect();
                  return;
                }
                sfuRef.current = speakerSfu;
                setVoiceJoined(true);
                setVoiceRequestPending(false);
                setLocalMicMuted(true);
              });
            })
            .catch((err) => {
              console.warn('[group] auto-speaker-reconnect failed', err);
            });
        }
      })
      .catch((err) => {
        console.warn('[group] listen-only connect failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [voiceChannel?.id, voiceChannel?.isEnabled, voiceJoined, currentGroup?.id, currentGroup?.name, voiceStoreSetActive, voiceStoreSetIsActive]);

  if (!currentGroup) return <p className="p-6 opacity-70">Cargando…</p>;

  function handleOpenProfile(userId: string) {
    router.push(`/app?profileUserId=${encodeURIComponent(userId)}`);
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/app?tab=groups');
  }

  async function toggleChannel(channel: Channel, enabled: boolean) {
    if (!canManageChannels) return;
    setChannelToggleBusy(channel.id);
    setFeedback(null);

    // Immediate cleanup when disabling voice
    if ((channel.type === 'VOICE' || channel.type === 'VIDEO') && !enabled) {
      setVoiceParticipants([]);
      setPendingVoiceRequests([]);
      setVoiceJoined(false);
      setVoiceRequestPending(false);
      sfuRef.current?.disconnect().catch(() => undefined);
      sfuRef.current = null;
      voiceStoreClear();
    }

    try {
      await api(`/groups/${groupId}/channels/${channel.id}/enabled`, {
        method: 'PATCH',
        body: { enabled },
      });
      // Realtime channel_updated event will refresh state — no explicit reload
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo actualizar el canal.');
    } finally {
      setChannelToggleBusy(null);
    }
  }

  async function handleVoiceAction() {
    if (!voiceChannel || !user) return;
    setVoiceJoinBusy(true);
    setFeedback(null);

    try {
      if (voiceJoined) {
        // Leave speaker mode → reconnect as passive listener
        await sfuRef.current?.disconnect().catch(() => undefined);
        sfuRef.current = null;
        setVoiceJoined(false);
        setLocalMicMuted(true);
        voiceStoreSetJoined(false);
        try {
          const listener = new SfuClient(voiceChannel.id);
          await listener.connectListenOnly();
          sfuRef.current = listener;
        } catch (err) {
          console.warn('[group] re-listen failed', err);
        }
        return;
      }

      // Upgrade from listener (if any) to speaker
      if (!canManageChannels) {
        // Regular members must request approval from an admin/CoA before producing.
        const res = await emit<{ ok: boolean; pending?: boolean; rtpCapabilities?: any }>(
          getSocket('/sfu'),
          'request_join_voice',
          { channelId: voiceChannel.id },
        );
        if (res?.pending) {
          setVoiceRequestPending(true);
          setFeedback('Solicitud enviada al admin o CoA.');
          return;
        }
        // Already approved → server joined us; fall through to set up the SFU client below.
      }
      await sfuRef.current?.disconnect().catch(() => undefined);
      sfuRef.current = null;
      const sfu = new SfuClient(voiceChannel.id);
      await sfu.connect();
      sfuRef.current = sfu;
      setVoiceJoined(true);
      setVoiceRequestPending(false);
      setLocalMicMuted(true);
    } catch (error) {
      sfuRef.current = null;
      setFeedback(error instanceof Error ? error.message : 'No se pudo conectar al chat de voz.');
    } finally {
      setVoiceJoinBusy(false);
    }
  }

  /** Fully disconnect from voice (called by VoiceOverlay close button). */
  async function handleVoiceLeave() {
    await sfuRef.current?.disconnect().catch(() => undefined);
    sfuRef.current = null;
    setVoiceJoined(false);
    setVoiceRequestPending(false);
    setLocalMicMuted(true);
    setVoiceParticipants([]);
    setPendingVoiceRequests([]);
    setVoiceTotalActive(0);
    voiceStoreClear();
  }

  async function approveVoiceRequest(userId: string) {
    if (!voiceChannel || !canManageChannels) return;
    setVoiceJoinBusy(true);
    setFeedback(null);
    try {
      await emit(getSocket('/sfu'), 'approve_voice_request', { channelId: voiceChannel.id, userId });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo aprobar la solicitud.');
    } finally {
      setVoiceJoinBusy(false);
    }
  }

  function handleMicMutedChange(muted: boolean) {
    setLocalMicMuted(muted);
    if (!user) return;
    setVoiceParticipants((current) => current.map((participant) => (participant.id === user.id ? { ...participant, micMuted: muted } : participant)));
    if (muted) {
      sfuRef.current?.stopMic().catch(() => undefined);
    } else if (voiceJoined) {
      sfuRef.current?.publishMic().catch((err: unknown) => console.error('[Voice] mic error', err));
    }
  }

  function updateMemberState(memberUserId: string, updater: (member: GroupMember) => GroupMember | null) {
    setGroup((current) => {
      if (!current) return current;

      return {
        ...current,
        members: current.members.flatMap((member) => {
          if (member.userId !== memberUserId) return [member];
          const nextMember = updater(member);
          return nextMember ? [nextMember] : [];
        }),
      };
    });
  }

  async function setMemberRole(memberUserId: string, role: GroupMember['role']) {
    setRoleChangeBusy(memberUserId);
    setFeedback(null);

    try {
      await api(`/groups/${groupId}/members/${memberUserId}/role`, {
        method: 'PATCH',
        body: { role },
      });
      updateMemberState(memberUserId, (member) => ({ ...member, role }));
      setSelectedMemberId(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // User was kicked / is no longer a member — remove from voice state
        setVoiceParticipants((prev) => prev.filter((p) => p.id !== memberUserId));
        setPendingVoiceRequests((prev) => prev.filter((p) => p.id !== memberUserId));
        setSelectedMemberId(null);
        return;
      }
      setFeedback(error instanceof Error ? error.message : 'No se pudo actualizar el rol del usuario.');
    } finally {
      setRoleChangeBusy(null);
    }
  }

  async function moderateMember(memberUserId: string, action: 'BAN' | 'KICK' | 'PERMABAN' | 'UNBAN') {
    setMemberModerationBusy(memberUserId);
    setFeedback(null);

    try {
      await api(`/groups/${groupId}/members/${memberUserId}/moderate`, {
        method: 'POST',
        body: { action },
      });
      if (action === 'KICK') {
        updateMemberState(memberUserId, () => null);
      } else if (action === 'UNBAN') {
        updateMemberState(memberUserId, (member) => ({ ...member, isBanned: false }));
      } else {
        updateMemberState(memberUserId, (member) => ({ ...member, isBanned: true }));
      }
      setVoiceParticipants((current) => current.filter((participant) => participant.id !== memberUserId));
      setPendingVoiceRequests((current) => current.filter((participant) => participant.id !== memberUserId));
      setSelectedMemberId(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Already gone — just clean up local state
        setVoiceParticipants((prev) => prev.filter((p) => p.id !== memberUserId));
        setPendingVoiceRequests((prev) => prev.filter((p) => p.id !== memberUserId));
        setSelectedMemberId(null);
        return;
      }
      setFeedback(error instanceof Error ? error.message : 'No se pudo moderar al usuario.');
    } finally {
      setMemberModerationBusy(null);
    }
  }

  async function uploadGroupIcon(file: File) {
    const form = new FormData();
    form.append('file', file);
    const payload = await api<{ url: string | null }>('/groups/upload-icon', {
      method: 'POST',
      body: form,
    });
    setGroupForm((current) => ({ ...current, iconUrl: payload.url }));
  }

  async function uploadGroupBanner(file: File) {
    setBannerUploadBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const payload = await api<{ url: string | null }>('/groups/upload-banner', {
        method: 'POST',
        body: form,
      });
      setGroupForm((current) => ({ ...current, ...(payload.url ? { bannerUrl: payload.url } as any : {}) }));
    } catch {
      setFeedback('No se pudo subir el banner.');
    } finally {
      setBannerUploadBusy(false);
    }
  }

  async function saveGroupSettings() {
    setGroupSaveBusy(true);
    setFeedback(null);
    try {
      await api(`/groups/${groupId}`, {
        method: 'PATCH',
        body: {
          name: groupForm.name.trim(),
          description: groupForm.description.trim(),
          privacy: groupForm.privacy,
          iconUrl: groupForm.iconUrl,
          bannerUrl: groupForm.bannerUrl,
        },
      });
      await Promise.all([loadGroup(), loadAuditLogs()]);
      setFeedback('Grupo actualizado.');
      setActivePanel(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo guardar el grupo.');
    } finally {
      setGroupSaveBusy(false);
    }
  }

  function renderMemberPopup() {
    if (!selectedMemberId || (!canAssignRoles && !canModerateMembers)) return null;

    const selectedMemberRole = memberRoles[selectedMemberId];
    const coaActionRole = selectedMemberRole === 'GROUP_MODERATOR' ? 'GROUP_MEMBER' : 'GROUP_MODERATOR';
    const coaActionLabel = selectedMemberRole === 'GROUP_MODERATOR' ? 'Quitar CoA' : 'CoA';

    return (
      <div className="fixed inset-0 z-40" data-member-menu-root="true">
        <button
          type="button"
          aria-label="Cerrar menu"
          onClick={() => setSelectedMemberId(null)}
          className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        />
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
          <div className="w-full max-w-[220px] rounded-[18px] border border-white/10 bg-[#111827]/97 p-2 shadow-[0_20px_40px_rgba(0,0,0,.34)] backdrop-blur-[18px]">
            <div className="mb-2 flex items-center gap-2 px-1">
              <button
                type="button"
                onClick={() => {
                  if (selectedMember?.id) router.push(`/app?profileUserId=${encodeURIComponent(selectedMember.id)}`);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#111925] text-[10px] font-black text-white/88"
              >
                {selectedMember?.avatarUrl ? <img src={resolveMediaUrl(selectedMember.avatarUrl)} alt={selectedMember.displayName} className="h-full w-full object-cover" /> : selectedMember?.displayName?.slice(0, 2).toUpperCase()}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/82">{selectedMember?.displayName ?? 'Usuario'}</div>
              </div>
            </div>
            <div className="space-y-1">
              {canAssignRoles ? (
                <>
                  <button
                    type="button"
                    disabled={roleChangeBusy === selectedMemberId || memberModerationBusy === selectedMemberId}
                    onClick={() => void setMemberRole(selectedMemberId, coaActionRole)}
                    className="w-full rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-fuchsia-100 disabled:opacity-50"
                  >
                    {coaActionLabel}
                  </button>
                </>
              ) : null}
              {canModerateMembers ? (
                <>
                  <button
                    type="button"
                    disabled={memberModerationBusy === selectedMemberId || roleChangeBusy === selectedMemberId}
                    onClick={() => void moderateMember(selectedMemberId, 'KICK')}
                    className="w-full rounded-full border border-rose-300/20 bg-rose-400/10 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-rose-100 disabled:opacity-50"
                  >
                    Expulsar
                  </button>
                  <button
                    type="button"
                    disabled={memberModerationBusy === selectedMemberId || roleChangeBusy === selectedMemberId}
                    onClick={() => void moderateMember(selectedMemberId, 'PERMABAN')}
                    className="w-full rounded-full border border-red-300/20 bg-red-500/10 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-red-100 disabled:opacity-50"
                  >
                    Permaban
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh max-w-[440px] w-full mx-auto bg-[#080a17] text-white flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 border-b border-white/[0.06] bg-[#0c0f1a]/95">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/78 shadow-[0_4px_10px_rgba(0,0,0,.24)]"
          aria-label="Regresar"
        >
          <BackMiniIcon />
        </button>

        {/* Owner avatar */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#101521]">
          {currentGroup?.owner?.avatarUrl ? (
            <img src={resolveMediaUrl(currentGroup.owner.avatarUrl)} alt={currentGroup.owner.displayName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-white/70 uppercase">{(currentGroup?.owner?.displayName ?? currentGroup?.name ?? 'G').charAt(0)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-white/78">{currentGroup?.name ?? 'Cargando…'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/40 mt-0.5">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{currentGroup?.memberCount ?? 0} miembro{(currentGroup?.memberCount ?? 0) !== 1 ? 's' : ''}</span>
            <span className="text-white/20">·</span>
            <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${presenceOnlineCount > 0 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.5)]' : 'bg-white/20'}`} />
            <span className={presenceOnlineCount > 0 ? 'text-emerald-300/80' : ''}>{presenceOnlineCount} en línea</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative" data-menu-dots>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/62 hover:bg-white/[0.06]"
              aria-label="Menú del grupo"
            >
              <DotsMiniIcon />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-[220px] rounded-2xl border border-white/10 bg-[#111827]/97 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.5)] backdrop-blur-[18px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => { setActivePanel('info'); setMenuOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/82 hover:bg-white/[0.06]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-white/50"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" strokeLinecap="round"/></svg>
                  Información del grupo
                </button>
                {canOpenSettings ? (
                  <button
                    type="button"
                    onClick={() => { setActivePanel('settings'); setMenuOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/82 hover:bg-white/[0.06]"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-white/50"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    Configuración
                  </button>
                ) : null}
                {canOpenSettings ? (
                  <button
                    type="button"
                    onClick={() => { setActivePanel('banned'); setMenuOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/82 hover:bg-white/[0.06]"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-white/50"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14" strokeLinecap="round"/></svg>
                    Miembros baneados
                  </button>
                ) : null}
                {!!currentMembership ? (
                  <>
                    <div className="my-1 border-t border-white/[0.06]" />
                    <button
                      type="button"
                      disabled={leaveBusy}
                      onClick={() => { handleLeaveGroup(); setMenuOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-rose-400/85 hover:bg-rose-500/[0.12] disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {leaveBusy ? 'Abandonando...' : 'Abandonar grupo'}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Pending voice request approvals ── */}
      {showVoicePanel && canManageChannels && pendingVoiceRequests.length > 0 ? (
        <div className="shrink-0 flex flex-wrap gap-1.5 overflow-x-auto scrollbar-thin px-3 py-2 border-b border-white/[0.04]">
          {pendingVoiceRequests.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => void approveVoiceRequest(member.id)}
              disabled={voiceJoinBusy}
              className="whitespace-nowrap rounded-full border border-fuchsia-300/18 bg-fuchsia-400/10 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-fuchsia-100 disabled:opacity-50"
            >
              Subir a {truncateName(member.displayName)}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Feedback toast ── */}
      {feedback ? (
        <div className="shrink-0 mx-3 mt-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{feedback}</div>
      ) : null}

      {/* ── Chat / Fallback ── */}
      <div className="flex-1 min-h-0">
        {showTextPanel && textChannel ? (
          <ChannelView
            channel={textChannel}
            minimal
            showComposer={textChannel.isEnabled}
            showVoiceControls={!!currentMembership}
            canToggleVoice={!!currentMembership && canManageChannels}
            voiceEnabled={voiceChannel?.isEnabled ?? true}
            voiceBusy={channelToggleBusy === voiceChannel?.id}
            onToggleVoice={voiceChannel ? () => void toggleChannel(voiceChannel, !voiceChannel.isEnabled) : undefined}
            canJoinVoice={false}
            voiceJoined={voiceJoined}
            voiceJoinBusy={voiceJoinBusy}
            voiceRequestPending={voiceRequestPending}
            onVoiceJoinAction={() => void handleVoiceAction()}
            voiceChannelId={voiceChannel?.id}
            onMicMutedChange={handleMicMutedChange}
            memberRoles={memberRoles}
            canManageMembers={canAssignRoles || canModerateMembers}
            onToggleMemberMenu={(memberId) => setSelectedMemberId((current) => (current === memberId ? null : memberId))}
            onOpenProfile={handleOpenProfile}
            voiceHeroMembers={voiceHeroMembers}
            canAssignRoles={canAssignRoles}
            bannerUrl={currentGroup?.bannerUrl ?? null}
            isMember={!!currentMembership}
            joinBusy={joinBusy}
            onJoinGroup={() => void handleJoinGroup()}
            onLeaveGroup={() => router.push('/app')}
          />
        ) : (
          <div className="relative flex h-full flex-col overflow-hidden bg-[#080a17]">
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/55">
              El chat de texto está apagado. Espera a que un admin o CoA lo encienda.
            </div>
            <div className="border-t border-white/8 bg-[#0e1021]/97 px-3 pb-3 pt-2">
              <div className="flex items-center gap-2">
                <div className="flex h-12 items-center gap-2 rounded-[16px] border border-white/8 bg-white/[0.03] px-3 text-sm text-white/60">
                  <MicMiniIcon />
                  <span>{voiceJoined ? 'Ya estás arriba en el chat de voz' : voiceRequestPending ? 'Solicitud enviada al admin o CoA' : 'Usa el botón superior para subir a voz'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {renderMemberPopup()}
      {/* ── Group Info Panel ── */}
      {activePanel === 'info' ? (
        <>
          <div onClick={() => setActivePanel(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.5)' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 90, width: 'min(420px, 100vw)', background: '#0b0d1e', borderLeft: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,.5)', animation: 'slideInRight .2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#f0f4ff' }}>Información del grupo</span>
              <button onClick={() => setActivePanel(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.08)', color: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {/* Group name & admin */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(255,255,255,.08)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111925' }}>
                    {currentGroup?.iconUrl ? <img src={resolveMediaUrl(currentGroup.iconUrl)} alt={currentGroup.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{currentGroup?.name.slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4ff' }}>{currentGroup?.name}</div>
                    <div style={{ fontSize: 12, color: '#727693', marginTop: 2 }}>Admin: <span style={{ color: '#cdbfff' }}>{currentGroup?.owner.displayName}</span></div>
                  </div>
                </div>
                {currentGroup?.description ? <p style={{ fontSize: 13, color: '#9ca0b8', marginTop: 12, lineHeight: 1.5 }}>{currentGroup.description}</p> : null}
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#727693' }}>
                  <span>{currentGroup?.memberCount ?? 0} miembros</span>
                  <span>{currentGroup?.moderatorsCount ?? 0} CoAs</span>
                  <span>{currentGroup?.bannedCount ?? 0} baneados</span>
                </div>
              </div>

              {/* Tabs: Miembros / CoAs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(255,255,255,.03)', borderRadius: 12, padding: 3 }}>
                <button onClick={() => setInfoTab('members')} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', background: infoTab === 'members' ? 'rgba(77,38,179,.4)' : 'transparent', color: infoTab === 'members' ? '#f0f4ff' : '#727693', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Miembros</button>
                <button onClick={() => setInfoTab('coas')} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', background: infoTab === 'coas' ? 'rgba(77,38,179,.4)' : 'transparent', color: infoTab === 'coas' ? '#f0f4ff' : '#727693', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>CoAs</button>
              </div>

              {/* Search */}
              <div style={{ marginBottom: 12 }}>
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Buscar por @nombre..."
                  style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Member list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(currentGroup?.members ?? [])
                  .filter((m) => !m.isBanned)
                  .filter((m) => {
                    if (infoTab === 'coas') return m.role === 'GROUP_ADMIN' || m.role === 'GROUP_MODERATOR';
                    return m.role === 'GROUP_MEMBER';
                  })
                  .filter((m) => {
                    if (!memberSearch.trim()) return true;
                    const q = memberSearch.toLowerCase().replace('@', '');
                    return m.user.displayName.toLowerCase().includes(q);
                  })
                  .map((m) => (
                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.02)' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111925', border: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>
                        {m.user.avatarUrl ? <img src={resolveMediaUrl(m.user.avatarUrl)} alt={m.user.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{m.user.displayName.slice(0, 2).toUpperCase()}</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4ff', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>@{m.user.displayName}</div>
                        <div style={{ fontSize: 10, color: '#727693' }}>{m.role === 'GROUP_ADMIN' ? 'Admin' : m.role === 'GROUP_MODERATOR' ? 'CoA' : 'Miembro'}</div>
                      </div>
                    </div>
                  ))}
                {(currentGroup?.members ?? []).filter((m) => !m.isBanned).filter((m) => infoTab === 'coas' ? (m.role === 'GROUP_ADMIN' || m.role === 'GROUP_MODERATOR') : m.role === 'GROUP_MEMBER').filter((m) => { const q = memberSearch.toLowerCase().replace('@', ''); return !memberSearch.trim() || m.user.displayName.toLowerCase().includes(q); }).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: '#727693', fontSize: 13 }}>{infoTab === 'coas' ? 'No hay CoAs en este grupo.' : 'No se encontraron miembros.'}</div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Settings Panel ── */}
      {activePanel === 'settings' && canOpenSettings ? (
        <>
          <div onClick={() => setActivePanel(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.5)' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 90, width: 'min(420px, 100vw)', background: '#0b0d1e', borderLeft: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,.5)', animation: 'slideInRight .2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#f0f4ff' }}>Configuración</span>
                <div style={{ fontSize: 11, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em' }}>Admin y CoA</div>
              </div>
              <button onClick={() => setActivePanel(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.08)', color: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {/* Icon */}
              <div style={{ marginBottom: 20, borderRadius: 18, border: '1px solid rgba(255,255,255,.06)', padding: 14, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Foto del grupo</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" onClick={() => iconInputRef.current?.click()} style={{ width: 64, height: 64, borderRadius: 18, overflow: 'hidden', border: '2px solid rgba(255,255,255,.08)', background: '#111925', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {groupForm.iconUrl ? <img src={resolveMediaUrl(groupForm.iconUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{groupForm.name.slice(0, 2).toUpperCase()}</span>}
                  </button>
                  <button type="button" onClick={() => iconInputRef.current?.click()} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(56,189,248,.2)', background: 'rgba(56,189,248,.08)', color: '#bae6fd', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cambiar foto</button>
                  <input ref={iconInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadGroupIcon(f); e.target.value = ''; }} />
                </div>
              </div>

              {/* Banner */}
              <div style={{ marginBottom: 20, borderRadius: 18, border: '1px solid rgba(255,255,255,.06)', padding: 14, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Fondo / Banner</div>
                <div style={{ position: 'relative', height: 100, borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(135deg, #1a1040, #0e1a30)', marginBottom: 8 }}>
                  {groupForm.bannerUrl ? <img src={resolveMediaUrl(groupForm.bannerUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </div>
                <label style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(56,189,248,.2)', background: 'rgba(56,189,248,.08)', color: '#bae6fd', fontSize: 11, fontWeight: 600, cursor: bannerUploadBusy ? 'wait' : 'pointer', opacity: bannerUploadBusy ? 0.6 : 1 }}>
                  {bannerUploadBusy ? 'Subiendo...' : 'Cambiar fondo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadGroupBanner(f); e.target.value = ''; }} />
                </label>
              </div>

              {/* Name */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Nombre</div>
                <input value={groupForm.name} onChange={(e) => setGroupForm((c) => ({ ...c, name: e.target.value.slice(0, 60) }))} style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', boxSizing: 'border-box' }} />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Descripción</div>
                <textarea value={groupForm.description} onChange={(e) => setGroupForm((c) => ({ ...c, description: e.target.value.slice(0, 280) }))} rows={3} style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              {/* Privacy */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Privacidad</div>
                <select value={groupForm.privacy} onChange={(e) => setGroupForm((c) => ({ ...c, privacy: e.target.value as GroupDetail['privacy'] }))} style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', boxSizing: 'border-box' }}>
                  <option value="PUBLIC_INVITE">Público con invitación</option>
                  <option value="PRIVATE">Privado</option>
                  <option value="SECRET">Secreto</option>
                </select>
              </div>

              {/* Save */}
              <button type="button" disabled={groupSaveBusy} onClick={() => void saveGroupSettings()} style={{ width: '100%', padding: '12px', borderRadius: 14, border: 'none', background: groupSaveBusy ? 'rgba(168,85,247,.2)' : 'rgba(168,85,247,.15)', color: '#e9d5ff', fontSize: 13, fontWeight: 700, cursor: groupSaveBusy ? 'wait' : 'pointer', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {groupSaveBusy ? 'Guardando...' : 'Guardar cambios'}
              </button>

              {/* ── Gestión de miembros ── */}
              <div style={{ marginTop: 24, borderRadius: 18, border: '1px solid rgba(255,255,255,.06)', padding: 14, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f4ff' }}>Gestión de miembros</div>
                  <div style={{ fontSize: 11, color: '#727693' }}>Banear, nombrar o quitar CoA</div>
                </div>
                <input
                  value={settingsMemberSearch}
                  onChange={(e) => setSettingsMemberSearch(e.target.value)}
                  placeholder="Buscar por @nombre..."
                  style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(currentGroup?.members ?? [])
                    .filter((m) => !m.isBanned)
                    .filter((m) => {
                      if (!settingsMemberSearch.trim()) return true;
                      const q = settingsMemberSearch.toLowerCase().replace('@', '');
                      return m.user.displayName.toLowerCase().includes(q);
                    })
                    .map((m) => (
                      <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.03)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111925', border: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>
                          {m.user.avatarUrl ? <img src={resolveMediaUrl(m.user.avatarUrl)} alt={m.user.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{m.user.displayName.slice(0, 2).toUpperCase()}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4ff', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>@{m.user.displayName}</div>
                          <div style={{ fontSize: 10, color: m.role === 'GROUP_ADMIN' ? '#f59e0b' : m.role === 'GROUP_MODERATOR' ? '#a78bfa' : '#727693' }}>
                            {m.role === 'GROUP_ADMIN' ? '👑 Admin' : m.role === 'GROUP_MODERATOR' ? '🛡️ CoA' : 'Miembro'}
                            {onlineUserIds.has(m.userId) ? <span style={{ marginLeft: 6, color: '#34d399' }}>●</span> : null}
                          </div>
                        </div>
                        {/* 3-dot menu per member */}
                        <div style={{ position: 'relative' }} data-settings-member-dots>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSettingsMemberMenuId((prev) => (prev === m.userId ? null : m.userId)); }}
                            disabled={m.userId === user?.id}
                            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', color: '#727693', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: m.userId === user?.id ? 'default' : 'pointer', opacity: m.userId === user?.id ? 0.2 : 1 }}
                          >
                            <DotsMiniIcon />
                          </button>
                          {settingsMemberMenuId === m.userId ? (
                            <div
                              style={{ position: 'absolute', right: 0, top: '100%', zIndex: 60, marginTop: 4, width: 160, borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: '#161a2e', padding: 6, boxShadow: '0 12px 32px rgba(0,0,0,.4)' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Ban */}
                              <button
                                type="button"
                                disabled={memberModerationBusy === m.userId || m.role === 'GROUP_ADMIN'}
                                onClick={() => { void moderateMember(m.userId, 'BAN'); setSettingsMemberMenuId(null); }}
                                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: m.role === 'GROUP_ADMIN' ? '#555' : '#fca5a5', fontSize: 12, fontWeight: 500, textAlign: 'left', cursor: m.role === 'GROUP_ADMIN' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14" strokeLinecap="round"/></svg>
                                {memberModerationBusy === m.userId ? 'Baneando...' : 'Banear'}
                              </button>
                              {/* Nombrar CoA / Quitar CoA */}
                              {m.role === 'GROUP_MODERATOR' ? (
                                <button
                                  type="button"
                                  disabled={roleChangeBusy === m.userId}
                                  onClick={() => { void setMemberRole(m.userId, 'GROUP_MEMBER'); setSettingsMemberMenuId(null); }}
                                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#fbbf24', fontSize: 12, fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/></svg>
                                  {roleChangeBusy === m.userId ? 'Quitando...' : 'Quitar CoA'}
                                </button>
                              ) : m.role === 'GROUP_MEMBER' ? (
                                <button
                                  type="button"
                                  disabled={roleChangeBusy === m.userId}
                                  onClick={() => { void setMemberRole(m.userId, 'GROUP_MODERATOR'); setSettingsMemberMenuId(null); }}
                                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#a78bfa', fontSize: 12, fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                                  {roleChangeBusy === m.userId ? 'Nombrando...' : 'Nombrar CoA'}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  {(currentGroup?.members ?? []).filter((m) => !m.isBanned).filter((m) => { const q = settingsMemberSearch.toLowerCase().replace('@', ''); return !settingsMemberSearch.trim() || m.user.displayName.toLowerCase().includes(q); }).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 16, color: '#727693', fontSize: 12 }}>No se encontraron miembros.</div>
                  ) : null}
                </div>
              </div>

              {/* Audit logs */}
              <div style={{ marginTop: 24, borderRadius: 18, border: '1px solid rgba(255,255,255,.06)', padding: 14, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f4ff' }}>Auditoría</div>
                    <div style={{ fontSize: 11, color: '#727693' }}>Altas, expulsiones, CoA y cambios</div>
                  </div>
                  <button type="button" onClick={() => void loadAuditLogs()} style={{ background: 'none', border: 'none', color: '#9ca0b8', fontSize: 11, cursor: 'pointer' }}>Recargar</button>
                </div>
                {auditLoading ? <div style={{ padding: 12, color: '#727693', fontSize: 12 }}>Cargando...</div> : null}
                {!auditLoading && auditLogs.length === 0 ? <div style={{ padding: 12, color: '#727693', fontSize: 12 }}>Aún no hay registros.</div> : null}
                {!auditLoading ? auditLogs.map((entry) => (
                  <div key={entry.id} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.02)', marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#f0f4ff' }}>{formatAuditAction(entry)}</div>
                      <div style={{ fontSize: 10, color: '#727693' }}>{formatTime(entry.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca0b8', marginTop: 2 }}>{formatAuditMeta(entry)}</div>
                  </div>
                )) : null}
              </div>

              {/* ── Zona de peligro ── */}
              <div style={{ marginTop: 28, borderRadius: 18, border: '1px solid rgba(239,68,68,.25)', padding: 16, background: 'rgba(239,68,68,.04)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fca5a5', marginBottom: 4 }}>Zona de peligro</div>
                <div style={{ fontSize: 11, color: '#fca5a5', opacity: 0.7, marginBottom: 12 }}>Eliminar el grupo permanentemente. Esta acción no se puede deshacer. Se borrarán todos los canales, mensajes, miembros, registros y archivos asociados.</div>
                <button type="button" disabled={destructBusy} onClick={() => void handleHardDeleteGroup()} style={{ width: '100%', padding: '12px', borderRadius: 14, border: '1px solid rgba(239,68,68,.35)', background: destructBusy ? 'rgba(239,68,68,.1)' : 'rgba(239,68,68,.15)', color: '#fca5a5', fontSize: 13, fontWeight: 700, cursor: destructBusy ? 'wait' : 'pointer', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {destructBusy ? 'Eliminando...' : 'Eliminar grupo'}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Banned Members Panel ── */}
      {activePanel === 'banned' && canOpenSettings ? (
        <>
          <div onClick={() => setActivePanel(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.5)' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 90, width: 'min(420px, 100vw)', background: '#0b0d1e', borderLeft: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,.5)', animation: 'slideInRight .2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#f0f4ff' }}>Miembros baneados</span>
                <div style={{ fontSize: 11, color: '#727693', textTransform: 'uppercase', letterSpacing: '.08em' }}>{currentGroup?.bannedCount ?? 0} usuarios</div>
              </div>
              <button onClick={() => setActivePanel(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.08)', color: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {/* Search */}
              <div style={{ marginBottom: 12 }}>
                <input
                  value={bannedSearch}
                  onChange={(e) => setBannedSearch(e.target.value)}
                  placeholder="Buscar por @nombre..."
                  style={{ width: '100%', background: '#11142a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f0f4ff', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Banned list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(currentGroup?.members ?? [])
                  .filter((m) => m.isBanned)
                  .filter((m) => {
                    if (!bannedSearch.trim()) return true;
                    const q = bannedSearch.toLowerCase().replace('@', '');
                    return m.user.displayName.toLowerCase().includes(q);
                  })
                  .map((m) => (
                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.02)' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111925', border: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>
                        {m.user.avatarUrl ? <img src={resolveMediaUrl(m.user.avatarUrl)} alt={m.user.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{m.user.displayName.slice(0, 2).toUpperCase()}</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4ff', cursor: 'pointer' }} onClick={() => handleOpenProfile(m.userId)}>@{m.user.displayName}</div>
                        <div style={{ fontSize: 10, color: '#ef4444' }}>Baneado</div>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const menu = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
                            if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
                          }}
                          disabled={memberModerationBusy === m.userId || roleChangeBusy === m.userId}
                          style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.04)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, opacity: (memberModerationBusy === m.userId || roleChangeBusy === m.userId) ? 0.4 : 1 }}
                          aria-label="Opciones"
                        >⋯</button>
                        <div style={{ display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: 4, minWidth: 180, background: '#1a1d35', borderRadius: 14, border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 8px 32px rgba(0,0,0,.5)', padding: 6, zIndex: 50, flexDirection: 'column', gap: 2 }}>
                          {canAssignRoles ? (
                            <button
                              onClick={() => {
                                void setMemberRole(m.userId, m.role === 'GROUP_MODERATOR' ? 'GROUP_MEMBER' : 'GROUP_MODERATOR');
                                const menu = document.activeElement?.closest('[style*="display: flex"]');
                                if (menu) (menu as HTMLElement).style.display = 'none';
                              }}
                              disabled={roleChangeBusy === m.userId}
                              style={{ background: 'none', border: 'none', color: '#cdbfff', padding: '10px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, opacity: roleChangeBusy === m.userId ? 0.4 : 1 }}
                            >
                              {m.role === 'GROUP_MODERATOR' ? 'Quitar CoA' : 'Dar CoA'}
                            </button>
                          ) : null}
                          <button
                            onClick={() => {
                              void moderateMember(m.userId, 'UNBAN');
                              const menu = document.activeElement?.closest('[style*="display: flex"]');
                              if (menu) (menu as HTMLElement).style.display = 'none';
                            }}
                            disabled={memberModerationBusy === m.userId}
                            style={{ background: 'none', border: 'none', color: '#86efac', padding: '10px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, opacity: memberModerationBusy === m.userId ? 0.4 : 1 }}
                          >
                            Desbanear
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                {(currentGroup?.members ?? []).filter((m) => m.isBanned).filter((m) => { const q = bannedSearch.toLowerCase().replace('@', ''); return !bannedSearch.trim() || m.user.displayName.toLowerCase().includes(q); }).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: '#727693', fontSize: 13 }}>No hay miembros baneados{ bannedSearch ? ' que coincidan con la búsqueda' : ''}.</div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function truncateName(value: string) {
  return value.length > 10 ? `${value.slice(0, 9)}.` : value;
}

function chunkItems<T>(items: T[], size: number) {
  if (size <= 0) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function MicMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ParticipantMicIcon({ muted }: { muted: boolean }) {
  return (
    <span className="relative flex h-4 w-4 items-center justify-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <rect x="9" y="4" width="6" height="10" rx="3" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {muted ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute h-4 w-4">
          <path d="m5 5 14 14" strokeLinecap="round" />
        </svg>
      ) : null}
    </span>
  );
}

function BackMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotsMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatAuditAction(entry: GroupAuditLog) {
  const actor = entry.actor?.displayName ?? 'Sistema';
  const target = entry.target?.displayName ?? 'usuario';

  switch (entry.action) {
    case 'GROUP_UPDATED':
      return `${actor} editó el grupo`;
    case 'MEMBER_JOINED':
      return `${target} entró al grupo`;
    case 'MEMBER_KICK':
      return `${actor} expulsó a ${target}`;
    case 'MEMBER_BAN':
    case 'MEMBER_PERMABAN':
      return `${actor} expulsó a ${target}`;
    case 'MEMBER_UNBAN':
      return `${actor} rehabilitó a ${target}`;
    case 'MEMBER_ROLE_CHANGED':
      return `${actor} cambió el rol de ${target}`;
    default:
      return entry.action;
  }
}

function formatAuditMeta(entry: GroupAuditLog) {
  if (entry.action === 'MEMBER_ROLE_CHANGED' && typeof entry.metadata.role === 'string') {
    return entry.metadata.role === 'GROUP_MODERATOR' ? 'Nuevo rol: CoA' : 'Nuevo rol: miembro';
  }
  if (typeof entry.metadata.reason === 'string' && entry.metadata.reason) {
    return `Motivo: ${entry.metadata.reason}`;
  }
  if (entry.action === 'GROUP_UPDATED') {
    return 'Se guardaron cambios de nombre, descripción, foto o privacidad.';
  }
  return 'Acción registrada correctamente.';
}

function emit<T = any>(socket: any, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response: any) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
