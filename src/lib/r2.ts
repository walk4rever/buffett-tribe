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

/** Upload a buffer to R2, returns public URL. Used by migration scripts. */
export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${PUBLIC_URL}/${key}`;
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
