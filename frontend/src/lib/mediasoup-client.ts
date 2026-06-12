import { Device } from 'mediasoup-client';
import type { Transport, Consumer, Producer } from 'mediasoup-client/types';
import { getSocket } from './socket-client';

let globalSfuClient: SfuClient | null = null;
export function getActiveSfuClient() { return globalSfuClient; }
export function setActiveSfuClient(client: SfuClient | null) { globalSfuClient = client; }

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
  private listenOnly = false;
  private _speakingDetectionStarted = false;
  /** Cached microphone stream — kept alive for the entire voice session.
   *  On Capacitor (Android WebView), releasing and re-acquiring getUserMedia
   *  after track.stop() silently fails. We keep the stream alive and toggle
   *  track.enabled instead. */
  private micStream?: MediaStream;

  // ── Voice activity detection ──
  private audioContext?: AudioContext;
  private analyserNode?: AnalyserNode;
  private speechCheckInterval?: ReturnType<typeof setInterval>;
  private _isCurrentlySpeaking = false;
  /** Callback: fires when local mic speech activity changes */
  public onSpeakingChange?: (isSpeaking: boolean) => void;

  constructor(
    public readonly channelId: string,
    private readonly userId?: string,
  ) {}

  /** Join the voice channel as a speaker (can publish + consume). */
  async connect() {
    return this.bootstrap('join_voice', false);
  }

  /** Subscribe to the voice channel in listen-only mode (consumes, cannot publish). */
  async connectListenOnly() {
    return this.bootstrap('listen_voice', true);
  }

  private async bootstrap(joinEvent: 'join_voice' | 'listen_voice', listenOnly: boolean) {
    const socket = getSocket('/sfu');
    this.listenOnly = listenOnly;
    console.log('[SfuClient]', joinEvent, 'channel=', this.channelId);

    // Join the channel — server returns RTP capabilities for this router
    const { rtpCapabilities } = await sfuEmit<{ ok: boolean; rtpCapabilities: any }>(
      socket,
      joinEvent,
      { channelId: this.channelId },
    );
    console.log('[SfuClient] device load');
    if (!this.device.loaded) await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    // Recv transport is always needed; send transport only for speakers.
    this.recvTransport = await this.createTransport('recv');
    if (!listenOnly) {
      this.sendTransport = await this.createTransport('send');
    }

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
    console.log('[SfuClient] existing producers:', existing.length, existing);
    for (const { producerId, userId, kind } of existing) {
      if (kind === 'audio') void this.consumeAudio(producerId, userId);
    }
  }

  /** Start publishing mic audio. Safe to call multiple times (no-op if already publishing). */
  async publishMic() {
    if (this.listenOnly || !this.sendTransport) throw new Error('SfuClient is listen-only');

    // Already have a live producer — just unmute the track
    if (this.audioProducer && !this.audioProducer.closed) {
      const track = this.audioProducer.track;
      if (track) {
        track.enabled = true;
        console.log('[SfuClient] publishMic() unmuted existing track');
      }
      return;
    }

    // First time or after producer was closed — get mic and create producer
    if (!this.micStream) {
      console.log('[SfuClient] publishMic() requesting getUserMedia (first time)');
      // echoCancellation evita que el micrófono capte el audio de los altavoces,
      // previniendo eco. noiseSuppression y autoGainControl mejoran calidad de voz.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { exact: true },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
          // @ts-expect-error — latency existe en Chromium pero no en el tipo de TS
          latency: { ideal: 0.005, max: 0.02 },
        },
        video: false,
      });
    }

    const track = this.micStream.getAudioTracks()[0];
    track.enabled = true;
    console.log('[SfuClient] got mic track:', track.label, 'enabled=', track.enabled);

    this.audioProducer = await this.sendTransport.produce({
      track,
      codecOptions: {
        opusStereo: false,
        opusDtx: true,
        opusFec: true,
        opusMaxAverageBitrate: 32000,
        opusPtime: 20,
      },
    });
    console.log('[SfuClient] producer created id=', this.audioProducer.id);
    this.audioProducer.on('transportclose', () => { this.audioProducer = undefined; });

    // Start voice activity detection (only when we first acquire the mic)
    if (!this._speakingDetectionStarted) {
      this._speakingDetectionStarted = true;
      this.startSpeakingDetection(this.micStream);
    }
  }

  /** Stop publishing mic audio. Keeps the producer and mic stream alive —
   *  only disables the audio track so no audio is sent.
   *  On Capacitor (Android WebView), calling track.stop() + getUserMedia()
   *  again silently fails, so we never release the mic — we just mute it. */
  async stopMic() {
    if (!this.audioProducer || this.audioProducer.closed) return;

    const track = this.audioProducer.track;
    if (track) {
      track.enabled = false;
      console.log('[SfuClient] stopMic() disabled track');
    }
    // Do NOT stop the track, close producer, or stop speaking detection.
    // The mic stays captured but sends silence.
  }

  /** Leave the voice channel and clean up all resources. */
  async disconnect() {
    const socket = getSocket('/sfu');
    if (this.onNewProducerHandler) socket.off('new_producer', this.onNewProducerHandler);
    if (this.onProducerClosedHandler) socket.off('producer_closed', this.onProducerClosedHandler);

    // Fully stop mic and release hardware
    if (this.audioProducer && !this.audioProducer.closed) {
      const track = this.audioProducer.track;
      if (track) track.stop();
      this.audioProducer.close();
      this.audioProducer = undefined;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = undefined;
    }
    this._speakingDetectionStarted = false;
    this.stopSpeakingDetection();
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
    console.log('[SfuClient] consumeAudio producerId=', producerId, 'userId=', userId);
    if (!this.recvTransport || !this.device.loaded) { console.warn('[SfuClient] recvTransport or device not ready'); return; }
    if (this.consumers.has(producerId)) return; // already consuming
    // No consumir el propio audio del usuario — evitaría eco/doble voz
    if (this.userId && userId === this.userId) {
      console.log('[SfuClient] skipping own producer', producerId);
      return;
    }

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
      console.log('[SfuClient] consumer resumed id=', consumer.id, 'track=', consumer.track.label, 'readyState=', consumer.track.readyState);

      // Play the remote audio — must be in the DOM for autoplay to work in all browsers
      const audio = document.createElement('audio');
      audio.srcObject = new MediaStream([consumer.track]);
      audio.autoplay = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      audio.play().then(() => console.log('[SfuClient] audio playing for', producerId)).catch((err) => console.warn('[SfuClient] autoplay blocked for producer', producerId, err));
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
      audio.pause();
      audio.srcObject = null;
      audio.remove();
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

  // ── Voice activity detection ──

  /** Start detecting speech activity from the local mic track.
   *  Enfocado en frecuencias de voz (300Hz-4kHz) con hold time para
   *  evitar falsos positivos por ruido ambiental. */
  private startSpeakingDetection(stream: MediaStream) {
    this.stopSpeakingDetection(); // cleanup any existing

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8; // más suavizado = menos fluctuación
      source.connect(this.analyserNode);
      // Don't connect to destination — we don't want feedback

      const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      // Rango de voz: 300Hz-4kHz → bins ~2-21 (fftSize=256, cada bin = 187.5Hz a 48kHz)
      const VOICE_START_BIN = 2;
      const VOICE_END_BIN = 22;
      let holdFrames = 0;
      const HOLD_FRAMES = 3; // 3 checks × 150ms = 450ms de hold antes de "no speaking"

      this.speechCheckInterval = setInterval(() => {
        if (!this.analyserNode) return;
        this.analyserNode.getByteFrequencyData(dataArray);
        // Energía solo en frecuencias de voz (ignorar graves y agudos)
        let sum = 0;
        for (let i = VOICE_START_BIN; i < VOICE_END_BIN; i++) {
          sum += dataArray[i];
        }
        const avg = sum / (VOICE_END_BIN - VOICE_START_BIN);
        const isSpeaking = avg > 28; // threshold más alto = menos falsos positivos

        // Hold time: mantener "speaking" al menos 450ms para evitar parpadeo
        if (isSpeaking) {
          holdFrames = HOLD_FRAMES;
        } else if (holdFrames > 0) {
          holdFrames--;
        }
        const speakingWithHold = holdFrames > 0;

        if (speakingWithHold !== this._isCurrentlySpeaking) {
          this._isCurrentlySpeaking = speakingWithHold;
          this.onSpeakingChange?.(speakingWithHold);
        }
      }, 150); // 150ms entre chequeos
    } catch (err) {
      console.warn('[SfuClient] Failed to start speaking detection:', err);
    }
  }

  private stopSpeakingDetection() {
    if (this.speechCheckInterval) {
      clearInterval(this.speechCheckInterval);
      this.speechCheckInterval = undefined;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = undefined;
    this.analyserNode = undefined;
    this._isCurrentlySpeaking = false;
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
