"use client";

/**
 * 버전 하나를 내려받는 단추 — 미리보기 머리글과 버전 줄이 같이 씁니다.
 *
 * 파일이 있는 버전이면 최종본이든 아니든 언제나 받을 수 있습니다. 링크로
 * 두는 것은 브라우저가 파일로 저장하게 하려는 것이고, 참여하지 않는
 * 분기에도 열려 있습니다 — 내가 만든 것을 꺼내 오는 길입니다. 권한은
 * 백엔드의 다운로드 경로가 그대로 지킵니다.
 *
 * 파일이 없는 버전(파일을 보관하기 전에 만든 것)은 흐린 단추로 남기고
 * 이유를 띄웁니다. 뒤늦게 파일을 만들어 주지 않습니다. `disabled` 대신
 * `aria-disabled`를 쓰는 것은, 꺼진 단추 위에서는 브라우저에 따라
 * 안내 문구(title)가 뜨지 않기 때문입니다.
 */

import { Download } from "lucide-react";

import { videoVersionDownloadUrl, type VideoVersion } from "@/lib/projects";

import styles from "./workspace.module.css";

export const NO_FILE_HINT = "파일이 없는 이전 버전입니다";

interface Props {
  projectId: string;
  version: VideoVersion;
  /** 머리글은 글자까지, 버전 줄은 아이콘만 보여 줍니다. */
  compact?: boolean;
}

export default function VersionDownload({ projectId, version, compact = false }: Props) {
  const label = `${version.label} 다운로드`;
  const className = compact ? styles.versionDownload : "btn btn-sm";

  if (!version.has_asset) {
    return (
      <button
        aria-disabled="true"
        aria-label={compact ? label : undefined}
        className={`${className} ${styles.downloadUnavailable}`}
        onClick={(event) => event.preventDefault()}
        title={NO_FILE_HINT}
        type="button"
      >
        <Download size={12} aria-hidden="true" />
        {!compact && " 다운로드"}
      </button>
    );
  }

  return (
    <a
      aria-label={compact ? label : undefined}
      className={className}
      download
      href={videoVersionDownloadUrl(projectId, version.id)}
      title={`${version.label}을(를) 파일로 내려받습니다`}
    >
      <Download size={12} aria-hidden="true" />
      {!compact && " 다운로드"}
    </a>
  );
}
