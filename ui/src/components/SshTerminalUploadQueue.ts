/**
 * Upload queue handler hook for SSH terminal file uploads.
 * Returns upload queue state, upload handler, and active upload count.
 */

import { useCallback, useState } from "react";
import { terminalApi } from "../api/client";
import type { UploadItem, UploadQueue } from "./SshUploadQueue";

export interface UseUploadQueueResult {
  uploadQueue: UploadQueue;
  handleUploadFiles: (targetDir: string, files: File[]) => void;
  activeUploadCount: number;
}

export function useUploadQueue(terminalId: string): UseUploadQueueResult {
  const [uploadQueue, setUploadQueue] = useState<UploadQueue>([]);

  const handleUploadFiles = useCallback(
    (targetDir: string, files: File[]) => {
      // Enqueue all selected files
      const newItems: UploadItem[] = files.map((f) => ({
        id: crypto.randomUUID(),
        filename: f.name,
        size: f.size,
        loaded: 0,
        status: "pending",
      }));
      setUploadQueue((prev) => [...prev, ...newItems]);

      // Upload each file sequentially (not in parallel to avoid server overload)
      const uploadOne = async (item: UploadItem, file: File) => {
        // Mark as uploading
        setUploadQueue((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: "uploading" } : u,
          ),
        );

        try {
          // API adaptation: terminalApi.uploadUrl returns the URL string
          const url = terminalApi.uploadUrl(terminalId, targetDir, file.name);

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", url);
            xhr.withCredentials = true;

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                setUploadQueue((prev) =>
                  prev.map((u) =>
                    u.id === item.id ? { ...u, loaded: e.loaded } : u,
                  ),
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error("network error"));

            const formData = new FormData();
            formData.append("file", file);
            xhr.send(formData);
          });

          setUploadQueue((prev) =>
            prev.map((u) =>
              u.id === item.id ? { ...u, status: "done", loaded: u.size } : u,
            ),
          );
        } catch (err) {
          setUploadQueue((prev) =>
            prev.map((u) =>
              u.id === item.id
                ? {
                    ...u,
                    status: "error",
                    error: err instanceof Error ? err.message : "上传失败",
                  }
                : u,
            ),
          );
        }
      };

      // Run all uploads in parallel (XHR-based, non-blocking)
      for (let i = 0; i < newItems.length; i++) {
        uploadOne(newItems[i], files[i]);
      }
    },
    [terminalId],
  );

  /** Count of active (non-finished) uploads for the badge. */
  const activeUploadCount = uploadQueue.filter(
    (u) => u.status === "pending" || u.status === "uploading",
  ).length;

  return {
    uploadQueue,
    handleUploadFiles,
    activeUploadCount,
  };
}
