/**
 * Chat — CTRL+AI의 첫 화면입니다.
 *
 * 맨 위의 환영 영역은 처음 온 사람에게 여기가 어떤 곳인지 한 번에
 * 알려 주는 자리입니다. 기능 이름을 몰라도 무엇을 할 수 있는지
 * 읽히도록 짧게 둡니다.
 *
 * 페이지 틀은 Server Component로 그리고, 안쪽의 대화 영역만
 * Client Component로 동작합니다.
 */

import BrandMark from "@/app/components/BrandMark";
import ChatWorkspace from "@/app/components/ChatWorkspace";

import styles from "./page.module.css";

export default function ChatPage() {
  return (
    <>
      <section className={styles.welcome}>
        <BrandMark size={40} className={styles.welcomeMark} />
        <div>
          <h1 className={styles.welcomeTitle}>CTRL+AI에 오신 것을 환영합니다</h1>
          <p className={styles.welcomeText}>
            코드를 몰라도 괜찮습니다. 만들고 싶은 것을 한국어로 이야기하면 앱이나 짧은 영상으로
            만들어 보고, 커뮤니티에 나눌 수 있습니다.
          </p>
        </div>
      </section>

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
