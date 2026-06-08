import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const R2_UPLOAD_ATTEMPTS = parsePositiveInt(process.env.R2_UPLOAD_ATTEMPTS, 5);
const R2_UPLOAD_TIMEOUT_MS = parsePositiveInt(process.env.R2_UPLOAD_TIMEOUT_MS, 600_000);
const R2_UPLOAD_RETRY_BASE_MS = parsePositiveInt(process.env.R2_UPLOAD_RETRY_BASE_MS, 2_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(error: unknown) {
  const metadata = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata;
  return metadata?.httpStatusCode ?? null;
}

function getErrorName(error: unknown) {
  return (error as { name?: string; Code?: string } | null)?.name ?? (error as { Code?: string } | null)?.Code ?? 'UnknownError';
}

function isRetryableR2UploadError(error: unknown) {
  const status = getErrorStatus(error);
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  if ((error as { $retryable?: unknown } | null)?.$retryable) return true;

  const name = getErrorName(error);
  return /Timeout|Abort|ServiceUnavailable|SlowDown|Throttl/i.test(name);
}

async function sendPutObjectWithTimeout(command: PutObjectCommand) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), R2_UPLOAD_TIMEOUT_MS);
  try {
    return await r2.send(command, { abortSignal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Upload a buffer to R2, returns public URL. Used by migration scripts. */
export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= R2_UPLOAD_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    try {
      await sendPutObjectWithTimeout(command);
      return `${PUBLIC_URL}/${key}`;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const retryable = isRetryableR2UploadError(error);
      const status = getErrorStatus(error);
      const name = getErrorName(error);
      if (!retryable || attempt >= R2_UPLOAD_ATTEMPTS) break;

      const delayMs = R2_UPLOAD_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `[R2] upload retry ${attempt}/${R2_UPLOAD_ATTEMPTS} key=${key} status=${status ?? '-'} error=${name} elapsedMs=${elapsedMs} nextDelayMs=${delayMs}`,
      );
      await sleep(delayMs);
    }
  }

  const status = getErrorStatus(lastError);
  const name = getErrorName(lastError);
  throw new Error(`R2 upload failed after ${R2_UPLOAD_ATTEMPTS} attempts: key=${key} status=${status ?? '-'} error=${name}`, {
    cause: lastError,
  });
}

export async function getR2ObjectBuffer(key: string, timeoutMs = 300_000): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }),
      { abortSignal: controller.signal },
    );

    if (!response.Body) {
      throw new Error('R2 object has no body');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stream a file from R2 as a web ReadableStream.
 * Use this in API routes to proxy PDFs without loading them into memory.
 */
export async function getR2Stream(key: string): Promise<{ stream: ReadableStream; contentType: string; contentLength: number }> {
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error('R2 object has no body');
  }

  const contentType = response.ContentType ?? 'application/octet-stream';
  const contentLength = response.ContentLength ?? 0;

  // Convert Node.js Readable to web ReadableStream
  const nodeStream = response.Body as Readable;
  const stream = new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err: Error) => {
        controller.error(err);
      });
    },
  });

  return { stream, contentType, contentLength };
}
