"use client";

/**
 * Chat 작업 영역: 대화 목록, 입력창, 바로가기 카드.
 *
 * Chat은 CTRL+AI의 첫 화면입니다. 일반적인 질문에 답하는 동시에,
 * 기능 이름을 몰라도 알맞은 작업 공간으로 안내하는 역할을 합니다.
 *
 * 중요: 아직 목업 화면입니다. 어디에도 요청을 보내지 않으며, 아래 응답은
 * 브라우저 안에서 단어를 보고 고른 것입니다. Claude 연결은 Phase 2입니다.
 */

import { Clapperboard, Code2, LayoutGrid, PlayCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useState } from "react";

import { CHAT_SHORTCUTS } from "@/lib/mock-data";

/** 바로가기 카드의 아이콘. 사이드바와 같은 한 벌을 씁니다. */
const SHORTCUT_ICON: Record<string, LucideIcon> = {
  build: Code2,
  video: Clapperboard,
  apps: LayoutGrid,
  tube: PlayCircle,
};

import styles from "./ChatWorkspace.module.css";

interface Suggestion {
  label: string;
  href: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  body: string;
  suggestion?: Suggestion;
}

const WELCOME: Message = {
  id: 0,
  role: "assistant",
  body: "안녕하세요. 만들고 싶은 것을 이야기해 주시면 알맞은 곳으로 안내해 드릴게요. 아래 바로가기를 눌러 시작해도 좋습니다.",
};

/**
 * Phase 2에서 만들 백엔드 라우팅을 대신하는 임시 함수입니다.
 *
 * 복잡한 AI 라우터를 만들지 않고 단어만 보고 판단합니다. 사용자는 한국어로
 * 입력하므로 한국어 표현을 기준으로 살펴봅니다.
 */
function mockReply(input: string): Message {
  const text = input.toLowerCase();
  const id = Date.now();

  // 영상을 먼저 확인합니다. "영상 만들고 싶어요"처럼 두 주제의 단어가
  // 같이 나오는 경우가 많기 때문입니다.
  if (/영상|비디오|쇼츠|숏폼|클립|유튜브|youtube|촬영|장면/.test(text)) {
    return {
      id,
      role: "assistant",
      body: "영상으로 만들면 좋겠네요. Video Generator에서 아이디어를 다듬고 짧은 영상으로 만들어 볼 수 있어요.",
      suggestion: { label: "Video Generator에서 시작하기", href: "/video" },
    };
  }

  if (/앱|어플|프로그램|사이트|웹|게임|도구|만들|제작|프로젝트|관리|기록/.test(text)) {
    return {
      id,
      role: "assistant",
      body: "좋아요. Project Builder에서 새 프로젝트를 만들어볼까요? 한국어로 설명해 주시면 화면을 만들어 드려요.",
      suggestion: { label: "Project Builder에서 시작하기", href: "/builder" },
    };
  }

  if (/크레딧|토큰|사용량|남은|남았|할당|잔액|얼마나/.test(text)) {
    return {
      id,
      role: "assistant",
      body: "이번 시즌에 남은 사용량을 확인할 수 있어요. Claude 토큰과 영상 생성 크레딧은 따로 계산됩니다.",
      suggestion: { label: "Usage에서 확인하기", href: "/usage" },
    };
  }

  if (/내 프로젝트|내 앱|내 영상|내가 만든|프로필|시즌|계정|연결/.test(text)) {
    return {
      id,
      role: "assistant",
      body: "지금까지 만든 프로젝트와 앱, 영상은 Profile에서 한눈에 볼 수 있어요.",
      suggestion: { label: "Profile 열기", href: "/profile" },
    };
  }

  if (/둘러|구경|다른 사람|다른 회원|커뮤니티|추천|인기/.test(text)) {
    return {
      id,
      role: "assistant",
      body: "다른 회원들이 만든 앱은 CtrlAI Apps에서, 영상은 CtrlAITube에서 볼 수 있어요.",
      suggestion: { label: "CtrlAI Apps 둘러보기", href: "/ctrlaistore" },
    };
  }

  return {
    id,
    role: "assistant",
    body: "아직 Claude가 연결되지 않아 정확한 답변을 드리기 어려워요. 앱을 만들고 싶은지, 영상을 만들고 싶은지 말씀해 주시면 알맞은 곳으로 안내해 드릴게요.",
  };
}

export default function ChatWorkspace() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const inputId = useId();

  const send = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    setMessages((current) => [
      ...current,
      { id: Date.now() - 1, role: "user", body: trimmed },
      mockReply(trimmed),
    ]);
    setDraft("");
  }, [draft]);

  return (
    <div className={styles.workspace}>
      <div className={styles.thread} role="log" aria-label="대화 내용">
        {messages.map((message) => (
          <div
            className={`${styles.message} ${
              message.role === "user" ? styles.messageUser : styles.messageAssistant
            }`}
            key={message.id}
          >
            <span className={styles.messageRole}>
              {message.role === "user" ? "나" : "CTRL+AI"}
            </span>
            {message.body}
            {message.suggestion && (
              <div>
                <Link className={styles.suggestion} href={message.suggestion.href}>
                  {message.suggestion.label} <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <label className="section-title" htmlFor={inputId}>
          무엇이든 물어보세요
        </label>
        <textarea
          className={`field ${styles.input}`}
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter로 보내고, Shift+Enter로 줄을 바꿉니다. 한글 입력 중에는
            // 글자를 조합하는 단계에서 Enter가 눌릴 수 있으므로, 조합이
            // 끝나지 않았으면(isComposing) 보내지 않습니다.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="CTRL+AI에게 무엇이든 물어보세요"
        />
        <div className={styles.composerRow}>
          <span className="small muted">
            지금은 예시 답변만 보여 줍니다. Claude 연결은 Phase 2에서 진행됩니다.
          </span>
          <button className="btn btn-primary" type="button" onClick={send} disabled={!draft.trim()}>
            보내기
          </button>
        </div>
      </div>

      <section>
        <h2 className="section-title">이렇게 시작해 보세요</h2>
        <div className={styles.shortcuts}>
          {CHAT_SHORTCUTS.map((shortcut) => (
            <Link className={styles.shortcut} href={shortcut.href} key={shortcut.title}>
              {(() => {
                const Icon = SHORTCUT_ICON[shortcut.icon];
                return <Icon className={styles.shortcutIcon} aria-hidden="true" />;
              })()}
              <span className={styles.shortcutTitle}>{shortcut.title}</span>
              <span className={styles.shortcutDescription}>{shortcut.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
