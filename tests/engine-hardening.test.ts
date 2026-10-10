import { describe, expect, it, vi } from 'vitest';
import { FrontlabEngine } from '../src/engine.js';

function harness() {
  let messageHandler: ((event: unknown) => void) | null = null;
  const frame = {
    contentWindow: {},
    srcdoc: '',
    setAttribute: vi.fn(),
    remove: vi.fn()
  };
  const win = {
    crypto: globalThis.crypto,
    addEventListener: vi.fn((_type: string, handler: (event: unknown) => void) => { messageHandler = handler; }),
    removeEventListener: vi.fn()
  };
  const doc = { defaultView: win, createElement: vi.fn(() => frame) };
  const host = { ownerDocument: doc, append: vi.fn() };
  const engine = new FrontlabEngine(host as unknown as HTMLElement, { debounceMs: 0 });
  const receive = (origin: string, type: 'ready' | 'diagnostic', diagnostic?: object) => {
    const match = frame.srcdoc.match(/const token="([^"]+)",runId=(\d+)/);
    if (!match || !messageHandler) throw new Error('Missing bootstrap');
    messageHandler({
      origin,
      source: frame.contentWindow,
      data: { channel: 'pfx-frontlab', token: match[1], runId: Number(match[2]), type, diagnostic }
    });
  };
  return { engine, frame, win, receive };
}

describe('runtime boundary hardening', () => {
  it('waits for a current-run ready event and rejects non-opaque origins', () => {
    const { engine, receive } = harness();
    engine.run();
    expect(engine.status).toBe('starting');
    receive('https://attacker.example', 'ready');
    expect(engine.status).toBe('starting');
    receive('null', 'ready');
    expect(engine.status).toBe('running');
    engine.dispose();
  });

  it('validates source strings and UTF-8 byte limits before mutating state', () => {
    const { engine } = harness();
    expect(() => engine.update({ html: '', css: '', javascript: 23 } as never, true)).toThrow(TypeError);
    expect(() => engine.update({ html: 'é'.repeat(600_000), css: '', javascript: '' }, true)).toThrow(RangeError);
    expect(engine.status).toBe('idle');
    engine.dispose();
  });

  it('does not let consumer listener exceptions break control flow', () => {
    const { engine } = harness();
    engine.subscribe(() => { throw new Error('app callback failed'); });
    expect(() => engine.run()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('bounds diagnostic forwarding to 200 events per run', () => {
    const { engine, receive } = harness();
    let seen = 0;
    engine.subscribe(e => { if (e.type === 'diagnostic') seen++; });
    engine.run();
    for (let i = 0; i < 220; i++) {
      receive('null', 'diagnostic', { level: 'log', kind: 'console', message: 'x' });
    }
    expect(seen).toBe(200);
    engine.dispose();
  });
});
