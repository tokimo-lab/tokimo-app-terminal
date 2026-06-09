/**
 * usePreference — per-app DB-backed preference hooks built on the SDK's
 * `useShellPreference`. The shell exposes a SINGLE flat app-scoped object, so
 * arbitrary `(scope, scopeId)` namespacing is nested under `data[scope][scopeId]`.
 * All reads/writes go through the typed shell preferences API.
 */

import { useRuntimeCtx, useShellPreference } from "@tokimo/sdk";
import { useCallback, useState } from "react";

type ShellPrefShape = Record<string, Record<string, Record<string, unknown>>>;

/** Low-level hook: read & mutate a single namespaced preference object. */
export function usePreference<T extends object = Record<string, unknown>>(
  scope: string,
  scopeId: string,
) {
  const ctx = useRuntimeCtx();
  const { data: shellData, patch: shellPatch } =
    useShellPreference<ShellPrefShape>(ctx);
  const [isMutating, setIsMutating] = useState(false);

  const data = (shellData[scope]?.[scopeId] as T) ?? ({} as T);

  const patch = useCallback(
    async (partial: Partial<T>) => {
      setIsMutating(true);
      try {
        await shellPatch({ [scope]: { [scopeId]: partial } });
      } finally {
        setIsMutating(false);
      }
    },
    [shellPatch, scope, scopeId],
  );

  const reset = useCallback(async () => {
    setIsMutating(true);
    try {
      await shellPatch({ [scope]: { [scopeId]: {} } });
    } finally {
      setIsMutating(false);
    }
  }, [shellPatch, scope, scopeId]);

  return { data, isLoading: false, isMutating, patch, reset };
}

/** Per-component preference. scope = "component", scopeId = component ID. */
export function useComponentPreference<
  T extends object = Record<string, unknown>,
>(componentId: string) {
  return usePreference<T>("component", componentId);
}
