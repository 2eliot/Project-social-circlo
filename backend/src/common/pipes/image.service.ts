import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';

export interface ProcessedImage {
  filename: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface ImageProcessOptions {
  /** Subdirectory inside uploads/ (e.g. 'avatars', 'posts', 'channels', 'dm', 'groups') */
  subDir: string;
  /** Maximum width (default: 1920) */
  maxWidth?: number;
  /** Maximum height (default: 1080) */
  maxHeight?: number;
  /** Quality 1-100 (default: 85) */
  quality?: number;
  /** Output format (default: 'webp' for best quality/size) */
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
}

@Injectable()
export class ImageService {
  /**
   * Procesa una imagen subida: la redimensiona manteniendo proporción (sin recortar),
   * la optimiza y la guarda en uploads/{subDir}/.
   * @returns Información del archivo procesado o null si no es una imagen válida.
   */
  async processAndSave(
    file: Express.Multer.File,
    options: ImageProcessOptions,
  ): Promise<ProcessedImage | null> {
    if (!file || !file.buffer) return null;
    if (!file.mimetype.startsWith('image/')) return null;
    if (file.mimetype === 'image/gif' || file.mimetype === 'image/svg+xml') {
      // Guardar GIFs y SVGs sin procesar
      return this.saveRaw(file, options.subDir);
    }

    const maxWidth = options.maxWidth ?? 1920;
    const maxHeight = options.maxHeight ?? 1080;
    const quality = options.quality ?? 85;

    try {
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      const needsResize =
        (metadata.width && metadata.width > maxWidth) ||
        (metadata.height && metadata.height > maxHeight);

      let pipeline = image;

      if (needsResize) {
        pipeline = pipeline.resize({
          width: maxWidth,
          height: maxHeight,
          fit: 'inside', // Mantiene proporción, NO recorta
          withoutEnlargement: true,
        });
      }

      // Determinar formato de salida
      const outputFormat = options.format || 'webp';
      const ext = outputFormat === 'jpeg' ? '.jpg' : `.${outputFormat}`;
      const filename = `${randomUUID()}${ext}`;
      const mimeMap: Record<string, string> = {
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
      };

      // Aplicar optimización según formato
      switch (outputFormat) {
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          break;
        case 'png':
          pipeline = pipeline.png({ quality, palette: true });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality });
          break;
        case 'avif':
          pipeline = pipeline.avif({ quality });
          break;
      }

      const processedBuffer = await pipeline.toBuffer();

      // Guardar archivo
      const uploadsDir = join(process.cwd(), 'uploads', options.subDir);
      await mkdir(uploadsDir, { recursive: true });
      const filePath = join(uploadsDir, filename);
      await writeFile(filePath, processedBuffer);

      return {
        filename,
        url: `/uploads/${options.subDir}/${filename}`,
        mimeType: mimeMap[outputFormat] || `image/${outputFormat}`,
        size: processedBuffer.length,
      };
    } catch (error) {
      console.error(`ImageService error processing ${file.originalname}:`, error);
      // Fallback: guardar raw
      return this.saveRaw(file, options.subDir);
    }
  }

  /**
   * Guarda el archivo original sin procesar (fallback para no-imágenes o errores).
   */
  private async saveRaw(
    file: Express.Multer.File,
    subDir: string,
  ): Promise<ProcessedImage> {
    const ext = extname(file.originalname) || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const uploadsDir = join(process.cwd(), 'uploads', subDir);
    await mkdir(uploadsDir, { recursive: true });
    const filePath = join(uploadsDir, filename);
    await writeFile(filePath, file.buffer);

    return {
      filename,
      url: `/uploads/${subDir}/${filename}`,
      mimeType: file.mimetype,
      size: file.buffer.length,
    };
  }
}
