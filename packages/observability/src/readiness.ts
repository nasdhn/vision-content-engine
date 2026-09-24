export type Probe = () => Promise<void>;
export type ReadinessProbes = Readonly<Record<'postgres' | 'redis' | 'storage', Probe>>;

export async function checkReadiness(probes: Partial<ReadinessProbes>, timeoutMs = 2000) {
  const checks = await Promise.all(
    Object.entries(probes).map(async ([name, probe]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(probe),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), timeoutMs);
          }),
        ]);
        return [name, 'up'] as const;
      } catch {
        // Provider exceptions may contain credentials or internal addresses.
        return [name, 'down'] as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return {
    status:
      checks.length > 0 && checks.every(([, result]) => result === 'up') ? 'ready' : 'not_ready',
    checks: Object.fromEntries(checks),
  } as const;
}
