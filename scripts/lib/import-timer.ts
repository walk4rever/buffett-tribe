export class ImportTimer {
  private readonly startedAt = Date.now();
  private lastAt = this.startedAt;

  constructor(private readonly label: string, private readonly indent = "  ") {}

  mark(step: string, details?: string) {
    const now = Date.now();
    const stepSeconds = ((now - this.lastAt) / 1000).toFixed(1);
    const totalSeconds = ((now - this.startedAt) / 1000).toFixed(1);
    this.lastAt = now;
    const suffix = details ? `, ${details}` : "";
    console.log(`${this.indent}${this.label} ${step}: ${stepSeconds}s (total ${totalSeconds}s${suffix})`);
  }

  async time<T>(step: string, fn: () => Promise<T>, details?: (result: T) => string | undefined) {
    const result = await fn();
    this.mark(step, details?.(result));
    return result;
  }

  timeSync<T>(step: string, fn: () => T, details?: (result: T) => string | undefined) {
    const result = fn();
    this.mark(step, details?.(result));
    return result;
  }
}
