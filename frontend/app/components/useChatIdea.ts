"use client";

/**
 * Chat의 액션 단추가 들고 온 아이디어.
 *
 * "Project Builder에서 시작" / "Video Generator 열기"는
 * `/builder?idea=…&name=…`, `/video?idea=…&name=…`을 엽니다. 목록 화면은
 * 이것을 읽어 새 프로젝트 칸을 미리 채워 둡니다 — 회원은 이름만 보고
 * 만들기를 누르면 됩니다.
 *
 * 읽은 뒤에는 주소에서 지웁니다. 남겨 두면 새로고침할 때마다 같은
 * 아이디어로 칸이 다시 열립니다.
 *
 * 이 훅을 쓰는 화면은 `<Suspense>` 안에 있어야 합니다(`useSearchParams`).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** 이름 칸에 넣을 만큼만. 백엔드의 이름 규칙보다 짧게 둡니다. */
const NAME_LENGTH = 40;

export interface ChatIdea {
  idea: string;
  name: string;
}

export function suggestedName(idea: string, name: string): string {
  const chosen = name.trim() || idea.trim().split("\n")[0];
  return chosen.slice(0, NAME_LENGTH).trim();
}

export function useChatIdea(): ChatIdea {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const idea = params.get("idea") ?? "";
  const name = params.get("name") ?? "";

  useEffect(() => {
    if (idea) router.replace(pathname, { scroll: false });
  }, [idea, pathname, router]);

  return { idea, name: idea ? suggestedName(idea, name) : "" };
}
