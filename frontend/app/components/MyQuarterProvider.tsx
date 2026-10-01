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

export default function MyQuarterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const { state: userState } = useCurrentUser();
  const signedIn = userState.phase === "authenticated";

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
  }, [signedIn]);

  return (
    <MyQuarterContext.Provider value={{ state, refresh }}>{children}</MyQuarterContext.Provider>
  );
}
