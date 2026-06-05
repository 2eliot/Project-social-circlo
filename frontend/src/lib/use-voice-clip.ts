'use client';

import { useEffect, useState } from 'react';

interface VoiceClip {
  /** URL lista para reproducir (blob local cuando se descarga, si no la original). */
  src: string;
  /** Duración real en segundos (0 hasta que se resuelve). */
  duration: number;
  /** true cuando el clip ya se descargó y decodificó. */
  ready: boolean;
}

/**
 * Descarga una nota de voz como blob y calcula su duración real.
 *
 * Los archivos de MediaRecorder (WebM/Opus) no traen la duración en su cabecera,
 * así que `audio.duration` devuelve `Infinity`. Además, al servirse mediante el
 * proxy de Next.js las peticiones Range fallan, lo que impide el "seek trick" y
 * la reproducción fiable. Descargando el archivo completo una sola vez:
 *   1. Reproducimos desde un blob URL (totalmente buffered y seekable → suena bien).
 *   2. Obtenemos la duración exacta con Web Audio `decodeAudioData`.
 */
export function useVoiceClip(networkSrc: string): VoiceClip {
  const [src, setSrc] = useState(networkSrc);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setSrc(networkSrc);
    setDuration(0);
    setReady(false);

    async function load() {
      try {
        const res = await fetch(networkSrc);
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        const type = res.headers.get('Content-Type') || 'audio/webm';
        const blob = new Blob([buffer], { type });
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setReady(true);

        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            // decodeAudioData puede "detachear" el buffer: pasamos una copia.
            const decoded = await ctx.decodeAudioData(buffer.slice(0));
            if (!cancelled && decoded.duration && Number.isFinite(decoded.duration)) {
              setDuration(decoded.duration);
            }
            await ctx.close();
          }
        } catch {
          /* el codec puede no ser decodificable; la reproducción sigue funcionando */
        }
      } catch {
        /* mantenemos la URL original como fallback */
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [networkSrc]);

  return { src, duration, ready };
}
