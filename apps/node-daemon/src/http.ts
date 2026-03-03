import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes: number
): Promise<T> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);

    totalSize += bufferChunk.byteLength;

    if (totalSize > maxBytes) {
      throw new Error(`Body exceeds max size (${maxBytes} bytes)`);
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(payload) as T;
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);

  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

export function sendError(
  response: ServerResponse,
  statusCode: number,
  error: string
): void {
  sendJson(response, statusCode, { error });
}
