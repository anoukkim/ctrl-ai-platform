/**
 * Chat — Ctrl AI의 첫 화면입니다.
 *
 * 페이지 틀은 Server Component로 그리고, 안쪽의 대화 영역만
 * Client Component로 동작합니다.
 */

import ChatWorkspace from "@/app/components/ChatWorkspace";

export default function ChatPage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          무엇을 만들어볼까요? <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          궁금한 것을 물어보거나, 만들고 싶은 것을 이야기해보세요.
        </p>
      </header>

      <ChatWorkspace />
    </>
  );
}
