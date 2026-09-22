import { Controller, Headers, HttpException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { DomainError } from '@vision/domain';
import {
  VISION_ATTRIBUTION_SIGNATURE_HEADER,
  VISION_ATTRIBUTION_TIMESTAMP_HEADER,
  VisionAttributionIngestError,
  type VisionAttributionIngestService,
} from '@vision/application';

export const VISION_ATTRIBUTION_INGEST = Symbol('vision-attribution-ingest-service');

type RawBodyRequest = IncomingMessage & { rawBody?: Buffer };

@Controller('api/internal/analytics/vision-events')
export class VisionAttributionIngestController {
  constructor(
    @Inject(VISION_ATTRIBUTION_INGEST)
    private readonly ingestService: VisionAttributionIngestService,
  ) {}

  @Post()
  @HttpCode(202)
  async ingest(
    @Req() req: RawBodyRequest,
    @Headers(VISION_ATTRIBUTION_TIMESTAMP_HEADER) timestamp: string | undefined,
    @Headers(VISION_ATTRIBUTION_SIGNATURE_HEADER) signature: string | undefined,
  ) {
    try {
      const headers = {
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(signature !== undefined ? { signature } : {}),
      };

      return await this.ingestService.ingest(req.rawBody, headers);
    } catch (error) {
      if (error instanceof VisionAttributionIngestError) {
        throw new HttpException(error.code, error.statusCode);
      }
      if (error instanceof DomainError) {
        if (error.code === 'VISION_ATTRIBUTION_REPLAY') {
          throw new HttpException(error.code, 409);
        }
        if (error.code === 'VISION_ATTRIBUTION_TRACKING_CODE_NOT_FOUND') {
          throw new HttpException(error.code, 422);
        }
        throw new HttpException(error.code, 422);
      }
      throw new HttpException('VISION_ATTRIBUTION_INGEST_FAILED', 409);
    }
  }
}
