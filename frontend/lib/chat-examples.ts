/**
 * Chat 첫 화면의 **기능 둘러보기** 카드.
 *
 * Claude를 처음 써 보는 회원이 "이런 것도 되는구나"를 직접 해 보게 하는
 * 예시입니다. 카드를 누르면 예시 문장이 입력창에 채워질 뿐, 아무것도
 * 보내지 않습니다 — 회원은 고른 모델과 예상 비용을 본 뒤 직접 보냅니다.
 *
 * 화면용 데이터지만 목업이 아니라 제품 문구이므로 `mock-data.ts`가 아닌
 * 이 파일에 둡니다. 예전 바로가기(Project Builder, Video Generator,
 * CtrlAIApps, CtrlAITube)는 사이드바와 답장 아래 단추로 갑니다.
 */

export interface ChatExample {
  title: string;
  /** 카드 아래 한 줄 설명. */
  description: string;
  /** 입력창에 채울 문장. 끝의 줄바꿈은 그 아래에 붙여 넣으라는 뜻입니다. */
  prompt: string;
  /** 화면이 lucide 아이콘으로 바꿉니다. 데이터 파일에는 이름만 둡니다. */
  icon: "table" | "file" | "chart" | "page";
  /** true면 카드를 누를 때 파일 고르기 창도 엽니다(chat-plus-files). */
  opensFilePicker?: boolean;
}

export const CHAT_EXAMPLES: ChatExample[] = [
  {
    title: "표 만들기",
    description: "흩어진 내용을 한눈에 보이는 표로 정리해 줍니다.",
    prompt: "서울 여행 2박 3일 일정을 표로 정리해 줘",
    icon: "table",
  },
  {
    // chat-plus-files: 카드를 누르면 파일 고르기 창이 열립니다.
    title: "파일 요약",
    description: "PDF·사진·CSV·글 파일을 올리면 핵심만 짧게 줄여 줍니다.",
    prompt: "이 파일을 세 줄로 요약해 줘",
    icon: "file",
    opensFilePicker: true,
  },
  {
    // chat-plus-artifacts가 들어오기 전까지는 표와 한 줄 해석으로 답합니다.
    title: "차트 그리기",
    description: "숫자를 표로 정리하고 무엇을 뜻하는지 한 줄로 알려 줍니다.",
    prompt: "우리 동아리 회원 수가 분기마다 12명, 18명, 25명, 31명이야. 차트로 보여 줘",
    icon: "chart",
  },
  {
    // chat-plus-artifacts가 들어오기 전까지는 코드로 답합니다.
    title: "웹페이지 만들기",
    description: "한 장짜리 웹페이지 코드를 써 줍니다.",
    prompt: "동아리 소개 한 장짜리 웹페이지를 만들어 줘",
    icon: "page",
  },
];
