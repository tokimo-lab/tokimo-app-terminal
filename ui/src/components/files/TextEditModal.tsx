import { Button, Modal, Spin } from "@tokimo/ui";
import { useEffect, useState } from "react";
import { terminalApi } from "../../api/client";

interface TextEditModalProps {
  terminalId: string;
  /** Full remote path of the file to edit, or null when closed. */
  filePath: string | null;
  onClose: () => void;
  onError: (message: string) => void;
  onSaved: () => void;
}

/** Inline text editor fallback: read a remote file into a textarea and save. */
export function TextEditModal({
  terminalId,
  filePath,
  onClose,
  onError,
  onSaved,
}: TextEditModalProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setLoading(true);
    setContent("");
    terminalApi
      .readFile(terminalId, filePath)
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : String(err));
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [terminalId, filePath, onClose, onError]);

  const save = async () => {
    if (!filePath) return;
    setSaving(true);
    try {
      await terminalApi.writeFile(terminalId, filePath, content);
      onSaved();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={filePath !== null}
      onCancel={onClose}
      title={filePath ?? "Edit"}
      footer={null}
      width={720}
    >
      {loading ? (
        <div className="flex h-72 items-center justify-center">
          <Spin />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-72 w-full resize-none rounded border border-white/10 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="primary"
              loading={saving}
              onClick={save}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
