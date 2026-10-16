"use client";

/**
 * 코드 보기 (quality-tuning Q3).
 *
 * 파일 하나를 읽기 전용으로 보여 줍니다. 위쪽 띠에 파일 이름 · 줄 바꿈 ·
 * 복사, .md 파일이면 원문 보기. 줄 번호는 줄마다 한 칸씩 붙어 있어서
 * 줄 바꿈을 켜도 번호와 줄이 어긋나지 않습니다.
 *
 * .md는 처음에 읽기 좋게 펼쳐서 보여 줍니다(HANDOFF_PROMPT.md를 옆으로
 * 밀지 않고 읽을 수 있게). 채팅 답장과 같은 렌더러라 HTML은 글자로만
 * 나오고, 안전한 주소만 링크가 됩니다.
 */

import { useState } from "react";

import ChatMarkdown from "@/app/components/ChatMarkdown";

import { CopyButton } from "./HandoffSheet";
import styles from "./code-view.module.css";

/**
 * 코드에 색을 입힙니다 — 화면용 장식일 뿐, 코드를 바꾸지 않습니다.
 *
 * 문법을 제대로 읽는 편집기(Monaco)는 Phase 3 이후입니다. 그때까지는
 * 예약어, 문자열, JSX 태그, 주석 네 가지만 색으로 구분합니다. 줄마다
 * 따로 칠하므로 여러 줄에 걸친 문자열은 첫 줄만 색이 들어갑니다.
 */
const TOKEN_PATTERN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.]*)|\b(import|from|export|default|function|const|let|var|return|if|else|type|interface|async|await|new|extends)\b/g;

function highlight(code: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(code.slice(last, start));
    const className = match[1]
      ? styles.tokComment
      : match[2]
        ? styles.tokString
        : match[3]
          ? styles.tokTag
          : styles.tokKeyword;
    nodes.push(
      <span className={className} key={start}>
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}

/** 글로 읽는 파일 — 처음부터 줄 바꿈을 켭니다. */
export function isProse(path: string): boolean {
  return /\.(md|txt)$/i.test(path);
}

function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

interface Props {
  path: string;
  content: string;
}

export default function CodeView({ path, content }: Props) {
  // 파일마다 회원이 고른 값을 기억하고, 고른 적이 없으면 종류에 맞는 기본값.
  const [wrapChoice, setWrapChoice] = useState<Record<string, boolean>>({});
  const [rawChoice, setRawChoice] = useState<Record<string, boolean>>({});
  const wrap = wrapChoice[path] ?? isProse(path);
  const markdown = isMarkdown(path);
  const rendered = markdown && !rawChoice[path];
  const lines = content.split("\n");

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.path} title={path}>
          {path}
        </span>
        <span className={styles.spacer} />
        {markdown && (
          <button
            className="btn btn-sm"
            type="button"
            aria-pressed={!rendered}
            onClick={() => setRawChoice((map) => ({ ...map, [path]: rendered }))}
          >
            원문 보기
          </button>
        )}
        {!rendered && (
          <button
            className="btn btn-sm"
            type="button"
            role="switch"
            aria-checked={wrap}
            onClick={() => setWrapChoice((map) => ({ ...map, [path]: !wrap }))}
            title={wrap ? "긴 줄을 한 줄로 두고 옆으로 밀어서 봐요" : "긴 줄을 칸 안에서 접어서 봐요"}
          >
            줄 바꿈 {wrap ? "켬" : "끔"}
          </button>
        )}
        <CopyButton text={content} label={path} />
      </div>

      <div className={styles.scroll} tabIndex={0} aria-label={`${path} 내용`}>
        {rendered ? (
          <div className={styles.markdown} data-testid="code-markdown">
            <ChatMarkdown text={content} />
          </div>
        ) : (
          <div
            className={`${styles.code} ${wrap ? styles.wrap : ""}`}
            role="presentation"
            data-testid="code-lines"
          >
            {lines.map((line, index) => (
              <div className={styles.line} key={index}>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <code className={styles.text}>{line === "" ? "\n" : highlight(line)}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
