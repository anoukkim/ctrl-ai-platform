"use client";

/**
 * 참고 사진 (builder-images (1)) — 만들기 / 고치기에 함께 보낼 사진.
 *
 * 📎로 고르거나, 요청 칸에 붙여 넣거나(Ctrl+V), 끌어다 놓으면 올라가고
 * 작은 그림으로 보입니다. 다음 계획이 이 사진들을 가져가서 Claude가 보고
 * 디자인(색, 배치, 글꼴, 간격)을 따라 해요 — 앱의 파일이 되지는 않아요.
 * 사진은 그 요청의 예상 비용에 들어가 있어요. 한 번에 3장까지.
 */

import { ImagePlus, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { describeError } from "@/lib/http";
import {
  MAX_REFERENCES,
  deleteReference,
  listReferences,
  referenceUrl,
  uploadReference,
  type BuilderReference,
} from "@/lib/projects";

import styles from "./references.module.css";

export interface ReferencePickerHandle {
  /** 붙여 넣기·끌어 놓기로 들어온 파일을 올립니다. 사진이 하나라도 있으면 true. */
  addFiles: (files: File[]) => boolean;
  /** 계획이 사진을 가져간 뒤 목록을 다시 읽습니다. */
  reload: () => void;
}

interface Props {
  projectId: number | string;
  disabled: boolean;
  /** 사진이 바뀌면 — 예상 비용을 다시 읽으라는 신호. */
  onChange?: () => void;
  ref?: React.Ref<ReferencePickerHandle>;
}

export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

export default function ReferencePicker({ projectId, disabled, onChange, ref }: Props) {
  const [items, setItems] = useState<BuilderReference[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    listReferences(projectId)
      .then(setItems)
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return false;
      setError(null);
      const room = MAX_REFERENCES - items.length - uploading;
      if (room <= 0) {
        setError(`참고 사진은 한 번에 ${MAX_REFERENCES}장까지 붙일 수 있어요.`);
        return true;
      }
      const taken = files.slice(0, room);
      if (files.length > room) setError(`참고 사진은 한 번에 ${MAX_REFERENCES}장까지 붙일 수 있어요.`);
      setUploading((count) => count + taken.length);
      void Promise.all(
        taken.map((file) =>
          uploadReference(projectId, file, file.name)
            .then((row) => setItems((list) => [...list, row]))
            .catch((caught: unknown) => setError(describeError(caught)))
            .finally(() => setUploading((count) => count - 1)),
        ),
      ).then(() => onChange?.());
      return true;
    },
    [items.length, uploading, projectId, onChange],
  );

  useImperativeHandle(ref, () => ({ addFiles, reload }), [addFiles, reload]);

  const remove = async (row: BuilderReference) => {
    setError(null);
    try {
      await deleteReference(projectId, row.id);
      setItems((list) => list.filter((item) => item.id !== row.id));
      onChange?.();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const full = items.length + uploading >= MAX_REFERENCES;

  return (
    <div className={styles.picker} data-testid="reference-picker">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          addFiles(imageFiles(event.target.files));
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={styles.add}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
        title={full ? `참고 사진은 ${MAX_REFERENCES}장까지` : "디자인 참고 사진 붙이기 (붙여 넣기도 돼요)"}
      >
        <ImagePlus size={14} aria-hidden="true" /> 참고 사진
      </button>
      {items.length > 0 && (
        <ul className={styles.list} aria-label="함께 보낼 참고 사진">
          {items.map((row) => (
            <li key={row.id} className={styles.item}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 작은 사진, 크기는 CSS가 정합니다 */}
              <img src={referenceUrl(projectId, row.id)} alt={row.original_name || "참고 사진"} className={styles.thumb} />
              <button
                type="button"
                className={styles.remove}
                onClick={() => void remove(row)}
                disabled={disabled}
                aria-label={`${row.original_name || "참고 사진"} 빼기`}
                title="빼기"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading > 0 && (
        <span className={styles.note} role="status">
          <Loader2 size={12} className="spin" aria-hidden="true" /> 올리는 중…
        </span>
      )}
      {items.length > 0 && uploading === 0 && (
        <span className={styles.note}>Claude가 보고 디자인을 따라 해요 · 예상 비용에 포함</span>
      )}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
