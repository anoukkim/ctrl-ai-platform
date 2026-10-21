/** 코드 블록 ↔ 파일: 언어의 확장자와, 펜스 뒤에 적힌 파일 이름. */

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

/** 파일 이름으로 쓸 수 있는 한 단어(`members.csv`)인지. 경로는 받지 않습니다. */
export function fileNameFrom(meta: string): string | null {
  const word = meta.trim().split(/\s+/)[0] ?? "";
  return /^[\w가-힣-]+(\.[\w-]+)+$/.test(word) && word.length <= 80 ? word : null;
}
