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

export interface UpdateSshTerminalInput extends Partial<CreateSshTerminalInput> {
  isEnabled?: boolean;
}

export interface SshFileEntry {
  name: string;
  isDir: boolean;
  size?: number | null;
  modifiedAt?: string | null;
  mode?: string | null;
}

export interface SshLsResponse {
  path: string;
  entries: SshFileEntry[];
}

export interface SshFileContentResponse {
  path: string;
  content: string;
}

export interface SshProcessEntry {
  pid: number;
  user?: string;
  cpu?: number;
  mem?: number;
  command: string;
}

export interface SshPsResponse {
  processes: SshProcessEntry[];
}

export interface SshDfEntry {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usePercent: string;
  mountpoint: string;
}

export interface SshDfResponse {
  disks: SshDfEntry[];
}
