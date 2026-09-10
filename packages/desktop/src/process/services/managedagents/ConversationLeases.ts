import { randomUUID } from 'node:crypto';

/** Keep catalog activation outside the complete conversation-creation request. */
export class ConversationLeases {
  private leases = new Map<string, ReturnType<typeof setTimeout>>();
  private waiters = new Set<() => void>();

  acquire(): string {
    const id = randomUUID();
    // A crashed window cannot block updates forever. Local requests time out in 30 seconds.
    const timer = setTimeout(() => this.release(id), 120_000);
    timer.unref?.();
    this.leases.set(id, timer);
    return id;
  }

  release(id: string): void {
    const timer = this.leases.get(id);
    if (timer) clearTimeout(timer);
    this.leases.delete(id);
    if (!this.leases.size) {
      for (const resolve of this.waiters) resolve();
      this.waiters.clear();
    }
  }

  async wait(): Promise<void> {
    while (this.leases.size) await new Promise<void>((resolve) => this.waiters.add(resolve));
  }
}
