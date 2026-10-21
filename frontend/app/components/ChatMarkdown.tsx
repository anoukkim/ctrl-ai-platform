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
 * 답장이 오는 중(`streaming`)에는 덜 온 마지막 줄(울타리, 제목 밑줄)과
 * 머리줄만 온 표를 잠시 감춥니다 — 그래야 백틱(```)이나 세로줄(|)이
 * 화면에 번쩍이지 않습니다. 닫히지 않은 코드 블록은 Markdown 규칙대로
 * 끝까지 코드로 그려집니다.
 *
 * 줄바꿈 하나도 줄바꿈으로 보여 줍니다. 이 항목 전의 답장은 "줄바꿈과 -
 * 목록만 쓰는 평문"이었으므로, 그렇게 저장된 답장도 예전처럼 읽힙니다.
 * `~` 하나는 취소선이 아닙니다 — "30~40분"처럼 범위를 쓰는 한국어가
 * 지워진 글자로 보이면 안 되기 때문입니다(`~~두 개~~`는 취소선).
 *
 * 대화의 다른 답장들은 새 조각이 올 때마다 다시 그리지 않습니다(`memo`).
 */

import { Check, Copy, Download } from "lucide-react";
import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import ArtifactPreview, {
  ArtifactContext,
  isPreviewLanguage,
  type ArtifactContextValue,
} from "./ArtifactPreview";
import styles from "./ChatMarkdown.module.css";

/** 링크로 남겨 두는 주소의 시작. 대소문자는 가리지 않습니다. 같은 답장 안의
 *  각주로 가는 `#…`도 남깁니다(새 탭으로 열지 않습니다). */
const SAFE_URL = /^(https?:\/\/|mailto:|#\S+$)/i;

/** 허용하지 않는 주소는 빈 문자열이 되고, 아래 `a`가 글자로 바꿉니다. */
export function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url : "";
}

/** 백틱 울타리. 여는 줄의 정보(언어 이름)에는 백틱이 들어갈 수 없습니다. */
const BACKTICK_FENCE = /^ {0,3}(`{3,})([^`]*)$/;
const TILDE_FENCE = /^ {0,3}(~{3,})(.*)$/;
/** 아직 다 오지 않았을 수 있는 마지막 줄 — 백틱 한두 개, 또는 바로 위
 *  줄을 제목으로 바꾸는 `-`·`=`만 있는 줄("준비물:\n-"이 잠깐 제목이 됨). */
const PARTIAL_LINE = /^ {0,3}(`{1,2}|-+|=+)\s*$/;
/** 표의 구분줄 — `| --- | :---: |` 처럼 생긴 줄. */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function fence(line: string): { marker: string; info: string } | null {
  const match = BACKTICK_FENCE.exec(line) ?? TILDE_FENCE.exec(line);
  return match ? { marker: match[1], info: match[2].trim() } : null;
}

/**
 * 오는 중인 답장을 그리기 좋게 다듬습니다.
 *
 * 1. 마지막 줄이 아직 줄바꿈 전이고, 울타리 줄(언어 이름이 반쯤 왔을 수
 *    있음)이거나 백틱 한두 개, 제목 밑줄처럼 보이면 다음 조각이 올
 *    때까지 빼 둡니다.
 * 2. 열린 코드 블록이 있으면 그대로 둡니다. 닫히지 않은 블록은 끝까지
 *    코드로 그려지고, 목록 안의 블록도 그렇습니다. (닫는 줄을 붙이면
 *    목록 안에서는 닫히지 않고 빈 블록이 하나 더 생깁니다.) 닫는 줄은
 *    같은 글자로, 여는 줄 이상 길이로, 뒤에 아무것도 없어야 합니다.
 * 3. 끝에 `|`로 시작하는 줄이 있는데 아직 구분줄이 다 오지 않았으면 그
 *    줄들을 잠시 빼 둡니다. 다음 조각이 오면 표로 나타납니다.
 */
export function prepareStreaming(full: string): string {
  let text = full;
  let lines = text.split("\n");
  const last = lines[lines.length - 1];
  if (!text.endsWith("\n") && (fence(last) !== null || PARTIAL_LINE.test(last))) {
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
  if (open !== null) return text;

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

type HastElement = {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastElement[];
};

/**
 * rehype 플러그인: 각주 제목의 id(`footnote-label`)는 `clobberPrefix`가
 * 바꾸지 않아 답장마다 같습니다. 그 id와 그것을 가리키는
 * `aria-describedby`에 답장의 머리말을 붙입니다.
 */
function prefixFootnoteLabel(prefix: string) {
  const label = "footnote-label";
  const walk = (node: HastElement) => {
    const props = node.properties;
    if (props) {
      if (props.id === label) props.id = `${prefix}${label}`;
      const described = props.ariaDescribedBy;
      if (Array.isArray(described))
        props.ariaDescribedBy = described.map((id) => (id === label ? `${prefix}${label}` : id));
    }
    node.children?.forEach(walk);
  };
  return (tree: HastElement) => walk(tree);
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

/** 코드 블록의 언어 → 내려받는 파일의 확장자. 모르는 언어는 .txt. */
const CODE_EXTENSIONS: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  html: "html", css: "css", json: "json", markdown: "md", md: "md", csv: "csv", sql: "sql",
  bash: "sh", sh: "sh", shell: "sh", yaml: "yml", yml: "yml", xml: "xml", svg: "svg",
  java: "java", c: "c", cpp: "cpp", go: "go", rust: "rs", ruby: "rb", php: "php", text: "txt", txt: "txt",
};

export function codeExtension(language: string): string {
  return CODE_EXTENSIONS[language.toLowerCase()] ?? "txt";
}

/** 코드 블록 — 언어 이름과 **복사**·**다운로드** 단추. 색 입히기는 하지 않습니다. */
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

  // 파일은 화면(CTRL+AI)이 Blob으로 만듭니다. 늘 text/plain이라 열어도 실행되지 않아요.
  const download = () => {
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `code.${codeExtension(language)}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const block = (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span className={styles.codeLanguage}>{language || "코드"}</span>
        <span className={styles.codeActions}>
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
        <button type="button" className={styles.copy} onClick={download}>
          <Download size={13} aria-hidden="true" />
          <span>다운로드</span>
        </button>
        </span>
      </div>
      <pre className={styles.pre}>{children}</pre>
    </div>
  );
  // html·svg 블록은 미리보기 카드가 감쌉니다(chat-plus-artifacts). 코드는
  // 그 카드의 "코드 보기"로 나옵니다. 끝나지 않은 답장이나 미리보기
  // 사정을 모르는 화면에서는 그냥 코드입니다.
  const lang = language.toLowerCase();
  if (isPreviewLanguage(lang)) {
    return <ArtifactPreview code={text} language={lang} codeView={block} />;
  }
  return block;
}

const COMPONENTS: Components = {
  a({ node, href, children, ...rest }) {
    void node; // hast 마디는 DOM 속성이 아니므로 넘기지 않습니다.
    if (!href) return <span>{children}</span>;
    // 각주 링크: 같은 탭에서, 각주가 쓰는 id와 읽어 주는 이름을 그대로 둡니다.
    if (href.startsWith("#"))
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
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
  /** 미리보기에 필요한 답장의 사정(chat-plus-artifacts). 없으면 코드만. */
  artifacts?: ArtifactContextValue;
  /** 답장이 아직 오는 중이면 true. 반쯤 온 코드와 표를 다듬습니다. */
  streaming?: boolean;
  /** 마지막 글자 바로 뒤에 붙일 것 — 답장을 쓰는 중임을 알리는 깜빡이. */
  tail?: ReactNode;
}

function ChatMarkdown({ text, streaming = false, tail, artifacts }: ChatMarkdownProps) {
  // 각주 id가 한 대화의 답장끼리 겹치지 않도록 답장마다 다른 머리말을 씁니다.
  const prefix = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
  return (
    <ArtifactContext.Provider value={artifacts ?? null}>
      <div className={`${styles.markdown} ${tail ? styles.withTail : ""}`}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          remarkRehypeOptions={{
            clobberPrefix: prefix,
            footnoteLabel: "각주",
            footnoteBackLabel: "본문으로 돌아가기",
          }}
          rehypePlugins={[[prefixFootnoteLabel, prefix]]}
          urlTransform={safeUrl}
          components={COMPONENTS}
        >
          {streaming ? prepareStreaming(text) : text}
        </ReactMarkdown>
        {tail}
      </div>
    </ArtifactContext.Provider>
  );
}

export default memo(ChatMarkdown);
