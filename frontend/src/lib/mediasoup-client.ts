/**
 * Mediasoup-client wrapper. Skeleton: connect to /sfu, fetch caps, create
 * send/recv transports, produce/consume.
 *
 * Usage (rough):
 *   const sfu = new SfuClient(channelId);
 *   await sfu.connect();
 *   await sfu.publishMic();
 *
 * For brevity, only the public API is sketched here. Fill in the bodies when
 * you wire up the UI for VOICE/VIDEO channels.
 */

import { Device } from 'mediasoup-client';
import type { Transport } from 'mediasoup-client/types';
import { getSocket } from './socket-client';

export class SfuClient {
  private device = new Device();
  private send?: Transport;
  private recv?: Transport;

  constructor(public readonly channelId: string) {}

  async connect() {
    const socket = getSocket('/sfu');
    const { rtpCapabilities } = await emit(socket, 'join_voice', { channelId: this.channelId });
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    this.send = await this.createTransport('send');
    this.recv = await this.createTransport('recv');
  }

  async publishMic() {
    if (!this.send) throw new Error('not connected');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    await this.send.produce({ track });
  }

  async publishScreen() {
    if (!this.send) throw new Error('not connected');
    const stream = (await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })) as MediaStream;
    for (const track of stream.getTracks()) await this.send.produce({ track });
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    const socket = getSocket('/sfu');
    const { params } = await emit(socket, 'create_transport', { direction });
    const transport =
      direction === 'send' ? this.device.createSendTransport(params) : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, ok, fail) => {
      emit(socket, 'connect_transport', { transportId: transport.id, dtlsParameters }).then(() => ok()).catch(fail);
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, ok, fail) => {
        emit(socket, 'produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then((r: any) => ok({ id: r.id }))
          .catch(fail);
      });
    }
    return transport;
  }
}

function emit<T = any>(socket: any, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res: any) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}
