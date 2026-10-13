"use client";

/**
 * Chat 답장을 Markdown으로 그립니다 — 제목, 목록, 굵게, 링크, 표, 코드.
 *
 * 안전 규칙(chat-plus-rendering):
 * - **HTML은 그리지 않습니다.** 답장 속 `<script>`나 `<img onerror>`는
 *   글자 그대로 보입니다(`plainText`).
 * - 링크는 `http(s)`와 `mailto`만 남깁니다. 나머지(`javascript:` 등)는
 *   링크가 아닌 글자가 됩니다. 남은 링크는 새 탭에서 열립니다.
 * - 그림(`![...](...)`)은 불러오지 않고 설명 글자만 보여 줍니다. 답장이
 *   가리키는 바깥 서버에 회원의 접속 정보가 새지 않게 하려는 것입니다.
 *
 * 답장이 오는 중(`streaming`)에는 반쯤 온 코드 블록을 닫아서 코드로
 * 보여 주고, 머리줄만 온 표는 구분줄이 올 때까지 잠시 감춥니다 — 그래야
 * 백틱(```)이나 세로줄(|)이 화면에 번쩍이지 않습니다.
 *
 * 줄바꿈 하나도 줄바꿈으로 보여 줍니다. 이 항목 전의 답장은 "줄바꿈과 -
 * 목록만 쓰는 평문"이었으므로, 그렇게 저장된 답장도 예전처럼 읽힙니다.
 * `~` 하나는 취소선이 아닙니다 — "30~40분"처럼 범위를 쓰는 한국어가
 * 지워진 글자로 보이면 안 되기 때문입니다(`~~두 개~~`는 취소선).
 *
 * 대화의 다른 답장들은 새 조각이 올 때마다 다시 그리지 않습니다(`memo`).
 */

import { Check, Copy } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./ChatMarkdown.module.css";

/** 링크로 남겨 두는 주소의 시작. 대소문자는 가리지 않습니다. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** 허용하지 않는 주소는 빈 문자열이 되고, 아래 `a`가 글자로 바꿉니다. */
export function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url : "";
}

/** 백틱 울타리. 여는 줄의 정보(언어 이름)에는 백틱이 들어갈 수 없습니다. */
const BACKTICK_FENCE = /^ {0,3}(`{3,})([^`]*)$/;
const TILDE_FENCE = /^ {0,3}(~{3,})(.*)$/;
/** 아직 다 오지 않은 울타리 줄 — 백틱 한두 개, 또는 정보 없는 울타리만. */
const PARTIAL_FENCE = /^ {0,3}(`{1,2}|`{3,}|~{3,})$/;
/** 표의 구분줄 — `| --- | :---: |` 처럼 생긴 줄. */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function fence(line: string): { marker: string; info: string } | null {
  const match = BACKTICK_FENCE.exec(line) ?? TILDE_FENCE.exec(line);
  return match ? { marker: match[1], info: match[2].trim() } : null;
}

/**
 * 오는 중인 답장을 그리기 좋게 다듬습니다.
 *
 * 1. 마지막 줄이 반쯤 온 울타리(백틱 한두 개 등)면 다음 조각이 올 때까지
 *    빼 둡니다.
 * 2. 열린 코드 블록이 있으면 끝에 닫는 줄을 붙입니다. 닫는 줄은 같은
 *    글자로, 여는 줄 이상 길이로, 뒤에 아무것도 없어야 합니다.
 * 3. 끝에 `|`로 시작하는 줄이 있는데 아직 구분줄이 다 오지 않았으면 그
 *    줄들을 잠시 빼 둡니다. 다음 조각이 오면 표로 나타납니다.
 */
export function prepareStreaming(full: string): string {
  let text = full;
  let lines = text.split("\n");
  if (!text.endsWith("\n") && PARTIAL_FENCE.test(lines[lines.length - 1])) {
    lines = lines.slice(0, -1);
    text = lines.join("\n");
  }

  let open: string | null = null;
  for (const line of lines) {
    const found = fence(line);
    if (!found) continue;
    if (open === null) open = found.marker;
    else if (
      found.marker[0] === open[0] &&
      found.marker.length >= open.length &&
      found.info === ""
    )
      open = null;
  }
  if (open !== null) return `${text}\n${open}`;

  const endsWithNewline = text.endsWith("\n");
  const body = endsWithNewline ? lines.slice(0, -1) : lines;
  let start = body.length;
  while (start > 0 && body[start - 1].trimStart().startsWith("|")) start -= 1;
  const block = body.slice(start);
  if (block.length === 0) return text;

  const delimiterDone =
    block.length >= 3 || (block.length === 2 && endsWithNewline && DELIMITER_ROW.test(block[1]));
  if (delimiterDone) return text;
  // 두 번째 줄이 구분줄이 될 수 없는 모양이면 표가 아니라 그냥 글입니다.
  if (block.length === 2 && !/^[\s|:-]*$/.test(block[1])) return text;
  return body.slice(0, start).join("\n");
}

type Node = { type: string; value?: string; children?: Node[] };

/** 흐름(문단이 놓이는 자리)을 담는 마디. 여기 있는 HTML은 문단으로 감쌉니다. */
const FLOW = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

/**
 * remark 플러그인 두 가지를 한 번에 합니다.
 *
 * - HTML 마디를 글자 마디로 바꿉니다. react-markdown도 HTML을 글자로
 *   남기지만 문단 밖에 맨 글자로 남기므로, 여기서 먼저 문단으로 감쌉니다.
 * - 글자 속 줄바꿈 하나를 줄바꿈(`<br>`)으로 바꿉니다. 코드는 글자 마디가
 *   아니므로 건드리지 않습니다.
 */
function plainText() {
  const walk = (parent: Node) => {
    parent.children = parent.children?.flatMap((child): Node[] => {
      if (child.type === "html") {
        const text: Node = { type: "text", value: child.value ?? "" };
        const node = FLOW.has(parent.type) ? { type: "paragraph", children: [text] } : text;
        walk(node);
        return [node];
      }
      if (child.type === "text" && child.value?.includes("\n")) {
        return child.value
          .split("\n")
          .flatMap((part, index): Node[] =>
            index === 0 ? [{ type: "text", value: part }] : [{ type: "break" }, { type: "text", value: part }],
          );
      }
      walk(child);
      return [child];
    });
  };
  return (tree: Node) => walk(tree);
}

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** 코드 블록 — 언어 이름과 **복사** 단추. 색 입히기는 하지 않습니다. */
function CodeBlock({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const code = node?.children?.find((child) => child.tagName === "code");
  const classes = code?.properties?.className;
  const language =
    (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length) ?? "";
  // 블록 끝의 줄바꿈 하나는 Markdown이 붙인 것이라 복사하지 않습니다.
  const text = textOf(code).replace(/\n$/, "");

  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    // 복사가 끝나기 전에 답장이 사라졌으면 아무것도 하지 않습니다.
    if (!mounted.current) return;
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span className={styles.codeLanguage}>{language || "코드"}</span>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {state === "copied" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
          <span aria-live="polite">
            {state === "copied" ? "복사됨" : state === "failed" ? "복사하지 못했어요" : "복사"}
          </span>
        </button>
      </div>
      <pre className={styles.pre}>{children}</pre>
    </div>
  );
}

const COMPONENTS: Components = {
  a({ href, children }) {
    if (!href) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img({ alt }) {
    return alt ? <span className={styles.imageAlt}>[그림: {alt}]</span> : null;
  },
  table({ children }) {
    return (
      <div className={styles.tableWrap}>
        <table>{children}</table>
      </div>
    );
  },
  pre({ node, children }) {
    return <CodeBlock node={node as HastNode | undefined}>{children}</CodeBlock>;
  },
};

const REMARK_PLUGINS: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }], plainText];

interface ChatMarkdownProps {
  text: string;
  /** 답장이 아직 오는 중이면 true. 반쯤 온 코드와 표를 다듬습니다. */
  streaming?: boolean;
  /** 마지막 글자 바로 뒤에 붙일 것 — 답장을 쓰는 중임을 알리는 깜빡이. */
  tail?: ReactNode;
}

function ChatMarkdown({ text, streaming = false, tail }: ChatMarkdownProps) {
  return (
    <div className={`${styles.markdown} ${tail ? styles.withTail : ""}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={safeUrl}
        components={COMPONENTS}
      >
        {streaming ? prepareStreaming(text) : text}
      </ReactMarkdown>
      {tail}
    </div>
  );
}

export default memo(ChatMarkdown);
