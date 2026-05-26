import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeEventsService {
  private socialServer?: Server;
  private chatServer?: Server;

  registerSocialServer(server: Server) {
    this.socialServer = server;
  }

  registerChatServer(server: Server) {
    this.chatServer = server;
  }

  emitFeedPostCreated(payload: unknown) {
    this.socialServer?.emit('feed_post_created', payload);
  }

  emitFeedPostUpdated(payload: unknown) {
    this.socialServer?.emit('feed_post_updated', payload);
  }

  emitFeedPostDeleted(payload: unknown) {
    this.socialServer?.emit('feed_post_deleted', payload);
  }

  emitDmMessage(userId: string, payload: unknown) {
    this.socialServer?.to(`user:${userId}`).emit('dm_message_new', payload);
  }

  emitNotification(userId: string, payload: unknown) {
    this.socialServer?.to(`user:${userId}`).emit('notification_new', payload);
  }

  emitDmTyping(peerId: string, payload: unknown) {
    this.socialServer?.to(`user:${peerId}`).emit('dm_typing', payload);
  }

  emitChannelMessage(channelId: string, payload: unknown) {
    this.chatServer?.to(`channel:${channelId}`).emit('message_new', payload);
  }

  emitChannelUpdated(groupId: string, payload: unknown) {
    this.chatServer?.to(`group:${groupId}`).emit('channel_updated', payload);
  }
}