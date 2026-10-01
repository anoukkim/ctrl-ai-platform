/**
 * Report Issue — 버그를 알리거나 아이디어를 제안하는 곳.
 *
 * 지금은 GitHub Issues로 보냅니다. 따로 만들 필요가 없고, 올라온 내용이
 * 공개되어 다른 회원도 같은 문제를 겪고 있는지 바로 알 수 있기 때문입니다.
 *
 * 공개된다는 점은 장점이자 주의할 점이라 화면에서 분명히 말해 둡니다.
 * GitHub 계정이 없는 회원을 위한 신고 양식은 아래에 자리만 잡아 두었습니다.
 */

import type { Metadata } from "next";

import styles from "./issues.module.css";

export const metadata: Metadata = {
  title: "Report Issue — CTRL+AI",
};

const NEW_ISSUE_URL = "https://github.com/anoukkim/ctrl-ai-platform/issues/new/choose";

export default function IssuesPage() {
  return (
    <>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">Report Issue</h1>
        <p className="page-subtitle">
          잘 안 되는 것을 알려 주시거나, 있었으면 하는 기능을 제안해 주세요.
        </p>
      </header>

      <section className="card">
        <h2 className="section-title">어떻게 알리나요</h2>
        <ol className={styles.steps}>
          <li>
            아래 버튼을 누르면 GitHub에서 <strong>버그 신고</strong>와{" "}
            <strong>기능 제안</strong> 중 하나를 고를 수 있습니다.
          </li>
          <li>
            양식에 적힌 항목만 채워 주세요. 무엇을 하다가, 무엇을 기대했고, 실제로 어떻게
            됐는지 — 이 세 가지면 충분합니다.
          </li>
          <li>화면 사진이 있으면 원인을 훨씬 빨리 찾을 수 있습니다.</li>
        </ol>

        <a
          className="btn btn-primary"
          href={NEW_ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub에서 신고하기
          <span aria-hidden="true">↗</span>
        </a>
        <p className={styles.newTab}>새 탭에서 열립니다.</p>
      </section>

      <section className={`card ${styles.caution}`}>
        <h2 className="section-title">먼저 알아 두세요</h2>
        <ul className={styles.cautionList}>
          <li>
            <strong>GitHub 계정이 필요합니다.</strong> 계정이 없다면 무료로 만들 수 있습니다.
          </li>
          <li>
            <strong>올린 내용은 누구나 볼 수 있습니다.</strong> 비밀번호, 전화번호, 주소처럼
            개인 정보나 남에게 보이면 안 되는 내용은 절대 쓰지 마세요. 화면 사진에 그런 것이
            찍혀 있지 않은지도 한 번 확인해 주세요.
          </li>
        </ul>
      </section>

      {/*
        GitHub 계정이 없는 회원을 위한 자리입니다. 화면 안에서 바로 보내는
        양식을 여기에 넣을 예정이라, 미리 자리와 설명만 두었습니다.
        만들 때 필요한 것: 글을 저장할 테이블, 관리자용 목록 화면,
        그리고 스팸을 막을 방법.
      */}
      <section className={`card ${styles.placeholder}`}>
        <h2 className="section-title">
          화면에서 바로 보내기 <span className="badge badge-mock">준비 중</span>
        </h2>
        <p className="small muted">
          GitHub 계정 없이도 여기에서 바로 보낼 수 있는 양식을 준비하고 있습니다. 그때까지는
          위의 GitHub 링크를 이용해 주세요.
        </p>
      </section>
    </>
  );
}
