import type { AgentEvent } from "./types.js";

type Resolver = (result: IteratorResult<AgentEvent>) => void;

/**
 * A single-consumer, push-based async iterable of AgentEvents.
 * Single-consumer is enforced: a second concurrent consumer's next() rejects
 * rather than hanging. Invariant: at most one pending resolver, and it only
 * exists when the buffer is empty.
 */
export class EventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private resolver: Resolver | null = null;
  private ended = false;

  push(event: AgentEvent): void {
    if (this.ended) return;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: (): Promise<IteratorResult<AgentEvent>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        if (this.resolver) {
          return Promise.reject(
            new Error("EventQueue is single-consumer: a consumer is already waiting"),
          );
        }
        return new Promise<IteratorResult<AgentEvent>>((resolve) => {
          this.resolver = resolve;
        });
      },
    };
  }
}
