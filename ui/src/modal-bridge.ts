import type { AppRuntimeCtx } from "@tokimo/sdk";

/**
 * Module-level bridge registry for the SSH terminal editor modal window.
 *
 * Modal windows are mounted in the HOST React tree, so they cannot read the
 * app's `AppRuntimeCtx` from context. We pass the ctx (and a result callback)
 * through this module-scoped registry, keyed by an id forwarded via window
 * metadata. Same bundle, single module instance → shared scope.
 */
export interface TerminalEditorBridge {
  ctx: AppRuntimeCtx;
  /** Existing terminal id when editing. */
  terminalId?: string;
  /** Source terminal id to duplicate (prefill, create as new). */
  duplicateId?: string;
  /** Invoked with the created/updated terminal id on save. */
  onSaved?: (savedId: string, isEdit: boolean) => void;
}

const registry = new Map<string, TerminalEditorBridge>();
let counter = 0;

export function registerBridge(b: TerminalEditorBridge): string {
  counter += 1;
  const id = `terminal-bridge-${Date.now()}-${counter}`;
  registry.set(id, b);
  return id;
}

export function getBridge(id: string): TerminalEditorBridge | undefined {
  return registry.get(id);
}

export function clearBridge(id: string): void {
  registry.delete(id);
}
