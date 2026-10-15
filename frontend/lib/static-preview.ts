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

/**
 * 앱 주소(apps.ctrlai.my/<slug>/)를 띄우는 프레임의 sandbox (app-platform P1).
 *
 * 그 주소는 이제 회원의 파일이 아니라 **CTRL+AI의 셸**입니다. 셸은 자기
 * 출처(apps.ctrlai.my)의 저장소를 써야 해서 `allow-same-origin`이 필요하고,
 * ctrlai.my와는 다른 출처라 이 화면에 닿지 못합니다. 회원의 코드는 셸 안의
 * 한 겹 더 깊은 프레임에서 `allow-same-origin` **없이** 돌아갑니다
 * (`backend/app/services/app_shell.py`의 `APP_SANDBOX`). 맨 위 페이지 이동과
 * 알림창은 여전히 막습니다. 셸이 여는 로그인 창(P2)은 이 울타리를 물려받지
 * 않도록 `allow-popups-to-escape-sandbox` — 셸만 창을 열 수 있고, 회원의
 * 코드가 여는 창은 셸 안쪽 울타리를 그대로 물려받습니다. 테스트가 정확한
 * 값을 확인합니다.
 */
export const RUNTIME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

/**
 * 샌드박스 프레임에서는 `localStorage`가 오류를 냅니다(불투명한 출처). 앱이
 * 그 때문에 멈추지 않도록, 그럴 때만 메모리 저장소로 바꿔 줍니다. 백엔드가
 * 앱 주소에 쓰는 HTML에도 같은 것이 들어갑니다(`app_runtime.STORAGE_SHIM`).
 */
export const STORAGE_SHIM =
  "<script>(function(){try{window.localStorage.getItem('_');return}catch(e){}" +
  "function m(){var d={};return{getItem:function(k){k=String(k);" +
  "return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null}," +
  "setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]}," +
  "clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null}," +
  "get length(){return Object.keys(d).length}}}" +
  "try{Object.defineProperty(window,'localStorage',{value:m(),configurable:true});" +
  "Object.defineProperty(window,'sessionStorage',{value:m(),configurable:true})}catch(e){}" +
  "})();</script>";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
/** CSP 바로 뒤, 앱의 어떤 스크립트보다 먼저. */
const HEAD_START = CSP_META + STORAGE_SHIM;

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
    doc = doc.replace(/<head\b[^>]*>/i, (head) => `${head}${HEAD_START}`);
  } else if (/^\s*<!doctype[^>]*>/i.test(doc)) {
    doc = doc.replace(/^\s*<!doctype[^>]*>/i, (doctype) => `${doctype}${HEAD_START}`);
  } else {
    doc = HEAD_START + doc;
  }
  return doc;
}
