"use client";

/**
 * 답장의 출처 (fix-real-web-search).
 *
 * 주소가 같은 것은 하나로, 본문이 인용한 것이 먼저, 이름은 페이지 제목
 * (없으면 도메인). 처음에는 8개까지만 보이고 나머지는 "더 보기"로 펼칩니다
 * — 검색 다섯 번이면 결과가 수십 개라, 다 늘어놓으면 답장보다 길어집니다.
 */

import { useState } from "react";

import { SOURCES_VISIBLE, tidySources, type ReplySource } from "@/lib/chat";

import styles from "./ChatWorkspace.module.css";

export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function ReplySources({ sources }: { sources: ReplySource[] }) {
  const [open, setOpen] = useState(false);
  const tidy = tidySources(sources);
  if (tidy.length === 0) return null;
  const shown = open ? tidy : tidy.slice(0, SOURCES_VISIBLE);
  const hidden = tidy.length - shown.length;

  return (
    <div className={styles.sourcesBox}>
      <p className={styles.sourcesTitle}>출처</p>
      <ol className={styles.sources} data-testid="sources">
        {shown.map((source, order) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.url}
            >
              <span className={styles.sourceNumber}>{order + 1}.</span>{" "}
              {source.title.trim() || sourceDomain(source.url)}
              {source.title.trim() && (
                <span className={styles.sourceDomain}> · {sourceDomain(source.url)}</span>
              )}
            </a>
          </li>
        ))}
      </ol>
      {(hidden > 0 || open) && tidy.length > SOURCES_VISIBLE && (
        <button
          className={styles.sourcesMore}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "접기" : `더 보기 (${hidden}개)`}
        </button>
      )}
    </div>
  );
}
