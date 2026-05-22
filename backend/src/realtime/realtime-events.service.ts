import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeEventsService {
  private socialServer?: Server;

  registerSocialServer(server: Server) {
    this.socialServer = server;
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
}