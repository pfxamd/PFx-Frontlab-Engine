import { buildDocument } from './document.js';
import { isRuntimeMessage } from './protocol.js';
import type { EngineEvent, EngineListener, EngineOptions, EngineState, FrontlabFiles } from './types.js';

export class FrontlabEngine {
  private frame: HTMLIFrameElement | null = null;
  private current: FrontlabFiles = { html: '', css: '', javascript: '' };
  private activeRun = 0;
  private activeToken = '';
  private diagnosticCount = 0;
  private state: EngineState = 'idle';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly startupTimeoutMs: number;
  private readonly runnerUrl: URL | null;
  private compiledDocument = '';
  private readonly listeners = new Set<EngineListener>();
  private readonly debounceMs: number;
  private readonly container: HTMLElement;
  private readonly receive: (event: MessageEvent) => void;

  constructor(container: HTMLElement, options: EngineOptions = {}) {
    if (!container || !container.ownerDocument) throw new TypeError('An HTML element is required');
    if (!Number.isFinite(options.debounceMs ?? 120) || (options.debounceMs ?? 120) < 0) throw new RangeError('Invalid debounceMs');
    this.container = container;
    this.debounceMs = options.debounceMs ?? 120;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 12_000;
    if (!Number.isSafeInteger(this.startupTimeoutMs) || this.startupTimeoutMs < 50 || this.startupTimeoutMs > 120_000) {
      throw new RangeError('startupTimeoutMs must be between 50 and 120000');
    }
    const win = container.ownerDocument.defaultView;
    if (options.runnerUrl) {
      if (!win?.location) throw new TypeError('A browser location is required');
      const url = new URL(options.runnerUrl, win.location.href);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.origin === win.location.origin || !['http:', 'https:'].includes(url.protocol) ||
          (url.protocol !== 'https:' && !loopback) || url.username || url.password) {
        throw new TypeError('Runner must use a separate HTTPS origin (localhost HTTP allowed for testing)');
      }
      this.runnerUrl = url;
    } else {
      this.runnerUrl = null;
    }
    if (options.onEvent) this.listeners.add(options.onEvent);
    this.receive = (event) => {
      if (!this.frame || event.source !== this.frame.contentWindow) return;
      if (this.runnerUrl && event.origin === this.runnerUrl.origin &&
          event.data?.channel === 'pfx-frontlab-bridge' && event.data?.type === 'runner-ready') {
        if (this.state === 'starting') {
          this.frame.contentWindow?.postMessage({
            channel: 'pfx-frontlab-bridge', type: 'mount',
            token: this.activeToken, runId: this.activeRun, html: this.compiledDocument
          }, this.runnerUrl.origin);
        }
        return;
      }
      if (event.origin !== (this.runnerUrl?.origin ?? 'null') || !isRuntimeMessage(event.data)) return;
      const m = event.data;
      if (m.token !== this.activeToken || m.runId !== this.activeRun) return;
      if (m.type === 'ready') {
        if (this.state === 'starting') { this.cancelStartupTimer(); this.setState('running'); }
      } else if (m.type === 'css-updated') {
        this.emit({ type: 'css-updated', runId: m.runId });
      } else if (m.type === 'diagnostic' && this.diagnosticCount < 200) {
        this.diagnosticCount++;
        this.emit({ type:'diagnostic', diagnostic:{ ...m.diagnostic, runId:m.runId } });
      }
    };
    container.ownerDocument.defaultView?.addEventListener('message', this.receive);
  }
  get status(): EngineState { return this.state; }
  get runId(): number { return this.activeRun; }
  subscribe(listener: EngineListener): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  update(files: FrontlabFiles, immediate = false): void {
    this.assertActive();
    if (!files || typeof files.html !== 'string' || typeof files.css !== 'string' || typeof files.javascript !== 'string') {
      throw new TypeError('html, css and javascript must be strings');
    }
    const encoder = new TextEncoder();
    const size = encoder.encode(files.html).length + encoder.encode(files.css).length + encoder.encode(files.javascript).length;
    if (size > 1024 * 1024) throw new RangeError('Frontlab source exceeds 1 MiB');
    this.current = { ...files };
    this.cancelTimer();
    if (immediate) this.run();
    else this.timer = setTimeout(() => { this.timer = null; this.run(); }, this.debounceMs);
  }
  /** Update only the stylesheet while keeping the preview DOM and JS state. */
  updateCSS(css: string): void {
    this.assertActive();
    if (typeof css !== 'string') throw new TypeError('CSS must be a string');
    const files = { ...this.current, css };
    const encoder = new TextEncoder();
    const size = encoder.encode(files.html).length + encoder.encode(files.css).length + encoder.encode(files.javascript).length;
    if (size > 1024 * 1024) throw new RangeError('Frontlab source exceeds 1 MiB');
    this.current = files;
    this.cancelTimer();
    if (this.state !== 'running' || !this.frame?.contentWindow) {
      this.run();
      return;
    }
    this.frame.contentWindow.postMessage({
      channel: this.runnerUrl ? 'pfx-frontlab-bridge' : 'pfx-frontlab',
      type: 'css-patch',
      token: this.activeToken,
      runId: this.activeRun,
      css
    }, this.runnerUrl?.origin ?? '*');
  }
  run(): number {
    this.assertActive();
    this.cancelTimer();
    this.activeRun++;
    this.diagnosticCount = 0;
    const tokenBytes = new Uint8Array(16);
    const crypto = this.container.ownerDocument.defaultView?.crypto;
    if (!crypto?.getRandomValues) throw new Error('Secure crypto is required');
    crypto.getRandomValues(tokenBytes);
    this.activeToken = Array.from(tokenBytes,b => b.toString(16).padStart(2,'0')).join('');
    const frame = this.container.ownerDocument.createElement('iframe');
    frame.setAttribute('sandbox', this.runnerUrl ? 'allow-scripts allow-same-origin' : 'allow-scripts');
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('title','Frontlab preview');
    this.compiledDocument = buildDocument(this.current,this.activeToken,this.activeRun);
    if (this.runnerUrl) frame.src = this.runnerUrl.href;
    else frame.srcdoc = this.compiledDocument;
    this.frame?.remove();
    this.frame = frame;
    this.container.append(frame);
    // An event listener may synchronously call stop() or dispose().
    // Emit only after insertion, so a reentrant stop can remove the frame.
    this.setState('starting');
    if (this.state === 'starting') {
      const expectedRun = this.activeRun;
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (this.state !== 'starting' || this.activeRun !== expectedRun) return;
        this.stop();
        this.emit({ type: 'timeout', runId: expectedRun, timeoutMs: this.startupTimeoutMs });
      }, this.startupTimeoutMs);
    }
    return this.activeRun;
  }
  stop(): void {
    this.assertActive();
    this.cancelTimer();
    this.cancelStartupTimer();
    this.activeRun++;
    this.activeToken = '';
    this.compiledDocument = '';
    this.frame?.remove();
    this.frame = null;
    this.setState('stopped');
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.stop();
    this.container.ownerDocument.defaultView?.removeEventListener('message',this.receive);
    this.setState('disposed');
    this.listeners.clear();
  }
  private cancelTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
  private cancelStartupTimer(): void { if (this.startupTimer !== null) { clearTimeout(this.startupTimer); this.startupTimer = null; } }
  private assertActive(): void { if (this.state === 'disposed') throw new Error('Engine is disposed'); }
  private setState(state: EngineState): void { this.state=state; this.emit({type:'state',state,runId:this.activeRun}); }
  private emit(e: EngineEvent): void {
    for (const listener of this.listeners) {
      try { listener(e); } catch { /* Consumer callbacks must not crash the engine. */ }
    }
  }
}
