export type RateLimitResult = {
  limited: boolean;
  retryAfterMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

/** A bounded fixed-window limiter suitable for a single MVP API process. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  public constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 10_000,
  ) {}

  public consume(key: string, now = Date.now()): RateLimitResult {
    this.prune(now);
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { limited: false, retryAfterMs: 0 };
    }

    current.count += 1;
    return {
      limited: current.count > this.maxAttempts,
      retryAfterMs: Math.max(0, current.resetAt - now),
    };
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }

  public size(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxBuckets) return;

    const oldest = [...this.buckets.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
      .slice(0, Math.max(1, Math.ceil(this.maxBuckets / 10)));
    for (const [key] of oldest) this.buckets.delete(key);
  }
}

export function rateLimitKey(ip: string, email?: string): string {
  return email ? `${ip}:${email.toLowerCase()}` : ip;
}
