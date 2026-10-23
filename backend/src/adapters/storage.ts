import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const TYPES = Object.freeze({
  jpeg: { mime: 'image/jpeg', extension: '.jpg' },
  png: { mime: 'image/png', extension: '.png' },
  gif: { mime: 'image/gif', extension: '.gif' },
} as const);

type ImageType = keyof typeof TYPES;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface SavedImageResult {
  url: string;
  type: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface ReadUploadResult {
  data: Buffer;
  type: string;
  headers: Record<string, string>;
}

export type MediaCategory = 'image' | 'video' | 'document';

export interface SavedMediaResult extends SavedImageResult {
  mediaCategory: MediaCategory;
  filename?: string;
  title?: string;
}

export interface SaveMediaOptions {
  filename?: string;
  mimeType?: string;
  title?: string;
  category?: MediaCategory;
}

export interface StorageAdapter {
  saveImage(input: Buffer | Uint8Array | ArrayBuffer): Promise<SavedImageResult>;
  saveMedia(input: Buffer | Uint8Array | ArrayBuffer, options?: SaveMediaOptions): Promise<SavedMediaResult>;
  validateMediaUrl(value: unknown): boolean;
  readUpload(name: unknown): Promise<ReadUploadResult | null>;
}

export interface CreateStorageAdapterOptions {
  directory?: string;
  baseUrl?: string;
  maxBytes?: number;
}

export const MEDIA_EXTENSIONS = Object.freeze({
  '.jpg': { mime: 'image/jpeg', category: 'image' as MediaCategory },
  '.jpeg': { mime: 'image/jpeg', category: 'image' as MediaCategory },
  '.png': { mime: 'image/png', category: 'image' as MediaCategory },
  '.gif': { mime: 'image/gif', category: 'image' as MediaCategory },
  '.mp4': { mime: 'video/mp4', category: 'video' as MediaCategory },
  '.mov': { mime: 'video/quicktime', category: 'video' as MediaCategory },
  '.webm': { mime: 'video/webm', category: 'video' as MediaCategory },
  '.mkv': { mime: 'video/x-matroska', category: 'video' as MediaCategory },
  '.avi': { mime: 'video/x-msvideo', category: 'video' as MediaCategory },
  '.pdf': { mime: 'application/pdf', category: 'document' as MediaCategory },
  '.doc': { mime: 'application/msword', category: 'document' as MediaCategory },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document' as MediaCategory },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', category: 'document' as MediaCategory },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'document' as MediaCategory },
} as const);

export const MEDIA_NAME_REGEX = /^[0-9a-f-]{36}\.(jpg|jpeg|png|gif|mp4|mov|webm|avi|mkv|pdf|doc|docx|ppt|pptx)$/i;

function detectImage(buffer: Buffer): ImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'gif';
  return null;
}

function detectMedia(buffer: Buffer, filename?: string, mimeType?: string): { category: MediaCategory; mime: string; extension: string } | null {
  const img = detectImage(buffer);
  if (img) return { category: 'image', mime: TYPES[img].mime, extension: TYPES[img].extension };

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { category: 'document', mime: 'application/pdf', extension: '.pdf' };
  }

  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    const ext = filename && path.extname(filename).toLowerCase() === '.mkv' ? '.mkv' : '.webm';
    const mime = ext === '.mkv' ? 'video/x-matroska' : 'video/webm';
    return { category: 'video', mime, extension: ext };
  }

  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') {
    return { category: 'video', mime: 'video/x-msvideo', extension: '.avi' };
  }

  if (buffer.length >= 12 && (buffer.subarray(4, 8).toString('ascii') === 'ftyp' || buffer.subarray(4, 8).toString('ascii') === 'moov')) {
    const ext = filename && path.extname(filename).toLowerCase() === '.mov' ? '.mov' : '.mp4';
    const mime = ext === '.mov' ? 'video/quicktime' : 'video/mp4';
    return { category: 'video', mime, extension: ext };
  }

  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const ext = filename ? path.extname(filename).toLowerCase() : '';
    if (ext === '.pptx') {
      return { category: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx' };
    }
    return { category: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' };
  }

  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    const ext = filename ? path.extname(filename).toLowerCase() : '';
    if (ext === '.ppt') {
      return { category: 'document', mime: 'application/vnd.ms-powerpoint', extension: '.ppt' };
    }
    return { category: 'document', mime: 'application/msword', extension: '.doc' };
  }

  const ext = filename ? path.extname(filename).toLowerCase() : '';
  if (ext && ext in MEDIA_EXTENSIONS) {
    const info = (MEDIA_EXTENSIONS as any)[ext];
    return { category: info.category, mime: info.mime, extension: ext };
  }
  if (mimeType) {
    for (const [keyExt, val] of Object.entries(MEDIA_EXTENSIONS)) {
      if (val.mime.toLowerCase() === mimeType.toLowerCase()) {
        return { category: val.category, mime: val.mime, extension: keyExt };
      }
    }
  }

  return null;
}

function imageDimensions(buffer: Buffer, type: ImageType): ImageDimensions | null {
  if (type === 'png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (type === 'gif' && buffer.length >= 10) return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (type !== 'jpeg') return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7 || offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += length + 2;
  }
  return null;
}

/** OpenVio replaces local disk storage and this download handler with its object-storage adapter. */
export function createStorageAdapter({
  directory = env.uploadDir,
  baseUrl = env.publicApiBaseUrl,
  maxBytes = env.mediaMaxBytes,
}: CreateStorageAdapterOptions = {}): StorageAdapter {
  const root = path.resolve(directory);
  return Object.freeze({
    async saveImage(input: Buffer | Uint8Array | ArrayBuffer): Promise<SavedImageResult> {
      const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input as any);
      if (buffer.length === 0) throw Object.assign(new Error('Image is empty'), { code: 'VALIDATION_ERROR' });
      if (buffer.length > maxBytes) throw Object.assign(new Error('Image exceeds the upload size limit'), { code: 'PAYLOAD_TOO_LARGE' });
      const type = detectImage(buffer);
      if (!type) throw Object.assign(new Error('Only JPEG, PNG, and GIF images are supported'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
      const dimensions = imageDimensions(buffer, type);
      if (dimensions && (dimensions.width > 8000 || dimensions.height > 8000)) {
        throw Object.assign(new Error('Image dimensions must not exceed 8000 pixels per side'), { code: 'VALIDATION_ERROR' });
      }
      const name = `${randomUUID()}${TYPES[type].extension}`;
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, name), buffer, { flag: 'wx', mode: 0o600 });
      return { url: `${baseUrl.replace(/\/$/, '')}/uploads/${name}`, type: TYPES[type].mime, sizeBytes: buffer.length, ...(dimensions ?? {}) };
    },
    async saveMedia(input: Buffer | Uint8Array | ArrayBuffer, options: SaveMediaOptions = {}): Promise<SavedMediaResult> {
      const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input as any);
      if (buffer.length === 0) throw Object.assign(new Error('File is empty'), { code: 'VALIDATION_ERROR' });

      const detected = detectMedia(buffer, options.filename, options.mimeType);
      if (!detected) {
        throw Object.assign(new Error('Only supported image, video, and document formats are allowed'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
      }

      // Check size restrictions per media category
      if (detected.category === 'image') {
        if (buffer.length > maxBytes) throw Object.assign(new Error('Image exceeds the upload size limit'), { code: 'PAYLOAD_TOO_LARGE' });
        const imgType = detectImage(buffer);
        if (imgType) {
          const dimensions = imageDimensions(buffer, imgType);
          if (dimensions && (dimensions.width > 8000 || dimensions.height > 8000)) {
            throw Object.assign(new Error('Image dimensions must not exceed 8000 pixels per side'), { code: 'VALIDATION_ERROR' });
          }
        }
      } else if (detected.category === 'video') {
        const videoLimit = 100 * 1024 * 1024; // 100MB
        if (buffer.length > videoLimit) throw Object.assign(new Error('Video exceeds the 100MB limit'), { code: 'PAYLOAD_TOO_LARGE' });
      } else if (detected.category === 'document') {
        const documentLimit = 100 * 1024 * 1024; // 100MB
        if (buffer.length > documentLimit) throw Object.assign(new Error('Document exceeds the 100MB limit'), { code: 'PAYLOAD_TOO_LARGE' });
      }

      const name = `${randomUUID()}${detected.extension}`;
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, name), buffer, { flag: 'wx', mode: 0o600 });

      let dimensions: ImageDimensions | null = null;
      if (detected.category === 'image') {
        const imgType = detectImage(buffer);
        if (imgType) dimensions = imageDimensions(buffer, imgType);
      }

      return {
        url: `${baseUrl.replace(/\/$/, '')}/uploads/${name}`,
        type: detected.mime,
        sizeBytes: buffer.length,
        mediaCategory: detected.category,
        filename: options.filename,
        title: options.title,
        ...(dimensions ?? {}),
      };
    },
    validateMediaUrl(value: unknown): boolean {
      if (typeof value !== 'string') return false;
      const prefix = `${baseUrl.replace(/\/$/, '')}/uploads/`;
      if (value.startsWith(prefix) && MEDIA_NAME_REGEX.test(value.slice(prefix.length))) return true;
      const match = /(?:^|\/uploads\/)([0-9a-f-]{36}\.(?:jpg|jpeg|png|gif|mp4|mov|webm|avi|mkv|pdf|doc|docx|ppt|pptx))$/i.exec(value);
      if (match && MEDIA_NAME_REGEX.test(match[1])) return true;
      return false;
    },
    async readUpload(name: unknown): Promise<ReadUploadResult | null> {
      if (typeof name !== 'string') return null;
      const cleanName = name.includes('/') ? name.split('/').at(-1)! : name;
      if (!MEDIA_NAME_REGEX.test(cleanName)) return null;
      const target = path.resolve(root, cleanName);
      if (path.dirname(target) !== root) return null;
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        const data = await fs.readFile(target);
        const ext = path.extname(name).toLowerCase();
        const mediaInfo = (MEDIA_EXTENSIONS as any)[ext];
        const mime = mediaInfo?.mime ?? 'application/octet-stream';
        return { data, type: mime, headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' } };
      } catch (error: any) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  });
}

export const storageAdapter = createStorageAdapter();
