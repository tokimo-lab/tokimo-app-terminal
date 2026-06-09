import { useToast } from "@tokimo/sdk";

/**
 * Toast-based message shim. Maps `message.success/error/info/warning(text)`
 * onto the SDK toast API so ported components can keep calling `message.*`.
 */
export function useMessage() {
  return useToast();
}
