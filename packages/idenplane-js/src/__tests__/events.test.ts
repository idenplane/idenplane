import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../events.js';

type TestEvents = {
  login: string;
  logout: void;
  error: Error;
};

describe('EventEmitter', () => {
  it('should emit events to registered handlers', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('login', handler);
    emitter.emit('login', 'user-1');

    expect(handler).toHaveBeenCalledWith('user-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support multiple handlers for the same event', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('login', handler1);
    emitter.on('login', handler2);
    emitter.emit('login', 'user-1');

    expect(handler1).toHaveBeenCalledWith('user-1');
    expect(handler2).toHaveBeenCalledWith('user-1');
  });

  it('should unsubscribe a handler with off()', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('login', handler);
    emitter.off('login', handler);
    emitter.emit('login', 'user-1');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle void events', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('logout', handler);
    emitter.emit('logout');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not throw when emitting an event with no listeners', () => {
    const emitter = new EventEmitter<TestEvents>();
    expect(() => emitter.emit('login', 'user-1')).not.toThrow();
  });

  it('should not let listener errors break the emitter', () => {
    const emitter = new EventEmitter<TestEvents>();
    const badHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();

    emitter.on('login', badHandler);
    emitter.on('login', goodHandler);
    emitter.emit('login', 'user-1');

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it('should handle Error event payloads', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    const error = new Error('auth failed');

    emitter.on('error', handler);
    emitter.emit('error', error);

    expect(handler).toHaveBeenCalledWith(error);
  });
});
