/**
 * Resuelve la duración real de un elemento <audio>.
 *
 * Los archivos grabados con MediaRecorder (WebM/Opus) no incluyen la duración
 * en su cabecera, por lo que `audio.duration` devuelve `Infinity` hasta que el
 * navegador recorre todo el stream. El truco consiste en hacer un "seek" a un
 * tiempo muy grande para forzar al navegador a calcular la duración real y
 * luego volver al inicio.
 *
 * @returns una función de limpieza para remover los listeners pendientes.
 */
export function resolveAudioDuration(
  audio: HTMLAudioElement,
  onResolved: (duration: number) => void,
): () => void {
  const current = audio.duration;
  if (current && Number.isFinite(current)) {
    onResolved(current);
    return () => {};
  }

  const handleDurationChange = () => {
    const next = audio.duration;
    if (next && Number.isFinite(next)) {
      audio.removeEventListener('durationchange', handleDurationChange);
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
      onResolved(next);
    }
  };

  audio.addEventListener('durationchange', handleDurationChange);

  try {
    // Tiempo deliberadamente enorme: el navegador lo limita a la duración real
    // y dispara `durationchange` con el valor correcto.
    audio.currentTime = 1e101;
  } catch {
    /* ignore */
  }

  return () => audio.removeEventListener('durationchange', handleDurationChange);
}
