type Resolver<T> = (result: IteratorResult<T>) => void;

/**
 * A single-consumer, push-based async iterable. Generic sibling of core's
 * EventQueue (which is hardcoded to AgentEvent). Used to carry AcpMessage from a
 * transport's stdout into the session consumer. Single-consumer is enforced: a
 * second concurrent consumer's next() rejects rather than hanging.
 */
export class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private resolver: Resolver<T> | null = null;
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ value, done: false });
    } else {
      this.buffer.push(value);
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

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        if (this.resolver) {
          return Promise.reject(
            new Error("AsyncMessageQueue is single-consumer: a consumer is already waiting"),
          );
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolver = resolve;
        });
      },
    };
  }
}
