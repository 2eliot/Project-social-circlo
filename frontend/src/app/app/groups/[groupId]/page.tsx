'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ChannelView } from '@/features/channels/ChannelView';
import { resolveMediaUrl } from '@/lib/media-url';
import { getSocket } from '@/lib/socket-client';
import { SfuClient } from '@/lib/mediasoup-client';
import { useAuth } from '@/store/auth.store';

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
  const [voiceRequestPending, setVoiceRequestPending] = useState(false);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceJoinBusy, setVoiceJoinBusy] = useState(false);
  const [localMicMuted, setLocalMicMuted] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [roleChangeBusy, setRoleChangeBusy] = useState<string | null>(null);
  const [memberModerationBusy, setMemberModerationBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<GroupAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [groupSaveBusy, setGroupSaveBusy] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', privacy: 'PRIVATE' as GroupDetail['privacy'], iconUrl: null as string | null });
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const sfuRef = useRef<SfuClient | null>(null);

  async function loadGroup() {
    const nextGroup = await api<GroupDetail>(`/groups/${groupId}`);
    setGroup(nextGroup);
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
    };
    socket.on('channel_updated', onChannelUpdated);

    return () => {
      socket.emit('leave_group', { groupId });
      socket.off('channel_updated', onChannelUpdated);
    };
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
  const textPanelHeightClass = showVoicePanel ? 'h-[360px]' : 'h-[calc(100vh-10.5rem)] min-h-[560px] max-h-[760px]';
  const voiceParticipantPages = chunkItems(voiceParticipants, 8);
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

  useEffect(() => {
    if (!currentGroup) return;
    setGroupForm({
      name: currentGroup.name,
      description: currentGroup.description ?? '',
      privacy: currentGroup.privacy,
      iconUrl: currentGroup.iconUrl ?? null,
    });
  }, [currentGroup]);

  useEffect(() => {
    if (!settingsOpen || !canOpenSettings) return;
    void loadAuditLogs();
  }, [settingsOpen, canOpenSettings, groupId]);

  useEffect(() => {
    if (!voiceChannel || !user) return;

    const socket = getSocket('/sfu');
    let mounted = true;

    const applyState = (state: { participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[] }) => {
      if (!mounted) return;
      setVoiceParticipants(
        (state.participants ?? []).map((participant) =>
          participant.id === user.id && voiceJoined ? { ...participant, micMuted: localMicMuted } : participant,
        ),
      );
      setPendingVoiceRequests(state.pendingRequests ?? []);
      const joined = Boolean(state.participants?.some((item) => item.id === user.id));
      const requested = Boolean(state.pendingRequests?.some((item) => item.id === user.id));
      setVoiceJoined(joined);
      setVoiceRequestPending(requested && !joined);
    };

    emit<{ participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[] }>(socket, 'watch_voice_state', { channelId: voiceChannel.id })
      .then(applyState)
      .catch(() => undefined);

    const onState = (state: { channelId: string; participants: VoiceStateUser[]; pendingRequests: VoiceStateUser[] }) => {
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

  // Disconnect SFU when leaving the page
  useEffect(() => {
    return () => {
      sfuRef.current?.disconnect().catch(() => undefined);
      sfuRef.current = null;
    };
  }, []);

  // Auto-subscribe in listen-only mode so every group member hears the voice
  // channel without explicitly joining as a speaker. When the user later clicks
  // "join", the speaker connection replaces this passive one.
  useEffect(() => {
    if (!voiceChannel || !voiceChannel.isEnabled) return;
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
      })
      .catch((err) => {
        console.warn('[group] listen-only connect failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [voiceChannel?.id, voiceChannel?.isEnabled, voiceJoined]);

  if (!currentGroup) return <p className="p-6 opacity-70">Cargando…</p>;

  function handleOpenProfile(userId: string) {
    router.push(`/app?profileUserId=${encodeURIComponent(userId)}`);
  }

  async function toggleChannel(channel: Channel, enabled: boolean) {
    if (!canManageChannels) return;
    setChannelToggleBusy(channel.id);
    setFeedback(null);

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
      setFeedback(error instanceof Error ? error.message : 'No se pudo actualizar el rol del usuario.');
    } finally {
      setRoleChangeBusy(null);
    }
  }

  async function moderateMember(memberUserId: string, action: 'BAN' | 'KICK' | 'PERMABAN') {
    setMemberModerationBusy(memberUserId);
    setFeedback(null);

    try {
      await api(`/groups/${groupId}/members/${memberUserId}/moderate`, {
        method: 'POST',
        body: { action },
      });
      if (action === 'KICK') {
        updateMemberState(memberUserId, () => null);
      } else {
        updateMemberState(memberUserId, (member) => ({ ...member, isBanned: true }));
      }
      setVoiceParticipants((current) => current.filter((participant) => participant.id !== memberUserId));
      setPendingVoiceRequests((current) => current.filter((participant) => participant.id !== memberUserId));
      setSelectedMemberId(null);
    } catch (error) {
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
        },
      });
      await Promise.all([loadGroup(), loadAuditLogs()]);
      setFeedback('Grupo actualizado.');
      setSettingsOpen(false);
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(96,249,255,.14),transparent_25%),radial-gradient(circle_at_bottom,rgba(230,90,255,.16),transparent_32%),#070b12] pb-8 text-white">
      <div className="mx-auto w-full max-w-[430px] px-3 pt-3">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => router.push('/app')}
            className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-white/82 shadow-[0_10px_24px_rgba(0,0,0,.24)]"
            aria-label="Regresar"
          >
            <BackMiniIcon />
          </button>
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold text-white/92">{currentGroup.name}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-white/42">Grupo</div>
          </div>
          {canOpenSettings ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-white/82 shadow-[0_10px_24px_rgba(0,0,0,.24)]"
              aria-label="Ajustes del grupo"
            >
              <DotsMiniIcon />
            </button>
          ) : null}
        </div>

        <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(27,33,50,.96),rgba(10,14,24,.98))] shadow-[0_24px_60px_rgba(0,0,0,.42)] backdrop-blur-[18px]">
          {showVoicePanel ? (
            <>
              <div className="px-4 pb-5 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.08em] text-[#7befff] [text-shadow:0_0_18px_rgba(123,239,255,.35)]">Escritorio de voz y turno</div>
                  <button
                    type="button"
                    disabled={voiceJoinBusy || !voiceChannel?.isEnabled}
                    onClick={() => void handleVoiceAction()}
                    className={`inline-flex min-w-[130px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition disabled:opacity-50 ${voiceJoined ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,.18)]' : voiceRequestPending ? 'border-amber-300/25 bg-amber-500/10 text-amber-100' : 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(74,241,255,.18)]'}`}
                  >
                    <VoiceJoinIcon joined={voiceJoined} pending={voiceRequestPending} />
                    <span>{voiceJoined ? 'Bajar de voz' : canManageChannels ? 'Subir a voz' : voiceRequestPending ? 'Esperando' : 'Subir a voz'}</span>
                  </button>
                </div>

                {canManageChannels && pendingVoiceRequests.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {pendingVoiceRequests.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => void approveVoiceRequest(member.id)}
                        disabled={voiceJoinBusy}
                        className="rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fuchsia-100 disabled:opacity-50"
                      >
                        Aceptar a {truncateName(member.displayName)}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-5">
                  {voiceParticipants.length === 0 ? (
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/48">Nadie ha subido al chat de voz todavia.</div>
                  ) : (
                    <div className="overflow-x-auto pb-2 [scrollbar-color:rgba(123,239,255,.45)_transparent] [scrollbar-width:thin]">
                      <div className="flex snap-x snap-mandatory gap-3">
                        {voiceParticipantPages.map((page, pageIndex) => (
                          <div key={`voice-page-${pageIndex}`} className="min-w-full snap-start rounded-[24px] border border-white/8 bg-white/[0.02] px-3 py-3">
                            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                              {page.map((member, index) => (
                                <div key={member.id} className="relative text-center" data-member-menu-root="true">
                                  <div className={`relative mx-auto h-[68px] w-[68px] rounded-full p-[3px] ${pageIndex === 0 && index < 2 ? 'bg-[linear-gradient(135deg,#7df7ff,#57b3ff)] shadow-[0_0_18px_rgba(113,247,255,.32)]' : 'bg-[linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,.08))]'}`}>
                                    <button
                                      type="button"
                                      onClick={() => router.push(`/app?profileUserId=${encodeURIComponent(member.id)}`)}
                                      onContextMenu={(event) => {
                                        if ((!canAssignRoles && !canModerateMembers) || member.id === user?.id) return;
                                        event.preventDefault();
                                        setSelectedMemberId((current) => (current === member.id ? null : member.id));
                                      }}
                                      className="relative h-full w-full overflow-hidden rounded-full border border-white/12 bg-[#111925]"
                                    >
                                        {member.avatarUrl ? <img src={resolveMediaUrl(member.avatarUrl)} alt={member.displayName} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-base font-black text-white/88">{member.displayName.slice(0, 2).toUpperCase()}</div>}
                                      <div className={`absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-[0_0_12px_rgba(113,247,255,.22)] ${member.micMuted ? 'border-rose-300/45 bg-[#3a1520] text-rose-200' : 'border-emerald-300/45 bg-[#133326] text-emerald-200'}`}>
                                        <ParticipantMicIcon muted={member.micMuted} />
                                      </div>
                                      {pageIndex === 0 && index < 2 ? <div className="absolute inset-y-1 left-[-6px] w-1.5 rounded-full bg-[radial-gradient(circle,rgba(123,239,255,.95),rgba(123,239,255,0))] blur-[2px]" /> : null}
                                    </button>
                                  </div>
                                  <div className="mt-1.5 truncate text-[10px] font-black uppercase tracking-[0.02em] text-white/92">{truncateName(member.displayName)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {voiceParticipants.length > 8 ? <div className="mt-2 text-right text-[9px] font-black uppercase tracking-[0.16em] text-white/34">Desliza a la derecha para ver mas</div> : null}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(74,241,255,.95),rgba(74,241,255,.25))] shadow-[0_0_14px_rgba(74,241,255,.24)]" />
                  <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(243,102,255,.95),rgba(243,102,255,.25))] shadow-[0_0_14px_rgba(243,102,255,.24)]" />
                </div>
              </div>

              <div className="h-px bg-[linear-gradient(90deg,rgba(122,241,255,.28),rgba(245,106,255,.4),rgba(122,241,255,.28))]" />
            </>
          ) : null}

          <div className="px-4 pb-4 pt-4">
            {canManageChannels && textChannel && !textChannel.isEnabled ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={channelToggleBusy === textChannel.id}
                  onClick={() => void toggleChannel(textChannel, true)}
                  className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-fuchsia-100 disabled:opacity-50"
                >
                  Encender texto
                </button>
              </div>
            ) : null}
            {feedback ? <div className="mt-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{feedback}</div> : null}

            <div className={`${feedback || (canManageChannels && textChannel && !textChannel.isEnabled) ? 'mt-2' : ''} ${textPanelHeightClass}`}>
              {showTextPanel && textChannel ? (
                <ChannelView
                  channel={textChannel}
                  minimal
                  showComposer={textChannel.isEnabled}
                  showVoiceControls
                  canToggleVoice={canManageChannels && Boolean(voiceChannel)}
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
                />
              ) : (
                <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(13,18,34,.96),rgba(8,11,20,.98))]">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_22%,rgba(87,241,255,.14),transparent_18%),radial-gradient(circle_at_78%_26%,rgba(233,95,255,.12),transparent_20%)]" />
                  <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/55">
                    El chat de texto esta apagado. Espera a que un admin o CoA lo encienda.
                  </div>
                  <div className="border-t border-white/8 bg-[linear-gradient(180deg,rgba(9,12,23,.92),rgba(11,15,27,.98))] px-3 pb-3 pt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-12 items-center gap-2 rounded-[16px] border border-white/8 bg-white/[0.03] px-3 text-sm text-white/60">
                        <MicMiniIcon />
                        <span>{voiceJoined ? 'Ya estas arriba en el chat de voz' : voiceRequestPending ? 'Solicitud enviada al admin o CoA' : 'Usa el boton de arriba para subir a voz'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      {renderMemberPopup()}
      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-3 pb-3 pt-12 backdrop-blur-[2px]">
          <button type="button" className="absolute inset-0" aria-label="Cerrar ajustes" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,23,35,.98),rgba(8,11,20,.99))] shadow-[0_28px_60px_rgba(0,0,0,.42)]">
            <div className="max-h-[82vh] overflow-y-auto px-4 pb-5 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/92">Ajustes del grupo</div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-white/42">Admin y CoA</div>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} className="text-xs font-semibold text-white/60">Cerrar</button>
              </div>

              <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-[#111925]"
                  >
                    {groupForm.iconUrl ? <img src={resolveMediaUrl(groupForm.iconUrl)} alt={groupForm.name} className="h-full w-full object-cover" /> : <span className="text-lg font-black text-white/82">{groupForm.name.slice(0, 2).toUpperCase()}</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.1em] text-white/55">Portada</div>
                    <button type="button" onClick={() => iconInputRef.current?.click()} className="mt-1 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
                      Cambiar foto
                    </button>
                  </div>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadGroupIcon(file);
                      event.target.value = '';
                    }}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/48">Nombre</div>
                    <input value={groupForm.name} onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value.slice(0, 60) }))} className="w-full rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white" />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/48">Descripción</div>
                    <textarea value={groupForm.description} onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value.slice(0, 280) }))} rows={3} className="w-full rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white" />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/48">Privacidad</div>
                    <select value={groupForm.privacy} onChange={(event) => setGroupForm((current) => ({ ...current, privacy: event.target.value as GroupDetail['privacy'] }))} className="w-full rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white">
                      <option value="PUBLIC_INVITE">Publico con invitación</option>
                      <option value="PRIVATE">Privado</option>
                      <option value="SECRET">Secreto</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 flex justify-end">
                  <button type="button" disabled={groupSaveBusy} onClick={() => void saveGroupSettings()} className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-fuchsia-100 disabled:opacity-50">
                    {groupSaveBusy ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white/92">Auditoría</div>
                    <div className="text-[11px] text-white/48">Altas, expulsiones, CoA y cambios del grupo</div>
                  </div>
                  <button type="button" onClick={() => void loadAuditLogs()} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/58">Recargar</button>
                </div>
                <div className="mt-3 space-y-2">
                  {auditLoading ? <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/52">Cargando auditoría...</div> : null}
                  {!auditLoading && auditLogs.length === 0 ? <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/52">Aún no hay registros.</div> : null}
                  {!auditLoading ? auditLogs.map((entry) => (
                    <div key={entry.id} className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-white/90">{formatAuditAction(entry)}</div>
                        <div className="text-[10px] uppercase tracking-[0.08em] text-white/36">{formatTime(entry.createdAt)}</div>
                      </div>
                      <div className="mt-1 text-[11px] text-white/58">{formatAuditMeta(entry)}</div>
                    </div>
                  )) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
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
