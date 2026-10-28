/** Limitador de ventana fija en memoria (suficiente para una sola instancia). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Registra un intento. Devuelve `retryAfter` en segundos si se superó el límite. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    entry.count++;
    if (entry.count > this.max) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /** ¿Ya está bloqueada la clave? No suma intentos. */
  isBlocked(key: string, now = Date.now()): { blocked: boolean; retryAfter: number } {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now || entry.count < this.max) {
      return { blocked: false, retryAfter: 0 };
    }
    return { blocked: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
