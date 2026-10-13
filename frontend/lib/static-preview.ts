/**
 * 정적 미리보기 — 프로젝트 파일을 iframe 하나에 담을 HTML로 만듭니다
 * (chat-builder-starter).
 *
 * 회원의 앱은 CTRL+AI 서버에서 실행되지 않습니다. 브라우저 안에서만, 아래
 * 세 겹의 울타리 안에서 돌아갑니다. 셋 다 테스트가 정확한 값을 확인합니다
 * — 나중의 "작은 수정"이 울타리를 넓히지 못하도록.
 *
 * 1. `<iframe srcdoc>`에 **`sandbox="allow-scripts"`만** 줍니다.
 *    `allow-same-origin`을 함께 주면 프레임이 자기 샌드박스를 풀 수 있으므로
 *    절대 주지 않습니다. 그래서 프레임의 출처는 불투명(opaque)하고, CTRL+AI의
 *    쿠키·저장소·`/api`에 닿을 수 없습니다.
 * 2. 문서 맨 앞의 CSP가 **모든 네트워크를 막습니다** — fetch, 외부 이미지,
 *    외부 스크립트, 폰트, 전송 모두.
 * 3. CSS와 JS 파일은 `<style>` / `<script>`로 문서 안에 넣습니다. 프레임은
 *    다른 파일을 불러올 길이 없으니까요.
 */

export const PREVIEW_SANDBOX = "allow-scripts";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

/** `href="./style.css"` → `style.css`. 프로젝트 밖을 가리키면 null. */
function localPath(ref: string): string | null {
  let path = ref.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.startsWith("/")) return null;
  path = path.split(/[?#]/)[0];
  while (path.startsWith("./")) path = path.slice(2);
  return path || null;
}

/** `</script>`가 내용 안에 있으면 스크립트 태그가 일찍 닫히므로 막습니다. */
function safeScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

function safeStyle(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/**
 * 시작 파일을 미리보기용 문서 하나로 만듭니다. 시작 파일이 없으면 null.
 */
export function buildSrcdoc(files: Record<string, string>, entry = "index.html"): string | null {
  const html = files[entry];
  if (html === undefined) return null;

  let doc = html
    .replace(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, href: string) => {
      if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
      const path = localPath(href);
      return path !== null && files[path] !== undefined
        ? `<style>${safeStyle(files[path])}</style>`
        : "";
    })
    .replace(
      /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
      (_tag, _before: string, src: string) => {
        const path = localPath(src);
        return path !== null && files[path] !== undefined
          ? `<script>${safeScript(files[path])}</script>`
          : "";
      },
    );

  // CSP는 무엇보다 먼저 와야 합니다. <head>가 있으면 그 바로 뒤에,
  // 없으면 맨 앞에(doctype 뒤에) 둡니다.
  if (/<head\b[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head\b[^>]*>/i, (head) => `${head}${CSP_META}`);
  } else if (/^\s*<!doctype[^>]*>/i.test(doc)) {
    doc = doc.replace(/^\s*<!doctype[^>]*>/i, (doctype) => `${doctype}${CSP_META}`);
  } else {
    doc = CSP_META + doc;
  }
  return doc;
}
