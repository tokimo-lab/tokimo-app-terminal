import type {
  CreateSshTerminalInput,
  SshDfResponse,
  SshDockerImagesResponse,
  SshDockerInspectResponse,
  SshDockerLogsResponse,
  SshDockerNetworksResponse,
  SshDockerPruneResponse,
  SshDockerPsResponse,
  SshDockerStatsResponse,
  SshDockerVolumesResponse,
  SshFileContentResponse,
  SshHostStats,
  SshLsResponse,
  SshNetworkResponse,
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
  if (!res.ok)
    throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
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

function enc(id: string): string {
  return encodeURIComponent(id);
}

/** Absolute WebSocket URL for a terminal endpoint path (already under API_BASE). */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${API_BASE}${path}`;
}

/** Absolute HTTP URL under the terminal API base (for anchor downloads). */
export function httpUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export const terminalApi = {
  // ---- connections CRUD ----
  list: () => apiFetch<SshTerminalOutput[]>("/connections"),
  get: (id: string) => apiFetch<SshTerminalOutput>(`/connections/${enc(id)}`),
  create: (input: CreateSshTerminalInput) =>
    apiFetch<SshTerminalOutput>("/connections", jsonInit("POST", input)),
  update: (id: string, input: UpdateSshTerminalInput) =>
    apiFetch<SshTerminalOutput>(
      `/connections/${enc(id)}`,
      jsonInit("PATCH", input),
    ),
  delete: (id: string) =>
    apiFetch<void>(`/connections/${enc(id)}`, { method: "DELETE" }),

  // ---- system ----
  stats: (id: string) =>
    apiFetch<SshHostStats>(`/connections/${enc(id)}/stats`),
  ps: (id: string) => apiFetch<SshPsResponse>(`/connections/${enc(id)}/ps`),
  kill: (id: string, pid: number, signal?: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/kill`,
      jsonInit("POST", { pid, signal }),
    ),
  df: (id: string) => apiFetch<SshDfResponse>(`/connections/${enc(id)}/df`),
  net: (id: string) =>
    apiFetch<SshNetworkResponse>(`/connections/${enc(id)}/net`),

  // ---- files ----
  ls: (id: string, path: string) =>
    apiFetch<SshLsResponse>(`/connections/${enc(id)}/ls?path=${enc(path)}`),
  mkdir: (id: string, path: string) =>
    apiFetch<void>(`/connections/${enc(id)}/mkdir`, jsonInit("POST", { path })),
  rm: (id: string, path: string) =>
    apiFetch<void>(`/connections/${enc(id)}/rm`, jsonInit("POST", { path })),
  rename: (id: string, from: string, to: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/rename`,
      jsonInit("POST", { from, to }),
    ),
  mv: (id: string, from: string, toDir: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/mv`,
      jsonInit("POST", { from, toDir }),
    ),
  readFile: (id: string, path: string) =>
    apiFetch<SshFileContentResponse>(
      `/connections/${enc(id)}/read-file`,
      jsonInit("POST", { path }),
    ),
  writeFile: (id: string, path: string, content: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/write-file`,
      jsonInit("POST", { path, content }),
    ),
  downloadUrl: (id: string, path: string) =>
    httpUrl(`/connections/${enc(id)}/download?path=${enc(path)}`),
  upload: async (id: string, dir: string, file: File): Promise<void> => {
    const form = new FormData();
    form.append("file", file);
    const url = httpUrl(
      `/connections/${enc(id)}/upload?path=${enc(dir)}&filename=${enc(file.name)}`,
    );
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as ApiEnvelope<void>) : undefined;
    if (!res.ok)
      throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
    if (!json?.success) throw new Error(json?.error ?? "upload failed");
  },

  // ---- docker ----
  dockerPs: (id: string) =>
    apiFetch<SshDockerPsResponse>(`/connections/${enc(id)}/docker/ps`),
  dockerStart: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/start`,
      jsonInit("POST", { containerId }),
    ),
  dockerStop: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/stop`,
      jsonInit("POST", { containerId }),
    ),
  dockerRestart: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/restart`,
      jsonInit("POST", { containerId }),
    ),
  dockerPause: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/pause`,
      jsonInit("POST", { containerId }),
    ),
  dockerUnpause: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/unpause`,
      jsonInit("POST", { containerId }),
    ),
  dockerRm: (id: string, containerId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/rm`,
      jsonInit("POST", { containerId }),
    ),
  dockerLogs: (id: string, containerId: string, tail?: number) =>
    apiFetch<SshDockerLogsResponse>(
      `/connections/${enc(id)}/docker/logs`,
      jsonInit("POST", { containerId, tail }),
    ),
  dockerImages: (id: string) =>
    apiFetch<SshDockerImagesResponse>(`/connections/${enc(id)}/docker/images`),
  dockerRmi: (id: string, imageId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/rmi`,
      jsonInit("POST", { imageId }),
    ),
  dockerNetworks: (id: string) =>
    apiFetch<SshDockerNetworksResponse>(
      `/connections/${enc(id)}/docker/networks`,
    ),
  dockerNetworkRm: (id: string, networkId: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/network-rm`,
      jsonInit("POST", { networkId }),
    ),
  dockerVolumes: (id: string) =>
    apiFetch<SshDockerVolumesResponse>(
      `/connections/${enc(id)}/docker/volumes`,
    ),
  dockerVolumeRm: (id: string, volumeName: string) =>
    apiFetch<void>(
      `/connections/${enc(id)}/docker/volume-rm`,
      jsonInit("POST", { volumeName }),
    ),
  dockerInspect: (id: string, containerId: string) =>
    apiFetch<SshDockerInspectResponse>(
      `/connections/${enc(id)}/docker/inspect?containerId=${enc(containerId)}`,
    ),
  dockerStats: (id: string) =>
    apiFetch<SshDockerStatsResponse>(`/connections/${enc(id)}/docker/stats`),
  dockerPruneImages: (id: string) =>
    apiFetch<SshDockerPruneResponse>(
      `/connections/${enc(id)}/docker/prune-images`,
      { method: "POST" },
    ),
  dockerPruneVolumes: (id: string) =>
    apiFetch<SshDockerPruneResponse>(
      `/connections/${enc(id)}/docker/prune-volumes`,
      { method: "POST" },
    ),
  dockerPruneNetworks: (id: string) =>
    apiFetch<SshDockerPruneResponse>(
      `/connections/${enc(id)}/docker/prune-networks`,
      { method: "POST" },
    ),
  dockerPruneSystem: (id: string) =>
    apiFetch<SshDockerPruneResponse>(
      `/connections/${enc(id)}/docker/prune-system`,
      { method: "POST" },
    ),
};
