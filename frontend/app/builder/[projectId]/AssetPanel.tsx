"use client";

/**
 * 앱에 넣은 사진 (builder-images (2)) — 로고나 가게 사진처럼 앱이 보여 줄 사진.
 *
 * 올리면 `images/이름.png`로 들어가고 미리보기가 바로 다시 만들어져요.
 * Claude는 만들기 / 고치기 때마다 이 사진들의 경로를 알고 앱에 넣을 수
 * 있어요. 경로 복사 단추로 직접 쓸 수도 있어요. 게시와 ZIP에도 함께 가요.
 */

import { Check, Copy, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/http";
import { MAX_ASSETS, assetUrl, deleteAsset, listAssets, uploadAsset, type BuilderAsset } from "@/lib/projects";

import styles from "./references.module.css";

interface Props {
  projectId: number | string;
  disabled: boolean;
  /** 사진이 바뀌면 — 미리보기를 다시 읽으라는 신호. */
  onChange?: () => void;
}

export default function AssetPanel({ projectId, disabled, onChange }: Props) {
  const [items, setItems] = useState<BuilderAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listAssets(projectId)
      .then(setItems)
      .catch(() => undefined);
  }, [projectId]);

  const add = useCallback(
    async (files: File[]) => {
      setError(null);
      setBusy(true);
      try {
        for (const file of files) {
          const row = await uploadAsset(projectId, file, file.name);
          setItems((list) => [...list, row].sort((a, b) => a.path.localeCompare(b.path)));
        }
        onChange?.();
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusy(false);
      }
    },
    [projectId, onChange],
  );

  const remove = async (row: BuilderAsset) => {
    setError(null);
    try {
      await deleteAsset(projectId, row.id);
      setItems((list) => list.filter((item) => item.id !== row.id));
      onChange?.();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const copy = async (row: BuilderAsset) => {
    try {
      await navigator.clipboard.writeText(row.path);
      setCopied(row.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* 복사를 못 해도 경로는 보입니다 */
    }
  };

  return (
    <div className={styles.assets} data-testid="asset-panel">
      <div className={styles.assetsHead}>
        <span>앱에 넣은 사진</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) void add(files);
          }}
        />
        <button
          type="button"
          className={styles.add}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy || items.length >= MAX_ASSETS}
          title={items.length >= MAX_ASSETS ? `사진은 ${MAX_ASSETS}장까지` : "로고나 사진을 앱에 넣기"}
        >
          {busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <ImagePlus size={13} aria-hidden="true" />} 사진 넣기
        </button>
      </div>
      {items.length === 0 ? (
        <p className={styles.note}>로고나 사진을 넣으면 Claude가 앱에 쓸 수 있어요.</p>
      ) : (
        <ul className={styles.assetList} aria-label="앱에 넣은 사진">
          {items.map((row) => (
            <li key={row.id} className={styles.assetRow}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 작은 사진 */}
              <img src={assetUrl(projectId, row.id)} alt="" className={styles.assetThumb} />
              <span className={styles.assetPath} title={`${row.path} · ${row.width}×${row.height}`}>
                {row.path}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void copy(row)}
                aria-label={`${row.path} 경로 복사`}
                title="경로 복사"
              >
                {copied === row.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void remove(row)}
                disabled={disabled}
                aria-label={`${row.path} 빼기`}
                title="빼기"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
