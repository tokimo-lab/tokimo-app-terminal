import type { Dispose } from "@tokimo/sdk";
import { defineApp, RuntimeProvider } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppCtxProvider } from "./AppContext";
import { TerminalApp } from "./components/TerminalApp";
import "./index.css";

export default defineApp({
  id: "terminal",
  manifest: {
    id: "terminal",
    appName: "Terminal",
    icon: "Terminal",
    image: "icon.png",
    color: "#8b5cf6",
    windowType: "terminal",
    defaultSize: { width: 1100, height: 700 },
    category: "system",
  },
  mount(container, ctx): Dispose {
    const root: Root = createRoot(container);
    root.render(
      <StrictMode>
        <RuntimeProvider value={ctx}>
          <AppCtxProvider value={ctx}>
            <ConfigProvider>
              <ToastProvider>
                <TerminalApp />
              </ToastProvider>
            </ConfigProvider>
          </AppCtxProvider>
        </RuntimeProvider>
      </StrictMode>,
    );
    return () => root.unmount();
  },
});
