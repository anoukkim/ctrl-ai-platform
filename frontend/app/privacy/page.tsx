/**
 * 개인정보 처리방침 (privacy-and-terms).
 *
 * 동아리 규모에 맞게, 실제로 하는 일만 적습니다 — 하지 않는 일을
 * 약속하거나, 하는 일을 숨기지 않습니다. 문구를 바꾸면 시행일과 버전을
 * 함께 올립니다. 이 문서는 운영진 검토를 받습니다.
 */

import type { Metadata } from "next";

import LegalPage from "@/app/components/LegalPage";

import styles from "@/app/components/legal.module.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침 — CTRL+AI",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보 처리방침" effective="시행일 2026-10-14 · v1">
      <p className={styles.lead}>
        CTRL+AI는 동아리 회원이 AI로 앱과 영상을 만들어 보는 초대제
        서비스입니다. 운영에 꼭 필요한 정보만 모으고, 어디에 쓰는지 아래에
        전부 적었습니다. 궁금한 점은 언제든{" "}
        <strong>ctrlai.platform@gmail.com</strong>으로 물어봐 주세요.
      </p>

      <h2>1. 모으는 정보</h2>
      <ul>
        <li>
          <strong>계정 정보</strong> — 아이디, 이름(다른 회원에게 보이는
          표시 이름), 이메일. Google로 가입하면 Google 계정의 이메일과
          이름을 받아 오며, <strong>로그인에만</strong> 씁니다(권한 범위:
          openid·email·profile — 그 밖의 Google 데이터에는 접근하지
          않습니다).
        </li>
        <li>
          <strong>만든 것들</strong> — 채팅 대화 내용, 프로젝트와 그 파일,
          생성한 영상, 커뮤니티에 올린 글과 댓글.
        </li>
        <li>
          <strong>사용 기록</strong> — 어느 기능이 언제 얼마(원)를
          차감했는지. 동아리 지원금 정산의 근거라서 모읍니다.
        </li>
        <li>
          <strong>보안 기록</strong> — 가입·로그인 시도 횟수와 접속
          주소(IP). 무차별 시도를 막는 횟수 제한에만 씁니다.
        </li>
      </ul>
      <p>
        결제 정보는 모으지 않습니다 — 베타에서는 개인 충전을 받지 않고,
        회원이 돈을 낼 일이 없습니다.
      </p>

      <h2>2. 어디에 쓰나</h2>
      <ul>
        <li>서비스 제공 — 채팅, 앱 만들기, 영상 만들기, 커뮤니티.</li>
        <li>분기 지원금 정산과 한도 운영 — 사용 기록이 그 장부입니다.</li>
        <li>부정 사용 방지 — 시도 제한, 감사 기록.</li>
        <li>운영 문의 대응.</li>
      </ul>
      <p>광고나 마케팅에 쓰지 않고, 다른 곳에 팔지 않습니다.</p>

      <h2>3. 어디에 저장되나</h2>
      <p>
        모든 데이터는 Google Cloud <strong>서울 리전(asia-northeast3)</strong>의
        서버와 데이터베이스에 저장됩니다. 정기 백업도 같은 환경에 있습니다.
      </p>

      <h2>4. 누구에게 전달되나</h2>
      <ul>
        <li>
          <strong>AI 제공자</strong> — 채팅과 생성 기능은 외부 AI에
          요청을 보내야 동작합니다: 대화 내용과 생성 요청이{" "}
          <strong>Claude(미국 Anthropic)</strong>에, 영상 생성 요청이{" "}
          <strong>Higgsfield</strong>에 전달됩니다. 회원의 이름·이메일 같은
          계정 정보는 보내지 않습니다 — 요청 내용만 갑니다. API 키는
          동아리가 갖고 있어 회원이 직접 제공자와 계약하지 않습니다.
        </li>
        <li>
          <strong>지금(베타)은</strong> 실제 제공자 대신 모형(목업)이
          응답하고 있어 외부로 나가는 요청이 없습니다. 실제 제공자가
          켜지면 화면의 "테스트 모드" 표시가 사라지는 것으로 알 수
          있습니다.
        </li>
      </ul>
      <p>그 밖의 제3자 제공, 광고 도구, 분석 도구는 없습니다.</p>

      <h2>5. 얼마나 보관하나</h2>
      <ul>
        <li>
          계정과 만든 것들 — 쓰는 동안 보관합니다. 분기에 참여하지 않아도
          만든 것은 지워지지 않습니다.
        </li>
        <li>
          <strong>탈퇴하면</strong> 계정이 바로 닫히고, 30일 동안은 복구를
          요청할 수 있습니다. 30일이 지나면 아이디·이메일·이름이 식별할 수
          없는 값으로 바뀝니다(익명화). 정산이 끝나지 않은 돈이 있으면 그
          처리가 끝날 때까지 익명화가 미뤄집니다.
        </li>
        <li>
          사용 기록과 운영 감사 기록은 동아리 지원금 정산의 근거라 기록으로
          남습니다 — 익명화 뒤에는 누구의 것인지 알 수 없습니다.
        </li>
        <li>
          게시한 앱·영상은 탈퇴 때 내리기를 선택할 수 있고, 남겨 두면
          "탈퇴 회원" 표기로 남습니다.
        </li>
      </ul>

      <h2>6. 회원의 권리</h2>
      <ul>
        <li>내 정보 확인과 이름 변경 — Profile에서 직접 합니다.</li>
        <li>대화 삭제 — 삭제하면 실제로 지워집니다(사용 기록의 금액만 장부에 남습니다).</li>
        <li>
          프로젝트·영상 삭제 — 화면에서 바로 사라지고, 실수에 대비해
          관리자가 복구할 수 있는 상태로 보관됩니다.
        </li>
        <li>회원 탈퇴 — Profile 맨 아래에서 직접 합니다.</li>
        <li>
          그 밖의 열람·정정·삭제 요청 —{" "}
          <strong>ctrlai.platform@gmail.com</strong>으로 보내 주세요.
        </li>
      </ul>

      <h2>7. 문의</h2>
      <p>
        개인정보에 관한 모든 문의: <strong>ctrlai.platform@gmail.com</strong>
        (동아리 운영진이 직접 읽습니다).
      </p>
      <p>
        이 방침이 바뀌면 사이트에 공지하고 맨 위의 시행일과 버전을
        올립니다.
      </p>
    </LegalPage>
  );
}
