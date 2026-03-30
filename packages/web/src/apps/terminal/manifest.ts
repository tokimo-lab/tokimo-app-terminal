import { Terminal } from "lucide-react";
import { TERMINAL_THEMES } from "@/apps/terminal/components/terminal-themes";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "terminal",
  name: "Terminal Management",
  category: "system",
  defaultSize: { width: 1100, height: 700 },
  icon: Terminal,
  image: "/page-icons/terminal.png",
  labelKey: "terminalManagement",
  order: 71,
  color: "#8b5cf6",
  component: () => import("./pages/TerminalAppPage"),
  fullBleed: true,

  componentSettings: [
    {
      id: "terminal",
      label: "settings.terminal.title",
      icon: Terminal,
      sections: [
        {
          key: "fileBrowser",
          label: "settings.terminal.fileBrowser",
          fields: [
            {
              key: "viewMode",
              type: "select",
              label: "settings.terminal.viewMode",
              description: "settings.terminal.viewModeDesc",
              defaultValue: "list",
              options: [
                { label: "settings.terminal.viewList", value: "list" },
                { label: "settings.terminal.viewGrid", value: "grid" },
              ],
            },
          ],
        },
        {
          key: "theme",
          label: "settings.terminal.theme",
          fields: [
            {
              key: "colorScheme",
              type: "select",
              label: "settings.terminal.colorScheme",
              description: "settings.terminal.colorSchemeDesc",
              defaultValue: "auto",
              options: TERMINAL_THEMES.map((t) => ({
                label: t.name,
                value: t.id,
              })),
            },
          ],
        },
      ],
    },
  ],
};
