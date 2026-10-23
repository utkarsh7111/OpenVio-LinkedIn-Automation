import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';

function indexOf(buffer: Buffer, target: Buffer, from = 0): number {
  return buffer.indexOf(target, from);
}

export interface ParseImageMultipartOptions {
  maxBytes: number;
}

/** Minimal bounded multipart reader for the single-image API; file validation remains in storage. */
export function parseImageMultipart({ maxBytes }: ParseImageMultipartOptions) {
  return async (request: Request | any, _response: Response, next: NextFunction): Promise<any> => {
    try {
      const contentType = request.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload an image using multipart/form-data.');
      }
      const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
      if (!boundaryMatch) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
      const boundary = boundaryMatch[1] ?? boundaryMatch[2];
      if (!boundary || boundary.length > 70) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes + 65_536) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks);
      const delimiter = Buffer.from(`--${boundary}`);
      const separator = Buffer.from('\r\n\r\n');
      request.body = {};
      let cursor = 0;
      let fileCount = 0;
      while (true) {
        const start = indexOf(input, delimiter, cursor);
        if (start < 0) break;
        let partStart = start + delimiter.length;
        if (input.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) break;
        if (input.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))) partStart += 2;
        const headerEnd = indexOf(input, separator, partStart);
        const nextBoundary = indexOf(input, Buffer.from(`\r\n--${boundary}`), headerEnd + separator.length);
        if (headerEnd < 0 || nextBoundary < 0) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
        const headerText = input.subarray(partStart, headerEnd).toString('latin1');
        const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headerText);
        if (!disposition) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
        const [, name, filename] = disposition;
        const value = input.subarray(headerEnd + separator.length, nextBoundary);
        if (filename !== undefined) {
          fileCount += 1;
          if (name !== 'file' || fileCount > 1) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
          const type = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? 'application/octet-stream';
          request.file = { buffer: value, originalname: filename, mimetype: type };
        } else {
          if (name !== 'projectId' && name !== 'altText' && name !== 'title' && name !== 'type') {
            throw new AppError(400, 'VALIDATION_ERROR', `Unknown multipart field: ${name}`);
          }
          if (Object.hasOwn(request.body, name)) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
          request.body[name] = value.toString('utf8');
        }
        cursor = nextBoundary + 2;
      }
      if (!request.file) throw new AppError(400, 'VALIDATION_ERROR', 'The file field is required.');
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const parseMediaMultipart = parseImageMultipart;
