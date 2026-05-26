import { Device } from 'mediasoup-client';
import type { Transport, Consumer, Producer } from 'mediasoup-client/types';
import { getSocket } from './socket-client';

interface ProducerInfo {
  producerId: string;
  userId: string;
  kind: string;
}

export class SfuClient {
  private device = new Device();
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private audioProducer?: Producer;
  private consumers = new Map<string, Consumer>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private onNewProducerHandler?: (info: ProducerInfo) => void;
  private onProducerClosedHandler?: (payload: { producerId: string }) => void;

  constructor(public readonly channelId: string) {}

  /** Join the voice channel, negotiate transports, and consume existing producers. */
  async connect() {
    const socket = getSocket('/sfu');

    // Join the channel — server returns RTP capabilities for this router
    const { rtpCapabilities } = await sfuEmit<{ ok: boolean; rtpCapabilities: any }>(
      socket,
      'join_voice',
      { channelId: this.channelId },
    );
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    // Create bidirectional transports
    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');

    // Listen for new producers from other peers
    this.onNewProducerHandler = ({ producerId, userId, kind }: ProducerInfo) => {
      if (kind === 'audio') void this.consumeAudio(producerId, userId);
    };
    socket.on('new_producer', this.onNewProducerHandler);

    // Listen for producers being closed remotely
    this.onProducerClosedHandler = ({ producerId }: { producerId: string }) => {
      this.cleanupConsumer(producerId);
    };
    socket.on('producer_closed', this.onProducerClosedHandler);

    // Consume all producers already in the channel
    const existing = await sfuEmit<ProducerInfo[]>(socket, 'get_producers', {});
    for (const { producerId, userId, kind } of existing) {
      if (kind === 'audio') void this.consumeAudio(producerId, userId);
    }
  }

  /** Start publishing mic audio. Safe to call multiple times (no-op if already publishing). */
  async publishMic() {
    if (!this.sendTransport) throw new Error('SfuClient not connected');
    if (this.audioProducer && !this.audioProducer.closed) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = stream.getAudioTracks()[0];
    this.audioProducer = await this.sendTransport.produce({
      track,
      codecOptions: { opusStereo: false, opusDtx: true },
    });
    this.audioProducer.on('transportclose', () => { this.audioProducer = undefined; });
  }

  /** Stop publishing mic audio. */
  async stopMic() {
    if (!this.audioProducer || this.audioProducer.closed) return;
    this.audioProducer.close();
    this.audioProducer = undefined;
  }

  /** Leave the voice channel and clean up all resources. */
  async disconnect() {
    const socket = getSocket('/sfu');
    if (this.onNewProducerHandler) socket.off('new_producer', this.onNewProducerHandler);
    if (this.onProducerClosedHandler) socket.off('producer_closed', this.onProducerClosedHandler);

    await this.stopMic();
    for (const producerId of Array.from(this.consumers.keys())) {
      this.cleanupConsumer(producerId);
    }
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = undefined;
    this.recvTransport = undefined;

    try {
      await sfuEmit(socket, 'leave_voice', { channelId: this.channelId });
    } catch {
      // best-effort
    }
  }

  // ─── private helpers ─────────────────────────────────────────────────────────

  private async consumeAudio(producerId: string, userId: string) {
    if (!this.recvTransport || !this.device.loaded) return;
    if (this.consumers.has(producerId)) return; // already consuming

    const socket = getSocket('/sfu');
    try {
      const { id, rtpParameters } = await sfuEmit<{
        id: string;
        producerId: string;
        kind: string;
        rtpParameters: any;
      }>(socket, 'consume', {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });

      const consumer = await this.recvTransport.consume({
        id,
        producerId,
        kind: 'audio',
        rtpParameters,
      });
      this.consumers.set(producerId, consumer);

      await sfuEmit(socket, 'resume_consumer', { consumerId: consumer.id });

      // Play the remote audio
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.autoplay = true;
      audio.play().catch(() => undefined);
      this.audioElements.set(producerId, audio);

      consumer.on('transportclose', () => this.cleanupConsumer(producerId));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (consumer as any).on('producerclose', () => this.cleanupConsumer(producerId));
    } catch (err) {
      console.error('[SfuClient] consume error for', producerId, err);
    }
  }

  private cleanupConsumer(producerId: string) {
    const consumer = this.consumers.get(producerId);
    if (consumer && !consumer.closed) consumer.close();
    this.consumers.delete(producerId);

    const audio = this.audioElements.get(producerId);
    if (audio) {
      audio.srcObject = null;
      this.audioElements.delete(producerId);
    }
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    const socket = getSocket('/sfu');
    const { params } = await sfuEmit<{ direction: string; params: any }>(socket, 'create_transport', { direction });

    const transport =
      direction === 'send'
        ? this.device.createSendTransport(params)
        : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, ok, fail) => {
      sfuEmit(socket, 'connect_transport', { transportId: transport.id, dtlsParameters })
        .then(() => ok())
        .catch(fail);
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, ok, fail) => {
        sfuEmit(socket, 'produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then((r: any) => ok({ id: r.id }))
          .catch(fail);
      });
    }

    return transport;
  }
}

function sfuEmit<T = any>(socket: any, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res: any) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}
