import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "terminal",
  name: "SSH Terminal",
  category: "page",
  supportedTypes: ["terminal"],
  defaultSize: { width: 1100, height: 700 },
  component: () => import("./pages/TerminalAppPage"),
};
