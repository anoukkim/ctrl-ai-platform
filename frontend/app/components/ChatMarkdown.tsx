"use client";

/**
 * Chat 답장을 Markdown으로 그립니다 — 제목, 목록, 굵게, 링크, 표, 코드.
 *
 * 안전 규칙(chat-plus-rendering):
 * - **HTML은 그리지 않습니다.** 답장 속 `<script>`나 `<img onerror>`는
 *   글자 그대로 보입니다(`htmlAsText`).
 * - 링크는 `http(s)`와 `mailto`만 남깁니다. 나머지(`javascript:` 등)는
 *   링크가 아닌 글자가 됩니다. 남은 링크는 새 탭에서 열립니다.
 * - 그림(`![...](...)`)은 불러오지 않고 설명 글자만 보여 줍니다. 답장이
 *   가리키는 바깥 서버에 회원의 접속 정보가 새지 않게 하려는 것입니다.
 *
 * 답장이 오는 중(`streaming`)에는 반쯤 온 코드 블록을 닫아서 코드로
 * 보여 주고, 머리줄만 온 표는 구분줄이 올 때까지 잠시 감춥니다 — 그래야
 * 백틱(```)이나 세로줄(|)이 화면에 번쩍이지 않습니다.
 */

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./ChatMarkdown.module.css";

/** 링크로 남겨 두는 주소의 시작. 대소문자는 가리지 않습니다. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** 허용하지 않는 주소는 빈 문자열이 되고, 아래 `a`가 글자로 바꿉니다. */
export function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url : "";
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** 표의 구분줄 — `| --- | :---: |` 처럼 생긴 줄. */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * 오는 중인 답장을 그리기 좋게 다듬습니다.
 *
 * 1. 코드 울타리(```)가 홀수 개면 열린 블록이 있다는 뜻이므로 끝에 닫는
 *    줄을 붙입니다.
 * 2. 끝에 `|`로 시작하는 줄이 있는데 아직 구분줄이 다 오지 않았으면 그
 *    줄들을 잠시 빼 둡니다. 다음 조각이 오면 표로 나타납니다.
 */
export function prepareStreaming(text: string): string {
  const lines = text.split("\n");
  let open: string | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (!match) continue;
    if (open === null) open = match[1];
    else if (match[1][0] === open[0] && match[1].length >= open.length) open = null;
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
 * remark 플러그인: HTML 마디를 글자 마디로 바꿉니다. react-markdown은
 * 원래 HTML을 조용히 지우는데, 그러면 답장 일부가 사라진 것처럼 보이므로
 * 글자로 보여 줍니다.
 */
function htmlAsText() {
  const walk = (parent: Node) => {
    parent.children = parent.children?.map((child) => {
      if (child.type === "html") {
        const text: Node = { type: "text", value: child.value ?? "" };
        return FLOW.has(parent.type) ? { type: "paragraph", children: [text] } : text;
      }
      walk(child);
      return child;
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
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
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

interface ChatMarkdownProps {
  text: string;
  /** 답장이 아직 오는 중이면 true. 반쯤 온 코드와 표를 다듬습니다. */
  streaming?: boolean;
}

export default function ChatMarkdown({ text, streaming = false }: ChatMarkdownProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, htmlAsText]}
        urlTransform={safeUrl}
        components={COMPONENTS}
      >
        {streaming ? prepareStreaming(text) : text}
      </ReactMarkdown>
    </div>
  );
}
