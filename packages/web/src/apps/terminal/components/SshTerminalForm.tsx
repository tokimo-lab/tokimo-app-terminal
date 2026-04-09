import { Button, Input, Select } from "@tokiomo/components";
import { type FormEvent, useState } from "react";
import type {
  CreateSshTerminalInput,
  SshTerminalOutput,
  UpdateSshTerminalInput,
} from "@/generated/rust-api";

interface SshTerminalFormProps {
  terminal: SshTerminalOutput | null;
  /** 复制模式：预填初始值（仅在 terminal=null 时生效） */
  defaultValues?: Partial<
    Pick<
      SshTerminalOutput,
      | "name"
      | "host"
      | "port"
      | "username"
      | "authMethod"
      | "startupCommand"
      | "notes"
    >
  >;
  onSubmit: (data: CreateSshTerminalInput | UpdateSshTerminalInput) => void;
  onCancel?: () => void;
  isLoading: boolean;
}

const AUTH_METHODS = [
  { value: "password", label: "密码认证" },
  { value: "private_key", label: "密钥认证" },
];

export default function SshTerminalForm({
  terminal,
  defaultValues,
  onSubmit,
  onCancel,
  isLoading,
}: SshTerminalFormProps) {
  const [name, setName] = useState(terminal?.name ?? defaultValues?.name ?? "");
  const [host, setHost] = useState(terminal?.host ?? defaultValues?.host ?? "");
  const [port, setPort] = useState(
    String(terminal?.port ?? defaultValues?.port ?? 22),
  );
  const [username, setUsername] = useState(
    terminal?.username ?? defaultValues?.username ?? "root",
  );
  const [authMethod, setAuthMethod] = useState(
    terminal?.authMethod ?? defaultValues?.authMethod ?? "password",
  );
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [startupCommand, setStartupCommand] = useState(
    terminal?.startupCommand ?? defaultValues?.startupCommand ?? "",
  );
  const [notes, setNotes] = useState(
    terminal?.notes ?? defaultValues?.notes ?? "",
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (terminal) {
      const data: UpdateSshTerminalInput = {
        id: terminal.id,
        name: name || undefined,
        host: host || undefined,
        port: port ? Number(port) : undefined,
        username: username || undefined,
        authMethod,
        startupCommand: startupCommand || undefined,
        notes: notes || undefined,
      };
      if (password) data.password = password;
      if (privateKey) data.privateKey = privateKey;
      if (passphrase) data.passphrase = passphrase;
      onSubmit(data);
    } else {
      const data: CreateSshTerminalInput = {
        name,
        host,
        port: Number(port) || 22,
        username,
        authMethod,
        startupCommand: startupCommand || undefined,
        notes: notes || undefined,
      };
      if (authMethod === "password") {
        data.password = password;
      } else {
        data.privateKey = privateKey;
        if (passphrase) data.passphrase = passphrase;
      }
      onSubmit(data);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-1">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">名称</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如: 生产服务器"
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">主机</span>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="IP 或域名"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">端口</span>
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="22"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">用户名</span>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">认证方式</span>
        <Select
          value={authMethod}
          onChange={(val) => setAuthMethod(val)}
          options={AUTH_METHODS}
        />
      </div>

      {authMethod === "password" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">
            密码{terminal ? "（留空则不修改）" : ""}
          </span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required={!terminal}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-muted">
              私钥{terminal ? "（留空则不修改）" : ""}
            </span>
            <Input.TextArea
              rows={4}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              required={!terminal}
              className="font-mono resize-y"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-muted">私钥密码（可选）</span>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="私钥密码"
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">启动命令（可选）</span>
        <Input
          value={startupCommand}
          onChange={(e) => setStartupCommand(e.target.value)}
          placeholder="登录后自动执行的命令"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">备注（可选）</span>
        <textarea
          className="w-full rounded-lg border border-border-base bg-transparent px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-[var(--accent)] focus:outline-none resize-y"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="备注信息"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button htmlType="button" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button htmlType="submit" variant="primary" disabled={isLoading}>
          {isLoading ? "保存中..." : terminal ? "更新" : "创建"}
        </Button>
      </div>
    </form>
  );
}
