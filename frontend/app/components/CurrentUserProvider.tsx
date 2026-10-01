"use client";

/**
 * 로그인한 회원을 한곳에서 들고 있습니다.
 *
 * 화면마다 `/api/auth/me`를 부르지 않도록 여기서 한 번만 확인하고
 * 아래로 내려 줍니다. 로그인하지 않은 사람은 로그인 화면으로 보냅니다.
 *
 * 주의: 이 리다이렉트는 편의 기능일 뿐 보안 장치가 아닙니다. 실제 권한은
 * 백엔드가 요청마다 다시 확인합니다. 브라우저에서 숨기는 것만으로는
 * 아무것도 막지 못합니다.
 */

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { fetchCurrentUser, logout as logoutRequest, type CurrentUser } from "@/lib/auth";

/** 로그인하지 않아도 볼 수 있는 화면. */
export const PUBLIC_PATHS = ["/login", "/signup"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

type State =
  | { phase: "loading" }
  | { phase: "authenticated"; user: CurrentUser }
  | { phase: "anonymous" };

interface CurrentUserValue {
  state: State;
  /** 로그인/회원가입 직후 다시 확인합니다. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserValue | null>(null);

export function useCurrentUser(): CurrentUserValue {
  const value = useContext(CurrentUserContext);
  if (value === null) {
    throw new Error("useCurrentUser는 CurrentUserProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}

export default function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const router = useRouter();
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const user = await fetchCurrentUser();
      setState({ phase: "authenticated", user });
    } catch {
      // 401이든 네트워크 오류든 로그인하지 않은 것으로 봅니다.
      setState({ phase: "anonymous" });
    }
  }, []);

  // 첫 확인. 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((user) => {
        if (!cancelled) setState({ phase: "authenticated", user });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "anonymous" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 로그인하지 않았다면 로그인 화면으로.
  useEffect(() => {
    if (state.phase === "anonymous" && !isPublicPath(pathname)) {
      router.replace("/login");
    }
  }, [state.phase, pathname, router]);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // 요청이 실패해도 화면에서는 로그아웃 상태로 둡니다.
      setState({ phase: "anonymous" });
      router.replace("/login");
    }
  }, [router]);

  return (
    <CurrentUserContext.Provider value={{ state, refresh: load, signOut }}>
      {children}
    </CurrentUserContext.Provider>
  );
}
