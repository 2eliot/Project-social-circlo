import { PipeTransform, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export interface ImageTransformOptions {
  /** Maximum width in pixels (default: 1920) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 1080) */
  maxHeight?: number;
  /** JPEG/WebP quality (1-100, default: 80) */
  quality?: number;
  /** Output format: 'jpeg' | 'webp' | 'avif' | undefined (keeps original) */
  format?: 'jpeg' | 'webp' | 'avif';
}

/**
 * Pipe que redimensiona imágenes usando sharp.
 * Mantiene la proporción original (sin recortar) y reduce el tamaño del archivo.
 * Solo procesa imágenes, otros tipos de archivo pasan sin cambios.
 */
@Injectable()
export class ImageTransformPipe implements PipeTransform {
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly quality: number;
  private readonly format?: 'jpeg' | 'webp' | 'avif';

  constructor(options?: ImageTransformOptions) {
    this.maxWidth = options?.maxWidth ?? 1920;
    this.maxHeight = options?.maxHeight ?? 1080;
    this.quality = options?.quality ?? 80;
    this.format = options?.format;
  }

  async transform(value: Express.Multer.File | undefined): Promise<Express.Multer.File | undefined> {
    if (!value) return value;

    // Solo procesar imágenes
    if (!value.mimetype.startsWith('image/')) return value;

    // No procesar GIFs animados (se perdería la animación)
    if (value.mimetype === 'image/gif') return value;

    // No procesar SVG
    if (value.mimetype === 'image/svg+xml') return value;

    try {
      const image = sharp(value.buffer || value.path);

      const metadata = await image.metadata();

      // Si la imagen ya es más pequeña que los límites, solo optimizar
      const needsResize =
        (metadata.width && metadata.width > this.maxWidth) ||
        (metadata.height && metadata.height > this.maxHeight);

      let pipeline = image;

      if (needsResize) {
        pipeline = pipeline.resize({
          width: this.maxWidth,
          height: this.maxHeight,
          fit: 'inside', // <-- Esto es clave: mantiene proporción, NO recorta
          withoutEnlargement: true,
        });
      }

      // Convertir formato si se especificó
      if (this.format) {
        switch (this.format) {
          case 'jpeg':
            pipeline = pipeline.jpeg({ quality: this.quality });
            break;
          case 'webp':
            pipeline = pipeline.webp({ quality: this.quality });
            break;
          case 'avif':
            pipeline = pipeline.avif({ quality: this.quality });
            break;
        }
      } else {
        // Optimizar según el formato original
        switch (metadata.format) {
          case 'jpeg':
          case 'jpg':
            pipeline = pipeline.jpeg({ quality: this.quality });
            break;
          case 'png':
            pipeline = pipeline.png({ quality: this.quality });
            break;
          case 'webp':
            pipeline = pipeline.webp({ quality: this.quality });
            break;
          // Otros formatos (gif, svg, tiff, etc.) se dejan intactos
        }
      }

      const processed = await pipeline.toBuffer();
      const newMetadata = await sharp(processed).metadata();

      // Actualizar el buffer y tamaño del archivo
      value.buffer = processed;
      value.size = processed.length;

      // Actualizar el mimetype si cambió el formato
      if (this.format) {
        const mimeMap: Record<string, string> = {
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          avif: 'image/avif',
        };
        value.mimetype = mimeMap[this.format] || value.mimetype;

        // Actualizar extensión si el buffer tiene path (multer diskStorage)
        if ((value as any).path && newMetadata.format) {
          const oldPath = (value as any).path as string;
          const newExt = newMetadata.format;
          (value as any).path = oldPath.replace(/\.[^.]+$/, `.${newExt}`);
          value.filename = value.filename.replace(/\.[^.]+$/, `.${newExt}`);
        }
      }

      return value;
    } catch (error) {
      // Si falla el procesamiento, devolver el archivo original
      console.error('ImageTransformPipe error:', error);
      return value;
    }
  }
}
