import { redirect } from "next/navigation";

/**
 * 예전 Report Issue 주소.
 *
 * admin-and-nav-cleanup(2026-10-14)에서 메뉴와 화면을 없앴습니다. 의견은
 * 사이드바 아래쪽의 **의견 보내기**로 보냅니다. 저장해 둔 주소로 오면
 * Chat으로 보냅니다.
 */
export default function IssuesPage() {
  redirect("/");
}
