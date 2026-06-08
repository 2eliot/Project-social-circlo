import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as os from 'node:os';
import * as mediasoup from 'mediasoup';
import type { Worker, Router, RtpCodecCapability } from 'mediasoup/node/lib/types';

const MEDIA_CODECS: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 100,
    clockRate: 48000,
    channels: 2,
    parameters: {
      'useinbandfec': 1,       // Forward Error Correction for packet loss resilience
      'usedtx': 1,             // Discontinuous Transmission (silence suppression)
      'stereo': 0,            // Forzar mono — elimina fase cancelada y mejora AEC
      'sprop-stereo': 0,      // Forzar mono en SDP
      'maxaveragebitrate': 24000,  // 24kbps óptimo para voz (homologado con frontend)
      'maxplaybackrate': 16000,    // Limitar ancho de banda a 16kHz (solo frecuencias de voz)
    },
  },
  { kind: 'video', mimeType: 'video/VP8', preferredPayloadType: 110, clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  { kind: 'video', mimeType: 'video/H264', preferredPayloadType: 120, clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    } },
];

/**
 * Manages a worker pool (one per CPU core) and per-channel routers.
 * Each VOICE/VIDEO channel maps 1:1 to a mediasoup Router; transports/producers/
 * consumers are tracked per-user.
 */
@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediasoupService.name);
  private workers: Worker[] = [];
  private workerIdx = 0;
  private routers = new Map<string, Router>(); // channelId → Router

  async onModuleInit() {
    const cores = Math.max(1, os.cpus().length - 1);
    for (let i = 0; i < cores; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: 40000,
        rtcMaxPort: 40099,
      });
      worker.on('died', () => this.logger.error(`Mediasoup worker ${worker.pid} died`));
      this.workers.push(worker);
    }
    this.logger.log(`Mediasoup: ${this.workers.length} worker(s) ready`);
  }

  async onModuleDestroy() {
    for (const w of this.workers) w.close();
  }

  private nextWorker(): Worker {
    const w = this.workers[this.workerIdx % this.workers.length];
    this.workerIdx++;
    return w;
  }

  async getOrCreateRouter(channelId: string): Promise<Router> {
    let r = this.routers.get(channelId);
    if (r) return r;
    r = await this.nextWorker().createRouter({ mediaCodecs: MEDIA_CODECS });
    this.routers.set(channelId, r);
    return r;
  }

  async createWebRtcTransport(channelId: string) {
    const router = await this.getOrCreateRouter(channelId);
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1' }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 2_000_000,
      // DTLS optimizations for faster handshake
      enableSctp: false,
      numSctpStreams: { OS: 0, MIS: 0 },
    });
    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  rtpCapabilities(channelId: string) {
    return this.getOrCreateRouter(channelId).then((r) => r.rtpCapabilities);
  }
}
