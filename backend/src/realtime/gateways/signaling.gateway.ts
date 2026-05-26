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
    if (channelId) {
      if (!socket.data.voiceListenOnly) {
        socket.to(`voice:${channelId}`).emit('peer_left', { userId: socket.data.user.id });
      }
      await this.emitVoiceState(channelId);
    }

    for (const [watchedChannelId, pending] of this.pendingVoiceRequests.entries()) {
      if (pending.delete(socket.data?.user?.id)) {
        await this.emitVoiceState(watchedChannelId);
      }
    }
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
    if (!access.channel.isEnabled && !access.canManage) {
      throw new WsException('Voice channel disabled');
    }

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
    if (socket.data.channelId === channelId) {
      socket.data.channelId = undefined;
      socket.data.voiceListenOnly = false;
      socket.data.micMuted = true;
    }
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

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channel.groupId, userId } },
      select: { role: true, isBanned: true },
    });
    if (!membership || membership.isBanned) throw new WsException('Forbidden');

    return {
      channel,
      membership,
      canManage: membership.role === 'GROUP_ADMIN' || membership.role === 'GROUP_MODERATOR',
    };
  }

  private async getVoiceParticipantIds(channelId: string) {
    const sockets = (await this.server.in(`voice:${channelId}`).fetchSockets()) as unknown as SignalingSocket[];
    return Array.from(new Set(sockets.filter((s) => !s.data.voiceListenOnly).map((s) => s.data.user.id)));
  }

  private async buildVoiceState(channelId: string) {
    const participantSockets = (await this.server.in(`voice:${channelId}`).fetchSockets()) as unknown as SignalingSocket[];
    const uniqueParticipants = new Map<string, { id: string; micMuted: boolean }>();
    for (const participantSocket of participantSockets) {
      // Exclude listen-only sockets — they hear but don't participate as speakers.
      if (participantSocket.data.voiceListenOnly) continue;
      uniqueParticipants.set(participantSocket.data.user.id, {
        id: participantSocket.data.user.id,
        micMuted: participantSocket.data.micMuted,
      });
    }

    const participantIds = Array.from(uniqueParticipants.keys());
    const pendingIds = Array.from(this.getSet(this.pendingVoiceRequests, channelId));
    const allUserIds = Array.from(new Set([...participantIds, ...pendingIds]));
    const users = allUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    const userMap = new Map(users.map((item) => [item.id, item]));

    return {
      channelId,
      participants: participantIds
        .map((id) => {
          const user = userMap.get(id);
          if (!user) return null;
          return {
            ...user,
            micMuted: uniqueParticipants.get(id)?.micMuted ?? true,
          };
        })
        .filter(Boolean),
      pendingRequests: pendingIds
        .map((id) => userMap.get(id))
        .filter(Boolean),
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
