import type {
  CreateSshTerminalInput,
  SshDfResponse,
  SshFileContentResponse,
  SshLsResponse,
  SshPsResponse,
  SshTerminalOutput,
  UpdateSshTerminalInput,
} from "./types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const API_BASE = "/api/apps/terminal";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;
  if (!res.ok) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
  if (!json?.success) throw new Error(json?.error ?? "API request failed");
  return json.data as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${API_BASE}${path}`;
}

export const terminalApi = {
  list: () => apiFetch<SshTerminalOutput[]>("/connections"),
  create: (input: CreateSshTerminalInput) =>
    apiFetch<SshTerminalOutput>("/connections", jsonInit("POST", input)),
  update: (id: string, input: UpdateSshTerminalInput) =>
    apiFetch<SshTerminalOutput>(
      `/connections/${encodeURIComponent(id)}`,
      jsonInit("PATCH", input),
    ),
  delete: (id: string) =>
    apiFetch<void>(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  stats: (id: string) =>
    apiFetch<unknown>(`/connections/${encodeURIComponent(id)}/stats`),
  ps: (id: string) =>
    apiFetch<SshPsResponse>(`/connections/${encodeURIComponent(id)}/ps`),
  df: (id: string) =>
    apiFetch<SshDfResponse>(`/connections/${encodeURIComponent(id)}/df`),
  net: (id: string) =>
    apiFetch<unknown>(`/connections/${encodeURIComponent(id)}/net`),
  ls: (id: string, path: string) =>
    apiFetch<SshLsResponse>(
      `/connections/${encodeURIComponent(id)}/ls?path=${encodeURIComponent(path)}`,
    ),
  mkdir: (id: string, path: string) =>
    apiFetch<void>(`/connections/${encodeURIComponent(id)}/mkdir`, jsonInit("POST", { path })),
  rm: (id: string, path: string) =>
    apiFetch<void>(`/connections/${encodeURIComponent(id)}/rm`, jsonInit("POST", { path })),
  readFile: (id: string, path: string) =>
    apiFetch<SshFileContentResponse>(
      `/connections/${encodeURIComponent(id)}/read-file`,
      jsonInit("POST", { path }),
    ),
  writeFile: (id: string, path: string, content: string) =>
    apiFetch<void>(
      `/connections/${encodeURIComponent(id)}/write-file`,
      jsonInit("POST", { path, content }),
    ),
  docker: (id: string, kind: "ps" | "images" | "networks" | "volumes" | "stats") =>
    apiFetch<unknown>(`/connections/${encodeURIComponent(id)}/docker/${kind}`),
};
