"use client";

/**
 * Chat 작업 영역 — 대화 목록과 입력창.
 *
 * 진짜 대화 앱처럼 움직입니다. 목록이 남은 높이를 전부 차지하고 그 안에서
 * 스크롤되며, 입력창은 바닥에 고정됩니다. 페이지 전체가 스크롤되면 글을
 * 쓰는 동안 입력창이 화면 밖으로 밀려납니다.
 *
 * 처음에는 환영 인사와 바로가기 카드를 보여 주고, 대화가 한 번이라도
 * 오가면 감춥니다. 안내는 시작할 때만 필요하고, 그 뒤로는 자리만 차지합니다.
 *
 * 중요: 아직 목업 화면입니다. 어디에도 요청을 보내지 않으며, 아래 응답은
 * 브라우저 안에서 단어를 보고 고른 것입니다. Claude 연결은 Phase 2입니다.
 */

import { Clapperboard, Code2, LayoutGrid, PlayCircle, SendHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { CHAT_SHORTCUTS } from "@/lib/mock-data";

import BrandMark from "./BrandMark";
import styles from "./ChatWorkspace.module.css";

/** 바로가기 카드의 아이콘. 사이드바와 같은 한 벌을 씁니다. */
const SHORTCUT_ICON: Record<string, LucideIcon> = {
  build: Code2,
  video: Clapperboard,
  apps: LayoutGrid,
  tube: PlayCircle,
};

/** 입력창이 늘어날 수 있는 최대 줄 수. 그보다 길어지면 안에서 스크롤됩니다. */
const MAX_ROWS = 6;

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
      body: "이번 분기에 남은 사용량을 확인할 수 있어요. 공동체 지원과 개인 잔액은 따로 계산됩니다.",
      suggestion: { label: "Usage에서 확인하기", href: "/usage" },
    };
  }

  if (/내 프로젝트|내 앱|내 영상|내가 만든|프로필|분기|계정|연결/.test(text)) {
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const started = messages.length > 0;

  // 새 메시지가 생기면 맨 아래로 내립니다. 대화 앱에서 방금 온 답을
  // 직접 찾아 내려야 한다면 뭔가 잘못된 것입니다.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  /**
   * 입력한 줄 수에 맞춰 입력창 높이를 조절합니다.
   *
   * 높이를 auto로 되돌린 뒤 scrollHeight를 읽는 것이 핵심입니다. 그러지
   * 않으면 한 번 커진 높이가 줄어들지 않습니다.
   */
  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;

    node.style.height = "auto";
    const line = parseFloat(getComputedStyle(node).lineHeight) || 22;
    const padding = node.offsetHeight - node.clientHeight;
    const max = line * MAX_ROWS + padding;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

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
    <div className={styles.chat}>
      <div className={styles.threadScroll} ref={threadRef} role="log" aria-label="대화 내용">
        <div className={styles.threadInner}>
          {!started ? (
            // 아직 대화가 없을 때만 보이는 안내. 대화가 시작되면 사라집니다.
            <div className={styles.empty}>
              <BrandMark size={44} />
              <h1 className={styles.emptyTitle}>CTRL+AI에 오신 것을 환영합니다</h1>
              <p className={styles.emptyText}>
                코드를 몰라도 괜찮습니다. 만들고 싶은 것을 한국어로 이야기하면 앱이나 짧은
                영상으로 만들어 보고, 커뮤니티에 나눌 수 있습니다.
              </p>

              <div className={styles.shortcuts}>
                {CHAT_SHORTCUTS.map((shortcut) => {
                  const Icon = SHORTCUT_ICON[shortcut.icon];
                  return (
                    <Link className={styles.shortcut} href={shortcut.href} key={shortcut.title}>
                      <Icon className={styles.shortcutIcon} aria-hidden="true" />
                      <span className={styles.shortcutTitle}>{shortcut.title}</span>
                      <span className={styles.shortcutDescription}>{shortcut.description}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <ol className={styles.messages}>
              {messages.map((message) => (
                <li
                  className={`${styles.row} ${
                    message.role === "user" ? styles.rowUser : styles.rowAssistant
                  }`}
                  key={message.id}
                >
                  <span className={styles.messageRole}>
                    {message.role === "user" ? "나" : "CTRL+AI"}
                  </span>
                  <div className={styles.bubble}>
                    {message.body}
                    {message.suggestion && (
                      <div>
                        <Link className={styles.suggestion} href={message.suggestion.href}>
                          {message.suggestion.label} <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* 입력창은 바닥에 고정됩니다. */}
      <div className={styles.composerArea}>
        <div className={styles.composerInner}>
          <label className="sr-only" htmlFor={inputId}>
            CTRL+AI에게 보낼 메시지
          </label>
          <div className={styles.composer}>
            <textarea
              className={styles.input}
              id={inputId}
              ref={textareaRef}
              rows={1}
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
              placeholder="만들고 싶은 것을 이야기해 보세요"
            />
            <button
              className={styles.send}
              type="button"
              onClick={send}
              disabled={!draft.trim()}
              aria-label="보내기"
            >
              <SendHorizontal size={17} aria-hidden="true" />
            </button>
          </div>
          <p className={styles.hint}>
            Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 지금은 예시 답변만 보여 줍니다 — Claude
            연결은 Phase 2에서 진행됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
