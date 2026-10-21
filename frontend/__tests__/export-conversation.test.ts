/**
 * 대화 내보내기 — Markdown, 인쇄용 문서, 코드 파일의 ZIP (chat-export).
 */
import { describe, expect, test } from "vitest";

import { codeExtension, fileNameFrom } from "@/lib/code-files";
import { codeFiles, conversationMarkdown, printableHtml, safeTitle } from "@/lib/export-conversation";
import { crc32, makeZip } from "@/lib/zip";

const MESSAGES = [
  { role: "user" as const, content: "회원 목록을 CSV로 줘" },
  {
    role: "assistant" as const,
    content: "여기요.\n\n```csv members.csv\n이름,나이\n가,1\n```\n\n그리고 스크립트:\n\n```python\nprint(1)\n```\n\n```csv members.csv\n나,2\n```",
  },
];

describe("파일 이름", () => {
  test("펜스 뒤의 한 단어 이름만 받고, 경로는 거절한다", () => {
    expect(fileNameFrom("members.csv")).toBe("members.csv");
    expect(fileNameFrom("회원.csv  extra")).toBe("회원.csv");
    expect(fileNameFrom("../etc/passwd")).toBeNull();
    expect(fileNameFrom("a/b.txt")).toBeNull();
    expect(fileNameFrom("")).toBeNull();
    expect(fileNameFrom("title=x")).toBeNull();
  });
  test("확장자", () => {
    expect(codeExtension("csv")).toBe("csv");
    expect(codeExtension("zzz")).toBe("txt");
  });
});

describe("코드 파일 모으기", () => {
  test("이름이 있으면 그 이름, 없으면 code-N, 같은 이름은 번호를 붙인다", () => {
    const files = codeFiles(MESSAGES);
    expect(files.map((file) => file.name)).toEqual(["members.csv", "code-2.py", "members-3.csv"]);
    expect(files[0].content).toBe("이름,나이\n가,1\n");
  });
  test("내 메시지의 코드 블록은 모으지 않는다", () => {
    expect(codeFiles([{ role: "user", content: "```py\nx\n```" }])).toEqual([]);
  });
});

describe("Markdown과 인쇄용 문서", () => {
  test("Markdown은 제목과 말한 사람을 구분한다", () => {
    const md = conversationMarkdown("제목", MESSAGES);
    expect(md.startsWith("# 제목\n")).toBe(true);
    expect(md).toContain("## 나\n\n회원 목록을 CSV로 줘");
    expect(md).toContain("## Claude");
  });
  test("인쇄용 문서는 글자를 이스케이프하고 스크립트가 없다", () => {
    const html = printableHtml("<img onerror=x>", [{ role: "user", content: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
  });
  test("파일 이름에 못 쓰는 글자는 뺀다", () => {
    expect(safeTitle('a/b:c*"d')).toBe("a b c d");
    expect(safeTitle("")).toBe("대화");
  });
});

describe("ZIP", () => {
  test("CRC32는 알려진 값과 같다", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  test("ZIP은 파일 수만큼의 항목과 끝 표지를 가진다", async () => {
    const blob = makeZip([
      { name: "a.txt", content: "안녕" },
      { name: "b.py", content: "print(1)\n" },
    ]);
    expect(blob.type).toBe("application/zip");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // first local header
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // the central directory starts where the end record says
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});
