/**
 * Chat — CTRL+AI의 첫 화면입니다.
 *
 * 이 파일에는 제목도 환영 배너도 없습니다. 대화 화면에서 화면 높이는
 * 전부 대화에 써야 하고, 처음 온 사람에게 할 말은 ChatWorkspace의
 * "아직 대화가 없을 때" 상태 안에 들어 있습니다. 대화가 시작되면 그
 * 안내는 사라지고 자리를 대화에 내줍니다.
 */

import ChatWorkspace from "@/app/components/ChatWorkspace";

export default function ChatPage() {
  return <ChatWorkspace />;
}
