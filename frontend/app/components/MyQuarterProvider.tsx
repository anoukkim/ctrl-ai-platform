"use client";

/**
 * 이번 분기 상태를 한 번만 불러와 아래로 내려 줍니다.
 *
 * 사이드바, Profile, Usage가 모두 같은 값을 보여 줘야 하는데, 화면마다
 * 따로 부르면 서로 다른 순간의 값을 보여 줄 수 있습니다. Phase 1a 이전에
 * 목업 데이터가 Profile의 실제 값과 어긋나 보였던 것과 같은 문제입니다.
 *
 * 로그인하지 않았으면 아무것도 부르지 않습니다.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { getMyQuarter, type MyQuarterStatus } from "@/lib/quarters";

import { useCurrentUser } from "./CurrentUserProvider";

type State =
  | { phase: "loading" }
  | { phase: "ready"; quarter: MyQuarterStatus }
  | { phase: "error" };

interface Value {
  state: State;
  refresh: () => Promise<void>;
}

const MyQuarterContext = createContext<Value | null>(null);

export function useMyQuarter(): Value {
  const value = useContext(MyQuarterContext);
  if (value === null) {
    throw new Error("useMyQuarter는 MyQuarterProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}

/**
 * 지금 새로 만들 수 있는지.
 *
 * 세 작업 화면과 두 목록 화면이 모두 같은 판단을 해야 해서 한곳에 둡니다.
 * 각자 `quarter.may_create`를 꺼내 쓰면 "아직 불러오는 중"을 어떻게 볼지가
 * 화면마다 달라지고, 멀쩡히 참여 중인 회원에게 잠깐 잠긴 화면이 보입니다.
 *
 * 불러오는 중이거나 실패했으면 **허용 쪽으로** 답합니다. 이것은 보안
 * 판단이 아니라 화면 표시이고, 실제 차단은 백엔드가 요청마다 합니다.
 * 확실하지 않을 때 잠가 버리면, 네트워크가 잠깐 느렸다는 이유로 참여 중인
 * 회원의 작업을 막게 됩니다.
 */
export function useMayCreate(): boolean {
  const { state } = useMyQuarter();
  return state.phase !== "ready" || state.quarter.may_create;
}

export default function MyQuarterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const { state: userState } = useCurrentUser();
  const signedIn = userState.phase === "authenticated";
  // 누가 로그인했는지까지 봅니다. "로그인했는가"만 보면 계정을 바꿔도
  // 값이 그대로 남아, 사이드바가 이전 사람의 참여 상태를 보여 줍니다.
  const userId = userState.phase === "authenticated" ? userState.user.id : null;

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      setState({ phase: "ready", quarter: await getMyQuarter() });
    } catch {
      setState({ phase: "error" });
    }
  }, [signedIn]);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    getMyQuarter()
      .then((quarter) => {
        if (!cancelled) setState({ phase: "ready", quarter });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, userId]);

  return (
    <MyQuarterContext.Provider value={{ state, refresh }}>{children}</MyQuarterContext.Provider>
  );
}
