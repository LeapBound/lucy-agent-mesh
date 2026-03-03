import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes: number
): Promise<T> {
  const payload = await readRawBody(request, maxBytes);

  if (!payload) {
    return {} as T;
  }

  return parseJsonBody<T>(payload);
}

export async function readRawBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<string> {
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
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function parseJsonBody<T>(payload: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
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
