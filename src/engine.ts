import { buildDocument } from './document.js';
import { isRuntimeMessage } from './protocol.js';
import type { EngineEvent, EngineListener, EngineOptions, EngineState, FrontlabFiles } from './types.js';

export class FrontlabEngine {
  private frame: HTMLIFrameElement | null = null;
  private current: FrontlabFiles = { html: '', css: '', javascript: '' };
  private activeRun = 0;
  private activeToken = '';
  private state: EngineState = 'idle';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<EngineListener>();
  private readonly debounceMs: number;
  private readonly container: HTMLElement;
  private readonly receive: (event: MessageEvent) => void;

  constructor(container: HTMLElement, options: EngineOptions = {}) {
    if (!container || !container.ownerDocument) throw new TypeError('An HTML element is required');
    if (!Number.isFinite(options.debounceMs ?? 120) || (options.debounceMs ?? 120) < 0) throw new RangeError('Invalid debounceMs');
    this.container = container;
    this.debounceMs = options.debounceMs ?? 120;
    if (options.onEvent) this.listeners.add(options.onEvent);
    this.receive = (event) => {
      if (!this.frame || event.source !== this.frame.contentWindow || !isRuntimeMessage(event.data)) return;
      const m = event.data;
      if (m.token !== this.activeToken || m.runId !== this.activeRun) return;
      if (m.type === 'ready') this.setState('running');
      else this.emit({ type:'diagnostic', diagnostic:{ ...m.diagnostic, runId:m.runId } });
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
    this.current = { ...files };
    this.cancelTimer();
    if (immediate) this.run();
    else this.timer = setTimeout(() => { this.timer = null; this.run(); }, this.debounceMs);
  }
  run(): number {
    this.assertActive();
    this.cancelTimer();
    this.activeRun++;
    const tokenBytes = new Uint8Array(16);
    const crypto = this.container.ownerDocument.defaultView?.crypto;
    if (!crypto?.getRandomValues) throw new Error('Secure crypto is required');
    crypto.getRandomValues(tokenBytes);
    this.activeToken = Array.from(tokenBytes,b => b.toString(16).padStart(2,'0')).join('');
    const frame = this.container.ownerDocument.createElement('iframe');
    frame.setAttribute('sandbox','allow-scripts');
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('title','Frontlab preview');
    frame.srcdoc = buildDocument(this.current,this.activeToken,this.activeRun);
    this.frame?.remove();
    this.frame = frame;
    this.setState('starting');
    this.container.append(frame);
    return this.activeRun;
  }
  stop(): void {
    this.assertActive();
    this.cancelTimer();
    this.activeRun++;
    this.activeToken = '';
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
  private assertActive(): void { if (this.state === 'disposed') throw new Error('Engine is disposed'); }
  private setState(state: EngineState): void { this.state=state; this.emit({type:'state',state,runId:this.activeRun}); }
  private emit(e: EngineEvent): void { for (const listener of this.listeners) listener(e); }
}
