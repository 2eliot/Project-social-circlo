import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import type { Transport, Producer, Consumer } from 'mediasoup/node/lib/types';
import { WsAuthService, SocketUser } from '../ws-auth.service';
import { MediasoupService } from '../mediasoup/mediasoup.service';
import { PrismaService } from '../../infrastructure/database/prisma.module';

interface SignalingSocket extends Socket {
  data: {
    user: SocketUser;
    channelId?: string;
    /** When true, the socket is only consuming audio (no produce allowed). */
    voiceListenOnly: boolean;
    micMuted: boolean;
    transports: Map<string, Transport>;
    producers: Map<string, Producer>;
    consumers: Map<string, Consumer>;
    watchedChannels: Set<string>;
  };
}

/**
 * Mediasoup signaling. The client first joins a channel, fetches RTP
 * capabilities, then negotiates a send transport (for its mic/cam/screen) and
 * a recv transport (to consume the other participants' streams).
 *
 * Moderators may forcibly close any producer via `mod_close_producer`.
 */
@WebSocketGateway({ namespace: '/sfu', cors: true })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(SignalingGateway.name);
  private readonly pendingVoiceRequests = new Map<string, Set<string>>();
  private readonly approvedVoiceRequests = new Map<string, Set<string>>();
  /** Grace period timers for speakers who disconnect (e.g. page refresh).
   *  Key: `userId:channelId`. If the user reconnects within 3 s the delayed
   *  peer_left / emitVoiceState is cancelled so the speaker slot stays. */
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly auth: WsAuthService, private readonly sfu: MediasoupService, private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      (socket as SignalingSocket).data = {
        user,
        voiceListenOnly: false,
        micMuted: true,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        watchedChannels: new Set(),
      };
    } catch {
      socket.disconnect(true);
    }
  }

  async handleDisconnect(rawSocket: Socket) {
    const socket = rawSocket as SignalingSocket;
    const channelId = socket.data?.channelId;
    const userId = socket.data?.user?.id;
    const wasSpeaker = channelId && !socket.data.voiceListenOnly;

    // Free mediasoup resources held by this socket immediately — transports
    // release the UDP ports from the announced range; without this we exhaust
    // 40000-40099. The new socket will create fresh ones on reconnect.
    this.closeSocketResources(socket);

    if (wasSpeaker && userId) {
      // ── Grace period for speakers ──
      // On a full page refresh (F5) the old socket disconnects and the new one
      // reconnects within ~1-2 s.  Delaying peer_left / emitVoiceState by 3 s
      // prevents the user from temporarily disappearing for other participants
      // and gives the frontend time to auto-upgrade from listen-only to speaker.
      const timerKey = `${userId}:${channelId}`;
      // Clear any existing timer (paranoid safety against double disconnect)
      const existing = this.disconnectTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.disconnectTimers.set(
        timerKey,
        setTimeout(async () => {
          this.disconnectTimers.delete(timerKey);
          // If the user hasn't reconnected as a speaker by now, notify others
          const isStillSpeaking = await this.isUserSpeaking(channelId!, userId);
          if (!isStillSpeaking) {
            // Remove participant from database when grace period expires and user hasn't reconnected
            await this.prisma.voiceParticipant.deleteMany({
              where: { channelId: channelId!, userId },
            });
            socket.to(`voice:${channelId}`).emit('peer_left', { userId });
            await this.emitVoiceState(channelId!);
          }
        }, 3_000),
      );
    } else if (channelId) {
      // Listen-only disconnection — no grace period needed; just update state.
      await this.emitVoiceState(channelId);
    }

    // Clean up any pending voice join requests from this user
    for (const [watchedChannelId, pending] of this.pendingVoiceRequests.entries()) {
      if (pending.delete(socket.data?.user?.id)) {
        await this.emitVoiceState(watchedChannelId);
      }
    }
  }

  /** Check whether a user is currently a speaker in a given voice channel. */
  private async isUserSpeaking(channelId: string, userId: string): Promise<boolean> {
    const sockets = await this.server.in(`voice:${channelId}`).fetchSockets();
    return sockets.some(
      (raw) => {
        const s = raw as unknown as SignalingSocket;
        return s.data?.user?.id === userId && !s.data?.voiceListenOnly;
      },
    );
  }

  /** Cancel a pending disconnect grace-period timer for the given user+channel. */
  private cancelDisconnectTimer(userId: string, channelId: string) {
    const timerKey = `${userId}:${channelId}`;
    const timer = this.disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(timerKey);
    }
  }

  private closeSocketResources(socket: SignalingSocket) {
    // Socket.IO default socket.data is {} — check consumers is a Map before
    // iterating, in case handleDisconnect fires before handleConnection finishes.
    if (!socket.data || !(socket.data.consumers instanceof Map)) return;
    for (const consumer of socket.data.consumers.values()) {
      try { consumer.close(); } catch { /* ignore */ }
    }
    socket.data.consumers.clear();
    for (const producer of socket.data.producers.values()) {
      try { producer.close(); } catch { /* ignore */ }
    }
    socket.data.producers.clear();
    for (const transport of socket.data.transports.values()) {
      try { transport.close(); } catch { /* ignore */ }
    }
    socket.data.transports.clear();
  }

  @SubscribeMessage('watch_voice_state')
  async watchVoiceState(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { channelId: string }) {
    await this.getChannelAccess(body.channelId, socket.data.user.id);
    socket.data.watchedChannels.add(body.channelId);
    await socket.join(`voice-watch:${body.channelId}`);
    return this.buildVoiceState(body.channelId);
  }

  @SubscribeMessage('request_join_voice')
  async requestJoinVoice(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { channelId: string }) {
    const access = await this.getChannelAccess(body.channelId, socket.data.user.id);
    if (!access.channel.isEnabled && !access.canManage) {
      throw new WsException('Voice channel disabled');
    }
    // Admins / CoA self-join without approval.
    if (access.canManage) {
      return this.joinVoice(socket, body);
    }
    // Already approved? proceed to join.
    if (this.getSet(this.approvedVoiceRequests, body.channelId).has(socket.data.user.id)) {
      return this.joinVoice(socket, body);
    }
    // Regular member: register the request and notify managers via voice_state.
    this.getSet(this.pendingVoiceRequests, body.channelId).add(socket.data.user.id);
    await this.emitVoiceState(body.channelId);
    return { ok: true, pending: true };
  }

  @SubscribeMessage('approve_voice_request')
  async approveVoiceRequest(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { channelId: string; userId: string }) {
    const access = await this.getChannelAccess(body.channelId, socket.data.user.id);
    if (!access.canManage) throw new WsException('Forbidden');

    this.getSet(this.pendingVoiceRequests, body.channelId).delete(body.userId);
    this.getSet(this.approvedVoiceRequests, body.channelId).add(body.userId);
    await this.emitToUser(body.userId, 'voice_request_approved', { channelId: body.channelId });
    await this.emitVoiceState(body.channelId);
    return { ok: true };
  }

  @SubscribeMessage('join_voice')
  async joinVoice(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { channelId: string }) {
    const access = await this.getChannelAccess(body.channelId, socket.data.user.id);
    if (!access.channel.isEnabled && !access.canManage) {
      throw new WsException('Voice channel disabled');
    }
    // Regular members must be approved by a manager (admin / CoA) before producing.
    if (!access.canManage && !this.getSet(this.approvedVoiceRequests, body.channelId).has(socket.data.user.id)) {
      throw new WsException('Approval required');
    }

    // If the socket was a passive listener of another channel, drop it first.
    if (socket.data.channelId && socket.data.channelId !== body.channelId) {
      await socket.leave(`voice:${socket.data.channelId}`);
    }

    // Remove any pending/approval state
    this.getSet(this.pendingVoiceRequests, body.channelId).delete(socket.data.user.id);
    this.getSet(this.approvedVoiceRequests, body.channelId).delete(socket.data.user.id);
    socket.data.channelId = body.channelId;
    socket.data.voiceListenOnly = false;
    socket.data.micMuted = true;
    await socket.join(`voice:${body.channelId}`);
    
    // Persist participant to database (survives page navigation)
    await this.prisma.voiceParticipant.upsert({
      where: { channelId_userId: { channelId: body.channelId, userId: socket.data.user.id } },
      update: { updatedAt: new Date() },
      create: { channelId: body.channelId, userId: socket.data.user.id, micMuted: true },
    });
    
    this.cancelDisconnectTimer(socket.data.user.id, body.channelId);
    socket.to(`voice:${body.channelId}`).emit('peer_joined', { userId: socket.data.user.id });
    await this.emitVoiceState(body.channelId);

    // Return RTP capabilities so the client can load the mediasoup Device
    const rtpCapabilities = await this.sfu.rtpCapabilities(body.channelId);
    return { ok: true, rtpCapabilities };
  }

  /**
   * Subscribe to a voice channel in listen-only mode. The socket joins the
   * room to receive `new_producer` events and may create a recv transport plus
   * consumers, but cannot produce. Used so that every group member hears the
   * voice channel without explicitly joining as a speaker.
   */
  @SubscribeMessage('listen_voice')
  async listenVoice(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { channelId: string }) {
    const access = await this.getChannelAccess(body.channelId, socket.data.user.id);
    // Listen-only is always allowed — keeps the online counter accurate even when
    // the channel is disabled. isEnabled only gates speaking, not passive listening.

    // Already a speaker in the same channel? Nothing to do (speakers also consume).
    if (socket.data.channelId === body.channelId && !socket.data.voiceListenOnly) {
      const rtpCapabilities = await this.sfu.rtpCapabilities(body.channelId);
      return { ok: true, rtpCapabilities };
    }

    // If listening another channel, leave it first.
    if (socket.data.channelId && socket.data.channelId !== body.channelId) {
      await socket.leave(`voice:${socket.data.channelId}`);
    }

    socket.data.channelId = body.channelId;
    socket.data.voiceListenOnly = true;
    socket.data.micMuted = true;
    await socket.join(`voice:${body.channelId}`);
    this.cancelDisconnectTimer(socket.data.user.id, body.channelId);

    const rtpCapabilities = await this.sfu.rtpCapabilities(body.channelId);
    return { ok: true, rtpCapabilities };
  }

  @SubscribeMessage('get_producers')
  async getProducers(@ConnectedSocket() socket: SignalingSocket) {
    if (!socket.data.channelId) throw new WsException('Not in a channel');
    const sockets = await this.server.in(`voice:${socket.data.channelId}`).fetchSockets();
    const producers: Array<{ producerId: string; userId: string; kind: string }> = [];
    for (const s of sockets) {
      const ss = s as unknown as SignalingSocket;
      if (ss.id === socket.id) continue; // skip self
      for (const [producerId, producer] of (ss.data.producers ?? new Map())) {
        producers.push({ producerId, userId: ss.data.user.id, kind: producer.kind });
      }
    }
    return producers;
  }

  @SubscribeMessage('set_mic_muted')
  async setMicMuted(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { muted: boolean; channelId?: string }) {
    const channelId = body.channelId ?? socket.data.channelId;
    if (!channelId || socket.data.channelId !== channelId || socket.data.voiceListenOnly) {
      throw new WsException('Not in voice channel');
    }

    socket.data.micMuted = body.muted;
    
    // Persist mic muted state to database
    await this.prisma.voiceParticipant.updateMany({
      where: { channelId, userId: socket.data.user.id },
      data: { micMuted: body.muted },
    });
    
    await this.emitVoiceState(channelId);
    return { ok: true };
  }

  @SubscribeMessage('leave_voice')
  async leaveVoice(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body?: { channelId?: string }) {
    const channelId = body?.channelId ?? socket.data.channelId;
    if (!channelId) return { ok: true };
    const wasSpeaker = !socket.data.voiceListenOnly && socket.data.channelId === channelId;
    await socket.leave(`voice:${channelId}`);
    if (wasSpeaker) {
      socket.to(`voice:${channelId}`).emit('peer_left', { userId: socket.data.user.id });
    }
    // Release transports/producers/consumers so we don't leak UDP ports.
    this.closeSocketResources(socket);
    if (socket.data.channelId === channelId) {
      socket.data.channelId = undefined;
      socket.data.voiceListenOnly = false;
      socket.data.micMuted = true;
    }
    
    // Remove participant from database when leaving
    await this.prisma.voiceParticipant.deleteMany({
      where: { channelId, userId: socket.data.user.id },
    });
    
    await this.emitVoiceState(channelId);
    return { ok: true };
  }

  @SubscribeMessage('create_transport')
  async createTransport(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { direction: 'send' | 'recv' }) {
    if (!socket.data.channelId) throw new WsException('Not in a channel');
    const { transport, params } = await this.sfu.createWebRtcTransport(socket.data.channelId);
    socket.data.transports.set(transport.id, transport);
    return { direction: body.direction, params };
  }

  @SubscribeMessage('connect_transport')
  async connectTransport(
    @ConnectedSocket() socket: SignalingSocket,
    @MessageBody() body: { transportId: string; dtlsParameters: any },
  ) {
    const t = socket.data.transports.get(body.transportId);
    if (!t) throw new WsException('Transport not found');
    await t.connect({ dtlsParameters: body.dtlsParameters });
    return { ok: true };
  }

  @SubscribeMessage('produce')
  async produce(
    @ConnectedSocket() socket: SignalingSocket,
    @MessageBody() body: { transportId: string; kind: 'audio' | 'video'; rtpParameters: any; appData?: Record<string, unknown> },
  ) {
    this.logger.log(`produce: user=${socket.data.user.id} kind=${body.kind} channel=${socket.data.channelId}`);
    if (socket.data.voiceListenOnly) throw new WsException('Listen-only socket cannot produce');
    if (!socket.data.channelId) throw new WsException('Not in a voice channel');
    const t = socket.data.transports.get(body.transportId);
    if (!t) throw new WsException('Transport not found');
    const producer = await t.produce({
      kind: body.kind,
      rtpParameters: body.rtpParameters,
      appData: { ...body.appData, userId: socket.data.user.id },
    });
    socket.data.producers.set(producer.id, producer);

    // Notify peers so they can consume.
    socket
      .to(`voice:${socket.data.channelId}`)
      .emit('new_producer', { producerId: producer.id, userId: socket.data.user.id, kind: body.kind });
    this.logger.log(`producer created id=${producer.id} — notified room voice:${socket.data.channelId}`);

    producer.on('transportclose', () => producer.close());
    return { id: producer.id };
  }

  @SubscribeMessage('consume')
  async consume(
    @ConnectedSocket() socket: SignalingSocket,
    @MessageBody() body: { transportId: string; producerId: string; rtpCapabilities: any },
  ) {
    this.logger.log(`consume: user=${socket.data.user.id} producerId=${body.producerId}`);
    if (!socket.data.channelId) throw new WsException('Not in a channel');
    const router = await this.sfu.getOrCreateRouter(socket.data.channelId);
    if (!router.canConsume({ producerId: body.producerId, rtpCapabilities: body.rtpCapabilities })) {
      throw new WsException('Cannot consume');
    }
    const t = socket.data.transports.get(body.transportId);
    if (!t) throw new WsException('Transport not found');
    const consumer = await t.consume({
      producerId: body.producerId,
      rtpCapabilities: body.rtpCapabilities,
      paused: true,
    });
    socket.data.consumers.set(consumer.id, consumer);
    return {
      id: consumer.id,
      producerId: body.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  @SubscribeMessage('resume_consumer')
  async resumeConsumer(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { consumerId: string }) {
    const c = socket.data.consumers.get(body.consumerId);
    if (!c) throw new WsException('Consumer not found');
    await c.resume();
    return { ok: true };
  }

  /** Moderator-only: forcibly stop a producer (e.g. policy violation). */
  @SubscribeMessage('mod_close_producer')
  async modCloseProducer(@ConnectedSocket() socket: SignalingSocket, @MessageBody() body: { producerId: string }) {
    const role = socket.data.user.role;
    if (role !== 'SUPER_ADMIN' && role !== 'GLOBAL_MODERATOR') {
      throw new WsException('Forbidden');
    }
    // Find producer across all sockets in this room.
    const room = `voice:${socket.data.channelId}`;
    const sockets = await this.server.in(room).fetchSockets();
    for (const s of sockets) {
      const ss = s as unknown as SignalingSocket;
      const p = ss.data.producers?.get(body.producerId);
      if (p) {
        p.close();
        ss.data.producers.delete(body.producerId);
        this.server.to(room).emit('producer_closed', { producerId: body.producerId, by: 'moderator' });
        return { ok: true };
      }
    }
    return { ok: false };
  }

  private getSet(map: Map<string, Set<string>>, key: string) {
    let current = map.get(key);
    if (!current) {
      current = new Set<string>();
      map.set(key, current);
    }
    return current;
  }

  private async getChannelAccess(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, groupId: true, isEnabled: true },
    });
    if (!channel) throw new WsException('Channel not found');

    // Owners always have full access regardless of membership role.
    const group = await this.prisma.group.findFirst({
      where: { id: channel.groupId, isDeleted: false },
      select: { ownerId: true },
    });
    const isOwner = group?.ownerId === userId;

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channel.groupId, userId } },
      select: { role: true, isBanned: true },
    });
    if (!isOwner && (!membership || membership.isBanned)) throw new WsException('Forbidden');

    return {
      channel,
      membership: membership ?? { role: 'GROUP_MEMBER' as const, isBanned: false },
      canManage: isOwner || membership?.role === 'GROUP_ADMIN' || membership?.role === 'GROUP_MODERATOR',
    };
  }

  private async getVoiceParticipantIds(channelId: string) {
    const sockets = (await this.server.in(`voice:${channelId}`).fetchSockets()) as unknown as SignalingSocket[];
    return Array.from(new Set(sockets.filter((s) => !s.data.voiceListenOnly).map((s) => s.data.user.id)));
  }

  private async buildVoiceState(channelId: string) {
    // Read participants from database (persisted across page navigation)
    const dbParticipants = await this.prisma.voiceParticipant.findMany({
      where: { channelId },
      include: {
        user: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
    });

    const participants = dbParticipants.map((p) => ({
      id: p.user.id,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      micMuted: p.micMuted,
    }));

    // Read pending requests from memory (temporary state)
    const pendingIds = Array.from(this.getSet(this.pendingVoiceRequests, channelId));
    const pendingUsers = pendingIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: pendingIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];

    // Count active sockets (for UI metrics)
    const participantSockets = (await this.server.in(`voice:${channelId}`).fetchSockets()) as unknown as SignalingSocket[];
    const totalActive = Array.from(new Set(participantSockets.map((s) => s.data.user.id))).length;

    return {
      channelId,
      participants,
      pendingRequests: pendingUsers,
      totalActive,
    };
  }

  private async emitVoiceState(channelId: string) {
    const state = await this.buildVoiceState(channelId);
    this.server.to(`voice-watch:${channelId}`).emit('voice_state_changed', state);
  }

  private async emitToUser(userId: string, event: string, payload: unknown) {
    const sockets = await this.server.fetchSockets();
    for (const rawSocket of sockets) {
      const socket = rawSocket as unknown as SignalingSocket;
      if (socket.data.user.id === userId) {
        socket.emit(event, payload);
      }
    }
  }
}
