import { execFile } from 'child_process';
import { unlink, rename } from 'fs/promises';
import { join, extname } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Convierte archivos de audio fragmentados (fMP4, .m4a) a WebM/Opus
 * para compatibilidad universal en navegadores.
 * Los formatos ya compatibles (.webm) se dejan intactos.
 */
export async function convertAudioForPlayback(filePath: string): Promise<void> {
  const ext = extname(filePath).toLowerCase();

  // Solo convertir formatos problemáticos (fragmented MP4)
  if (ext !== '.m4a' && ext !== '.mp4') {
    return; // ya es compatible
  }

  const webmPath = filePath.replace(/\.(m4a|mp4)$/i, '.webm');

  try {
    await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-c:a', 'libopus',
      '-b:a', '24k',
      '-y', // sobrescribir si existe
      webmPath,
    ], { timeout: 15000 });

    // Eliminar el original .m4a
    await unlink(filePath);
  } catch (err) {
    // Si falló la conversión, dejar el original
    console.error(`[AudioConverter] Error converting ${filePath}:`, err);
  }
}
