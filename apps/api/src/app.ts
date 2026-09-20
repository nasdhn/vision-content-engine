import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { checkReadiness } from '@vision/observability';
import type { ReadinessProbes } from '@vision/observability';

import { RecordingController, RECORDINGS } from './recordings.js';
import type { RecordingApiOptions } from './recordings.js';

const PROBES = Symbol('bootstrap-readiness-probes');

@Controller()
class HealthController {
  constructor(@Inject(PROBES) private readonly probes: ReadinessProbes) {}

  @Get('healthz')
  health() {
    return { status: 'ok', service: 'api' };
  }

  @Get('readyz')
  async ready() {
    const result = await checkReadiness(this.probes);
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}

export async function createApi(probes: ReadinessProbes, recordings?: RecordingApiOptions) {
  @Module({
    controllers: [HealthController, ...(recordings ? [RecordingController] : [])],
    providers: [
      { provide: PROBES, useValue: probes },
      ...(recordings ? [{ provide: RECORDINGS, useValue: recordings }] : []),
    ],
  })
  class BootstrapModule {}
  return NestFactory.create(BootstrapModule, { logger: false, abortOnError: false });
}
