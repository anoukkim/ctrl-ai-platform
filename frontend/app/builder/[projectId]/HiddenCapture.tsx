"use client";

/**
 * 게시 직후 게시본의 썸네일을 찍는 숨은 프레임 (ui-improvements, owner-polish 4).
 *
 * 게시된 앱의 공개 주소를 화면 밖 1024×640 프레임에 한 번 띄우고, 셸에
 * 사진을 부탁해 `onImage`로 넘긴 뒤 사라집니다. 만든 사람의 브라우저에서,
 * 그 사람이 게시한 직후에만 — 서버는 회원 코드를 실행하지 않습니다.
 * 실패해도 조용합니다: 카드는 표지를 그리고, 미리보기의 "썸네일 다시
 * 찍기"가 남아 있습니다.
 */

import { useEffect, useRef } from "react";

import { RUNTIME_SANDBOX } from "@/lib/static-preview";
import { captureFrame, originOf } from "@/lib/thumbnail-capture";

import { CAPTURE_DELAY_MS } from "./PreviewPane";
import styles from "./workspace.module.css";

interface Props {
  url: string;
  onImage: (image: Blob) => Promise<void>;
  onDone: () => void;
}

export default function HiddenCapture({ url, onImage, onDone }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const loaded = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (done.current) return;
      done.current = true;
      const frame = frameRef.current;
      const origin = originOf(url);
      try {
        if (frame && origin) await onImage(await captureFrame(frame, origin));
      } catch {
        /* 조용히 — 카드는 표지로 남습니다 */
      } finally {
        onDone();
      }
    }, CAPTURE_DELAY_MS);
  };

  return (
    <iframe
      aria-hidden="true"
      className={styles.captureFrame}
      data-testid="hidden-capture"
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox={RUNTIME_SANDBOX}
      src={url}
      tabIndex={-1}
      title="게시본 썸네일 찍기"
      onLoad={loaded}
    />
  );
}
