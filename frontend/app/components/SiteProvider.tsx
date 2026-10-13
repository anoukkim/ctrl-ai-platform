"use client";

/**
 * 이 배포의 정보(`GET /api/site`)를 한 번 읽어 아래로 내려 줍니다.
 *
 * 로그인과 상관없이 읽습니다. 회원가입 화면의 저장 위치 안내와 베타
 * 배너는 로그인하기 전에도 보여야 하기 때문입니다.
 *
 * 베타라면 `<html data-beta>`를 붙입니다. 배너 높이(`--banner-h`)가
 * 거기에 매달려 있어, 화면 높이를 꽉 채우는 Chat과 작업 공간이 배너만큼
 * 줄어듭니다.
 */

import { createContext, useContext, useEffect, useState } from "react";

import { UNKNOWN_SITE, fetchSite, type SiteInfo } from "@/lib/site";

const SiteContext = createContext<SiteInfo>(UNKNOWN_SITE);

export function useSite(): SiteInfo {
  return useContext(SiteContext);
}

export default function SiteProvider({ children }: { children: React.ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(UNKNOWN_SITE);

  useEffect(() => {
    let cancelled = false;
    fetchSite()
      .then((info) => {
        if (!cancelled) setSite(info);
      })
      .catch(() => {
        /* 못 읽으면 아무것도 덧붙이지 않습니다 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (site.is_beta) root.dataset.beta = "";
    else delete root.dataset.beta;
  }, [site.is_beta]);

  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}
