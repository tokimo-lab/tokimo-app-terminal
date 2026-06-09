export interface SshTerminalOutput {
  id: string;
  fileSystemId?: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  startupCommand?: string | null;
  notes?: string | null;
  sortOrder: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSshTerminalInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  startupCommand?: string;
  notes?: string;
  sortOrder?: number;
}

export interface UpdateSshTerminalInput
  extends Partial<CreateSshTerminalInput> {
  id?: string;
  isEnabled?: boolean;
}

// ---- Files ----
export interface SshFileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mode?: string | null;
  owner?: string | null;
  group?: string | null;
  modifiedAt?: string | null;
}

export interface SshLsResponse {
  path: string;
  entries: SshFileEntry[];
}

export interface SshFileContentResponse {
  path: string;
  content: string;
}

// ---- System ----
export interface SshHostStats {
  cpuUsagePercent: number;
  memTotalBytes: number;
  memUsedBytes: number;
  memAvailableBytes: number;
  memUsagePercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  memBuffersBytes: number;
  memCachedBytes: number;
}

export interface SshProcessEntry {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vszKb: number;
  rssKb: number;
  stat: string;
  command: string;
}

export interface SshPsResponse {
  processes: SshProcessEntry[];
}

export interface SshDiskEntry {
  filesystem: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface SshDfResponse {
  disks: SshDiskEntry[];
}

// ---- Network ----
export interface SshNetworkInterfaceEntry {
  name: string;
  ipAddresses: string[];
  macAddress: string;
  isUp: boolean;
  mtu?: number | null;
  rxBytes: number;
  txBytes: number;
}

export interface SshListeningSocketEntry {
  protocol: string;
  localAddress: string;
  peerAddress: string;
  state: string;
  process: string;
}

export interface SshConnectionEntry {
  protocol: string;
  localAddress: string;
  peerAddress: string;
  state: string;
  process: string;
}

export interface SshRouteEntry {
  destination: string;
  gateway: string;
  iface: string;
  protocol: string;
  scope: string;
  metric: string;
}

export interface SshNetworkResponse {
  interfaces: SshNetworkInterfaceEntry[];
  listening: SshListeningSocketEntry[];
  connections: SshConnectionEntry[];
  routes: SshRouteEntry[];
}

// ---- Docker ----
export interface DockerContainerEntry {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdTs: number;
  ports: string;
}

export interface SshDockerPsResponse {
  available: boolean;
  containers: DockerContainerEntry[];
}

export interface DockerImageEntry {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface SshDockerImagesResponse {
  images: DockerImageEntry[];
}

export interface DockerNetworkEntry {
  id: string;
  name: string;
  driver: string;
  scope: string;
  ipamSubnet: string;
  ipamGateway: string;
}

export interface SshDockerNetworksResponse {
  networks: DockerNetworkEntry[];
}

export interface DockerVolumeEntry {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  created: string;
  size: string;
}

export interface SshDockerVolumesResponse {
  volumes: DockerVolumeEntry[];
}

export interface DockerMountEntry {
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
}

export interface DockerContainerNetwork {
  name: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
}

export interface DockerContainerInspect {
  id: string;
  name: string;
  image: string;
  state: string;
  pid: number;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  platform: string;
  env: string[];
  cmd: string;
  entrypoint: string;
  workingDir: string;
  hostname: string;
  networkMode: string;
  portBindings: string;
  mounts: DockerMountEntry[];
  networks: DockerContainerNetwork[];
}

export interface SshDockerInspectResponse {
  container: DockerContainerInspect;
}

export interface DockerStatsEntry {
  containerId: string;
  name: string;
  cpuPercent: string;
  memUsage: string;
  memLimit: string;
  memPercent: string;
  netIo: string;
  blockIo: string;
  pids: string;
}

export interface SshDockerStatsResponse {
  stats: DockerStatsEntry[];
}

export interface SshDockerLogsResponse {
  logs: string;
}

export interface SshDockerPruneResponse {
  output: string;
}
