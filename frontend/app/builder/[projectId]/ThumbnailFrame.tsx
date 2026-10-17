"use client";

/**
 * 썸네일 틀 (thumbnail-choice) — 미리보기 위의 16:10 상자.
 *
 * 틀 밖은 살짝 어두워지고, 앱은 그대로 움직여요: 틀 층은 클릭을 모두 앱으로
 * 넘기고, 위의 「옮기기」 띠와 오른쪽 아래 손잡이만 포인터를 받아요(키보드:
 * 화살표로 옮기기, Shift+화살표로 크기). 「이 화면으로」는 브라우저의 화면
 * 찍기로 이 탭을 한 장 받고 공유를 바로 멈춘 뒤 틀 안만 잘라 올려요 — 틀과
 * 단추는 찍는 순간 숨겨요. 찍을 수 없으면 사진 올리기/붙여넣기를 권해요.
 */

import { Loader2, Move } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { describeError } from "@/lib/http";
import { RegionCaptureError, captureRegion, regionCaptureSupported } from "@/lib/region-capture";

import styles from "./thumbnail-choice.module.css";

/** 썸네일 비율 — 카드와 같아요. */
export const RATIO = 16 / 10;
export const MIN_WIDTH = 160;
const STEP = 10;

export interface FrameBox {
  x: number;
  y: number;
  width: number;
}

/** 상자를 칸 안에 두고 16:10을 지켜요. */
export function clampBox(box: FrameBox, area: { width: number; height: number }): FrameBox {
  const maxWidth = Math.max(MIN_WIDTH, Math.min(area.width, area.height * RATIO));
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, box.width));
  const height = width / RATIO;
  const x = Math.min(Math.max(0, box.x), Math.max(0, area.width - width));
  const y = Math.min(Math.max(0, box.y), Math.max(0, area.height - height));
  return { x, y, width };
}

/** 처음 뜰 때: 가운데, 칸의 60% 너비(세로가 모자라면 줄여서). */
export function initialBox(area: { width: number; height: number }): FrameBox {
  const width = Math.min(area.width * 0.6, area.height * 0.8 * RATIO);
  return clampBox({ x: (area.width - width) / 2, y: (area.height - width / RATIO) / 2, width }, area);
}

/** A text field, a text area or anything editable takes its own paste. */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

interface Props {
  onShot: (image: Blob) => Promise<void>;
  onFile: (image: Blob) => Promise<void>;
  onCancel: () => void;
}

export default function ThumbnailFrame({ onShot, onFile, onCancel }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<FrameBox | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(() => !regionCaptureSupported());
  const drag = useRef<{ kind: "move" | "size"; startX: number; startY: number; from: FrameBox } | null>(null);

  // 칸의 크기를 따라가요 (창 크기, 크게 보기).
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const measure = () => {
      const next = { width: layer.clientWidth, height: layer.clientHeight };
      setArea(next);
      setBox((current) => (current ? clampBox(current, next) : next.width > 0 ? initialBox(next) : null));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(layer);
    return () => observer?.disconnect();
  }, []);

  // Esc로 닫고, 틀이 떠 있는 동안 ⌘V로 붙여 넣은 사진도 받아요.
  const sendFile = useCallback(
    async (image: Blob) => {
      setError(null);
      setBusy(true);
      try {
        await onFile(image);
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusy(false);
      }
    },
    [onFile],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc meant for a dialog (or a field that handled it) is not ours.
      if (event.key !== "Escape" || busy || event.defaultPrevented) return;
      if (document.querySelector("[role='dialog'], dialog[open]")) return;
      onCancel();
    };
    const onPaste = (event: ClipboardEvent) => {
      // A picture pasted into the request box is a 참고 사진, not the thumbnail.
      if (event.defaultPrevented || editable(event.target)) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void sendFile(file);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [busy, onCancel, sendFile]);

  const start = (kind: "move" | "size", event: React.PointerEvent<HTMLElement>) => {
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { kind, startX: event.clientX, startY: event.clientY, from: box };
  };
  const moveTo = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const from = current.from;
    setBox(
      clampBox(
        current.kind === "move"
          ? { ...from, x: from.x + dx, y: from.y + dy }
          : { ...from, width: from.width + Math.max(dx, dy * RATIO) },
        area,
      ),
    );
  };
  const end = () => {
    drag.current = null;
  };
  const keys = (kind: "move" | "size", event: React.KeyboardEvent<HTMLElement>) => {
    if (!box) return;
    const delta = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[
      event.key
    ] as [number, number] | undefined;
    if (!delta) return;
    event.preventDefault();
    const resize = kind === "size" || event.shiftKey;
    setBox(
      clampBox(
        resize
          ? { ...box, width: box.width + (delta[0] || delta[1] * RATIO) }
          : { ...box, x: box.x + delta[0], y: box.y + delta[1] },
        area,
      ),
    );
  };

  const shoot = async () => {
    const frame = frameRef.current;
    if (!frame) return;
    setError(null);
    setBusy(true);
    try {
      const image = await captureRegion(
        () => {
          // 테두리 안쪽만 — 틀의 선은 그림에 들어가지 않아요.
          const rect = frame.getBoundingClientRect();
          const border = 2;
          return {
            left: rect.left + border,
            top: rect.top + border,
            width: rect.width - border * 2,
            height: rect.height - border * 2,
          };
        },
        async () => {
          setHidden(true);
          // 숨긴 화면이 그려질 때까지 두 프레임.
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        },
      );
      setHidden(false);
      await onShot(image);
    } catch (caught) {
      setHidden(false);
      if (caught instanceof RegionCaptureError) {
        setError(`${caught.message} 스크린샷을 올리거나 ⌘V로 붙여 넣어도 돼요.`);
        // A cancelled picker may be tried again; a browser that cannot is not offered it again.
        if (caught.reason === "unsupported") setFallback(true);
      } else {
        setError(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const height = box ? box.width / RATIO : 0;
  return (
    <div ref={layerRef} className={`${styles.layer} ${hidden ? styles.layerHidden : ""}`} data-testid="thumbnail-frame">
      {box && (
        <div
          ref={frameRef}
          className={`${styles.frame} ${box.y < 28 ? styles.frameTop : ""}`}
          style={{ left: box.x, top: box.y, width: box.width, height }}
        >
          <button
            type="button"
            className={styles.move}
            aria-label="썸네일 틀 옮기기 (화살표, Shift+화살표로 크기)"
            onPointerDown={(event) => start("move", event)}
            onPointerMove={moveTo}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => keys("move", event)}
          >
            <Move size={12} aria-hidden="true" /> 옮기기
          </button>
          <button
            type="button"
            className={styles.grip}
            aria-label="썸네일 틀 크기 (화살표)"
            onPointerDown={(event) => start("size", event)}
            onPointerMove={moveTo}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => keys("size", event)}
          />
        </div>
      )}
      <div className={styles.bar} role="group" aria-label="썸네일 지정">
        <span className={styles.barText}>틀을 옮기고 크기를 맞춘 뒤</span>
        {!fallback && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void shoot()} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : null} 이 화면으로
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void sendFile(file);
          }}
        />
        <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          사진 올리기
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          취소
        </button>
        {error && (
          <p className={styles.barError} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
