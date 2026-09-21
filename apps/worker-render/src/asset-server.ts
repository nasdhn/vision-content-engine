import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createServer } from 'node:http';

import { invariant } from '@vision/domain';

import type { ValidatedRenderPayload } from '@vision/application';

function mimeForAsset(
  path: string,
  kind: ValidatedRenderPayload['resolvedAssets'][number]['kind'],
) {
  const ext = extname(path).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return kind === 'AUDIO' ? 'audio/webm' : 'video/webm';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return kind === 'VIDEO' ? 'video/ogg' : 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  if (kind === 'VIDEO') return 'video/mp4';
  if (kind === 'AUDIO') return 'audio/mpeg';
  if (kind === 'IMAGE') return 'image/png';
  if (kind === 'FONT') return 'font/woff2';
  return 'application/octet-stream';
}

export async function startLocalAssetServer(input: {
  payload: ValidatedRenderPayload;
  overridePaths?: ReadonlyMap<string, string>;
}) {
  const token = randomUUID();
  const assets = new Map(
    input.payload.resolvedAssets.map((asset) => [
      asset.assetId,
      {
        path: input.overridePaths?.get(asset.assetId) ?? asset.localUri,
        kind: asset.kind,
      },
    ]),
  );

  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', 'no-store');

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const match = url.pathname.match(/^\/asset\/([^/]+)\/([^/]+)$/);

      if (!match || match[1] !== token) {
        response.statusCode = 404;
        response.end();
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.statusCode = 405;
        response.setHeader('Allow', 'GET, HEAD');
        response.end();
        return;
      }

      const assetId = decodeURIComponent(match[2]!);
      const asset = assets.get(assetId);

      if (!asset) {
        response.statusCode = 404;
        response.end();
        return;
      }

      const metadata = await stat(asset.path);
      invariant(metadata.isFile(), 'INPUT_ASSET_MISSING');

      response.setHeader('Content-Type', mimeForAsset(asset.path, asset.kind));
      response.setHeader('Accept-Ranges', 'bytes');

      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const requestedStart = Number(range[1]);
        const requestedEnd = range[2] ? Number(range[2]) : metadata.size - 1;
        const start = Math.max(0, requestedStart);
        const end = Math.min(metadata.size - 1, requestedEnd);

        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= metadata.size
        ) {
          response.statusCode = 416;
          response.setHeader('Content-Range', `bytes */${metadata.size}`);
          response.end();
          return;
        }

        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${metadata.size}`);
        response.setHeader('Content-Length', String(end - start + 1));

        if (request.method === 'HEAD') {
          response.end();
          return;
        }

        createReadStream(asset.path, { start, end }).pipe(response);
        return;
      }

      response.statusCode = 200;
      response.setHeader('Content-Length', String(metadata.size));

      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      createReadStream(asset.path).pipe(response);
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  invariant(address && typeof address !== 'string', 'LOCAL_ASSET_SERVER_FAILED');

  const baseUrl = `http://127.0.0.1:${address.port}/asset/${token}`;

  const payload: ValidatedRenderPayload = {
    ...input.payload,
    resolvedAssets: input.payload.resolvedAssets.map((asset) => ({
      ...asset,
      localUri: `${baseUrl}/${encodeURIComponent(asset.assetId)}`,
    })),
  };

  return {
    payload,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  } as const;
}
