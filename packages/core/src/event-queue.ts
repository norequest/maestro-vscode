import type { AgentEvent } from "./types.js";

type Resolver = (result: IteratorResult<AgentEvent>) => void;

/**
 * A single-consumer, push-based async iterable of AgentEvents.
 * Invariant: a pending resolver only exists when the buffer is empty,
 * so push() either hands off to a waiter or buffers, never both.
 */
export class EventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private readonly resolvers: Resolver[] = [];
  private ended = false;

  push(event: AgentEvent): void {
    if (this.ended) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let resolver: Resolver | undefined;
    while ((resolver = this.resolvers.shift())) {
      resolver({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: (): Promise<IteratorResult<AgentEvent>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<AgentEvent>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
