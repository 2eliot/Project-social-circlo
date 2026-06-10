'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { api } from './api-client';
import { normalizeMediaUrl } from './media-url';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DMAttachment = {
  kind: 'image' | 'voice';
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
};

type UploadEndpoint = '/dm/upload' | '/posts/upload';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSupportedVoiceMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

function getVoiceFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function getVoiceRecordingErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      return 'Permiso de micrófono denegado. Ve a Ajustes > Apps > Social Circle > Permisos y activa el micrófono.';
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') return 'No se encontró ningún micrófono disponible.';
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError')
      return 'El micrófono está siendo usado por otra app. Ciérrala e intenta de nuevo.';
    if (err.name === 'NotSupportedError') return 'Tu navegador no pudo iniciar la grabación con un formato compatible.';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo iniciar la grabación.';
}

/* ------------------------------------------------------------------ */
/*  Upload helper                                                      */
/* ------------------------------------------------------------------ */

async function uploadAudioFile(file: File, endpoint: UploadEndpoint): Promise<DMAttachment | null> {
  const formData = new FormData();
  formData.append('file', file);
  const result = await api<{ attachment: DMAttachment | null }>(endpoint, {
    method: 'POST',
    body: formData,
  });
  if (!result.attachment) return null;
  return {
    ...result.attachment,
    url: normalizeMediaUrl(result.attachment.url) ?? result.attachment.url,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseVoiceRecorderOptions {
  /** Endpoint de subida: '/dm/upload' o '/posts/upload' */
  endpoint: UploadEndpoint;
  /** Callback cuando se sube exitosamente un audio */
  onAttached?: (attachment: DMAttachment) => void;
  /** Callback cuando hay un error */
  onError?: (message: string) => void;
}

export interface UseVoiceRecorderReturn {
  /** true mientras se está grabando */
  isRecording: boolean;
  /** segundos transcurridos de la grabación actual */
  elapsed: number;
  /** true mientras se está subiendo el archivo al servidor */
  uploading: boolean;
  /** Iniciar/detener grabación */
  toggle: () => void;
  /** Forzar detención (llamar si el componente se desmonta) */
  stop: () => void;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const { endpoint, onAttached, onError } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Limpiar timer
  useEffect(() => {
    if (!isRecording) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecording() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
  }

  const toggle = useCallback(async () => {
    // Si está grabando, detener
    if (isRecording) {
      setIsRecording(false);
      stopRecording();
      return;
    }

    // Verificar soporte
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError?.('Tu navegador no soporta grabar notas de voz.');
      return;
    }

    if (!window.isSecureContext) {
      onError?.('La grabación de voz necesita HTTPS.');
      return;
    }

    try {
      // Obtener stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Aplicar constraints de audio
      const [track] = stream.getAudioTracks();
      if (track) {
        await track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }).catch(() => {});
      }

      // Crear recorder
      const mimeType = getSupportedVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks: Blob[] = [];
      chunksRef.current = chunks;
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;

        const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: recordedMime });

        if (blob.size === 0) {
          onError?.('La grabación no capturó audio.');
          return;
        }

        const ext = getVoiceFileExtension(recordedMime);
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: recordedMime });

        // Subir
        setUploading(true);
        try {
          const attachment = await uploadAudioFile(file, endpoint);
          if (attachment) {
            onAttached?.(attachment);
          }
        } catch {
          onError?.('No se pudo subir la nota de voz.');
        } finally {
          setUploading(false);
        }
      };

      recorder.onerror = () => {
        onError?.('Error durante la grabación.');
        stopRecording();
      };

      // Iniciar con timeslice para asegurar dataavailable en todos los browsers
      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setIsRecording(true);
    } catch (err) {
      onError?.(getVoiceRecordingErrorMessage(err));
    }
  }, [isRecording, endpoint, onAttached, onError]);

  return {
    isRecording,
    elapsed,
    uploading,
    toggle,
    stop: stopRecording,
  };
}
