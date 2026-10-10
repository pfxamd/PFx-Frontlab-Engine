import type { Diagnostic } from './types.js';

export type RuntimeMessage =
  | { channel: 'pfx-frontlab'; token: string; runId: number; type: 'ready' | 'css-updated' }
  | { channel: 'pfx-frontlab'; token: string; runId: number; type: 'diagnostic'; diagnostic: Omit<Diagnostic, 'runId'> };

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.channel !== 'pfx-frontlab' || typeof v.token !== 'string' || typeof v.runId !== 'number' || !Number.isSafeInteger(v.runId)) return false;
  if (v.type === 'ready' || v.type === 'css-updated') return true;
  if (v.type !== 'diagnostic' || !v.diagnostic || typeof v.diagnostic !== 'object') return false;
  const d = v.diagnostic as Record<string, unknown>;
  return ['error','warn','log','info'].includes(String(d.level))
    && ['console','runtime','promise','protocol'].includes(String(d.kind))
    && typeof d.message === 'string' && d.message.length <= 16_384;
}
