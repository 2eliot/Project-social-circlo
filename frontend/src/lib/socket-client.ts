import { io, Socket } from 'socket.io-client';
import { getAccessToken, onAccessTokenChange } from './api-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? '';

const sockets = new Map<string, Socket>();

export function getSocket(namespace: '/chat' | '/presence' | '/sfu' | '/social'): Socket {
  const key = namespace;
  let s = sockets.get(key);
  if (s) return s;
  s = io(`${WS_URL}${namespace}`, {
    path: '/socket.io',
    auth: { token: getAccessToken() },
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
    timeout: 12000,
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
