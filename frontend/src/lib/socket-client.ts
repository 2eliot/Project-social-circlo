import { io, Socket } from 'socket.io-client';
import { getAccessToken, onAccessTokenChange } from './api-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

const sockets = new Map<string, Socket>();

export function getSocket(namespace: '/chat' | '/presence' | '/sfu' | '/social'): Socket {
  const key = namespace;
  let s = sockets.get(key);
  if (s) return s;
  s = io(`${WS_URL}${namespace}`, {
    transports: ['websocket'],
    auth: { token: getAccessToken() },
    autoConnect: true,
  });
  // Refresh auth on token rotation.
  onAccessTokenChange((t) => {
    if (!s) return;
    s.auth = { token: t };
    if (s.connected) s.disconnect().connect();
  });
  sockets.set(key, s);
  return s;
}

export function disconnectAllSockets() {
  for (const s of sockets.values()) s.disconnect();
  sockets.clear();
}
