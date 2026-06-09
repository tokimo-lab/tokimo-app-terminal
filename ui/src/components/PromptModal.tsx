import { Button, Input, Modal } from "@tokimo/ui";
import { type FormEvent, useEffect, useState } from "react";

interface PromptModalProps {
  open: boolean;
  title: string;
  label?: string;
  defaultValue?: string;
  confirmText?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

/**
 * Small text-input modal built on @tokimo/ui primitives. Used for folder
 * creation and rename prompts (avoids the react-i18next dependency carried by
 * @tokimo/ui's NewFolderModal).
 */
export function PromptModal({
  open,
  title,
  label,
  defaultValue,
  confirmText,
  loading,
  onClose,
  onConfirm,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue ?? "");

  useEffect(() => {
    if (open) setValue(defaultValue ?? "");
  }, [open, defaultValue]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      footer={null}
      width={400}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {label ? <span className="text-xs text-tertiary">{label}</span> : null}
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          onFocus={(e) => e.target.select()}
        />
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="primary"
            htmlType="submit"
            loading={loading}
          >
            {confirmText ?? "OK"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
