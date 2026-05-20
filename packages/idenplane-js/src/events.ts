export type EventHandler<T> = T extends void ? () => void : (data: T) => void;

export class EventEmitter<TMap extends Record<string, unknown>> {
  private listeners = new Map<keyof TMap, Set<EventHandler<unknown>>>();

  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof TMap>(event: K, ...args: TMap[K] extends void ? [] : [TMap[K]]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch {
        // Don't let listener errors break the emitter
      }
    }
  }
}
