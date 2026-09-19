import { expect, it } from 'vitest';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { ManualClock } from '../support/manual-clock.js';

it('replays synthetic success/failure and fails on fixture exhaustion', async () => {
  const fake = new ScriptedProvider<{ id: string }, { result: string }>([
    { result: 'synthetic' },
    new Error('SIMULATED_TIMEOUT'),
  ]);
  const input = { id: 'fixture-1' };
  const output = await fake.execute(input);
  input.id = 'mutated';
  expect(fake.calls[0]).toEqual({ id: 'fixture-1' });
  expect(output).toEqual({ result: 'synthetic' });
  await expect(fake.execute(input)).rejects.toThrow('SIMULATED_TIMEOUT');
  await expect(fake.execute(input)).rejects.toThrow('FAKE_EXHAUSTED');
});
it('controls clock without wall time', () => {
  const clock = new ManualClock(Date.UTC(2026, 0, 1));
  clock.advance(1000);
  expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
});
