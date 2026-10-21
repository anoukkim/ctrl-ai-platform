/**
 * 대화 내보내기 — Markdown, PDF(인쇄), 그리고 답장 속 코드 파일의 ZIP.
 * 모두 화면(브라우저)에서 만들고 서버를 부르지 않아 무료입니다.
 */

import { codeExtension, fileNameFrom } from "./code-files";

import { makeZip, type ZipEntry } from "./zip";

export interface ExportMessage {
  role: "user" | "assistant";
  content: string;
}

export function conversationMarkdown(title: string, messages: ExportMessage[]): string {
  const lines = [`# ${title || "새 대화"}`, ""];
  for (const message of messages) {
    if (!message.content.trim()) continue;
    lines.push(message.role === "user" ? "## 나" : "## Claude", "", message.content.trim(), "");
  }
  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 인쇄용 문서 — 글자만(이스케이프), 스크립트 없음. 인쇄 창에서 PDF로 저장합니다. */
export function printableHtml(title: string, messages: ExportMessage[]): string {
  const body = messages
    .filter((message) => message.content.trim())
    .map(
      (message) =>
        `<section><h2>${message.role === "user" ? "나" : "Claude"}</h2><pre>${escapeHtml(message.content.trim())}</pre></section>`,
    )
    .join("");
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title || "새 대화")}</title>` +
    `<style>body{font:14px/1.6 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}` +
    `h1{font-size:1.4rem}h2{font-size:1rem;margin:1.4rem 0 .3rem;color:#555}pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}</style>` +
    `</head><body><h1>${escapeHtml(title || "새 대화")}</h1>${body}</body></html>`
  );
}

const FENCE = /^```([\w+#-]*)[ \t]*([^\n`]*)\n([\s\S]*?)\n```[ \t]*$/gm;

/** 답장들의 코드 블록 → 파일들. 이름이 없으면 code-N.확장자, 같은 이름은 번호를 붙입니다. */
export function codeFiles(messages: ExportMessage[]): ZipEntry[] {
  const used = new Set<string>();
  const files: ZipEntry[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const match of message.content.matchAll(FENCE)) {
      const [, language, meta, code] = match;
      let name = fileNameFrom(meta) ?? `code-${files.length + 1}.${codeExtension(language)}`;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        name = `${name.slice(0, dot)}-${files.length + 1}${name.slice(dot)}`;
      }
      used.add(name);
      files.push({ name, content: code + "\n" });
    }
  }
  return files;
}

export function codeZip(messages: ExportMessage[]): Blob | null {
  const files = codeFiles(messages);
  return files.length ? makeZip(files) : null;
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** 파일 이름에 못 쓰는 글자를 뺀 대화 제목. */
export function safeTitle(title: string): string {
  return (title || "대화").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 40) || "대화";
}
