import type { RenderPayloadSchema } from '@vision/contracts';
import type { z } from 'zod';

export type ValidatedRenderPayload = z.infer<typeof RenderPayloadSchema>;

export type RendererExecutionDiagnostics = Readonly<{
  rendererVersion: string;
  remotionVersion?: string;
  ffmpegVersion?: string;
  elapsedMs: number;
  logs: readonly string[];
}>;

export type RendererExecutionResult = Readonly<{
  outputPath: string;
  diagnostics: RendererExecutionDiagnostics;
}>;

export interface VideoRenderer {
  render(
    input: ValidatedRenderPayload,
    options: Readonly<{
      workDir: string;
      signal?: AbortSignal;
    }>,
  ): Promise<RendererExecutionResult>;
}
