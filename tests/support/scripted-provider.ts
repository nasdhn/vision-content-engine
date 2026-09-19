/** Test-only queue of synthetic outcomes; never a production provider adapter. */
export class ScriptedProvider<Input, Output> {
  readonly calls: Input[] = [];
  private readonly outcomes: (Output | Error)[];

  constructor(outcomes: readonly (Output | Error)[]) {
    this.outcomes = [...outcomes];
  }

  async execute(input: Input): Promise<Output> {
    this.calls.push(structuredClone(input));
    if (this.outcomes.length === 0) throw new Error('FAKE_EXHAUSTED');
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return structuredClone(outcome) as Output;
  }
}
