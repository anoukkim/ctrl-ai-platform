/**
 * 첫 화면을 그리기 전에 고른 테마를 붙이는 스크립트.
 *
 * `app/layout.tsx`(서버 컴포넌트)가 `<head>`에 그대로 넣으므로 이 파일은
 * "use client"가 아닙니다 — 클라이언트 모듈에서 가져오면 문자열이 아니라
 * 참조가 넘어옵니다. 키 이름은 `lib/theme.ts`와 같아야 합니다.
 */

export const THEME_STORAGE_KEY = "ctrlai-theme";

export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
