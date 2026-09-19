export class ManualClock {
  constructor(private instantMs: number) {}
  now(): Date {
    return new Date(this.instantMs);
  }
  advance(milliseconds: number): void {
    this.instantMs += milliseconds;
  }
}
