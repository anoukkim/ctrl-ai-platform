"use client";

/** 결과물 패널의 상태 (chat-artifact-panel) — 카드(ArtifactPreview)와 패널이 함께 씁니다. */

import { createContext, useContext } from "react";

import type { ArtifactContextValue } from "./ArtifactPreview";

/** 패널에 열린 결과물 — 카드가 누를 때의 답장 사정을 함께 넘깁니다. */
export interface OpenArtifact {
  code: string;
  language: "html" | "svg";
  title: string;
  context: ArtifactContextValue;
}

export interface ArtifactPanelValue {
  current: OpenArtifact | null;
  open: (artifact: OpenArtifact) => void;
  close: () => void;
}

/** ChatWorkspace만 줍니다. 없으면 카드는 예전처럼 대화 안에서 미리보기합니다. */
export const ArtifactPanelContext = createContext<ArtifactPanelValue | null>(null);

export function useArtifactPanel(): ArtifactPanelValue | null {
  return useContext(ArtifactPanelContext);
}

/** 카드와 패널의 이름: 페이지의 `<title>`, 없으면 첫 `<h1>`, 없으면 종류. */
export function artifactTitle(code: string, language: "html" | "svg"): string {
  const found =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(code)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(code)?.[1] ?? "";
  const text = found
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return language === "svg" ? "그림" : "웹 페이지";
}
