// A per-process cap on how many times something may happen per UTC day, for
// the calls that cost money on a public deployment: each test visitor and
// each catch-up summary calls Amazon Bedrock. Configured by an environment
// variable; unset means no cap, as on a household's own server.

export class DailyLimit {
  private day = "";
  private used = 0;

  constructor(
    private readonly limit: number | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Counts one use and returns true, or returns false when today's cap is reached. */
  take(): boolean {
    if (this.limit === null) return true;
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}

/** A cap from the environment: a whole number of at least 1, or none when unset. */
export function dailyLimitFromEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`${name} must be a whole number of at least 1 (got "${raw}")`);
  }
  return limit;
}
