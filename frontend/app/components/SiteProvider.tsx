"use client";

/**
 * 이 배포의 정보(`GET /api/site`)를 한 번 읽어 아래로 내려 줍니다.
 *
 * 로그인과 상관없이 읽습니다. 회원가입 화면의 저장 위치 안내와 베타
 * 배너는 로그인하기 전에도 보여야 하기 때문입니다.
 *
 * 공지 띠가 보이면 `<html data-beta>`를 붙입니다. 띠 높이(`--banner-h`)가
 * 거기에 매달려 있어, 화면 높이를 꽉 채우는 Chat과 작업 공간이 띠만큼
 * 줄어듭니다. 관리자가 띠를 숨기면(admin-consolidation v3 (4)) 높이도 0이
 * 됩니다.
 */

import { createContext, useContext, useEffect, useState } from "react";

import { UNKNOWN_SITE, fetchSite, siteBanner, type SiteInfo } from "@/lib/site";

const SiteContext = createContext<SiteInfo>(UNKNOWN_SITE);
/** 백엔드의 답을 받았는지(또는 못 받는다고 알았는지). 로그인 화면이 Google
 *  버튼과 비밀번호 칸 중 무엇을 보여 줄지 정하기 전에 기다릴 때 씁니다.
 *  Provider 바깥(화면 하나만 그리는 테스트)에서는 이미 받은 것으로 봅니다. */
const SiteLoadedContext = createContext<boolean>(true);

export function useSite(): SiteInfo {
  return useContext(SiteContext);
}

export function useSiteLoaded(): boolean {
  return useContext(SiteLoadedContext);
}

export default function SiteProvider({ children }: { children: React.ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(UNKNOWN_SITE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSite()
      .then((info) => {
        if (!cancelled) setSite(info);
      })
      .catch(() => {
        /* 못 읽으면 아무것도 덧붙이지 않습니다 */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bannerShown = siteBanner(site).shown;
  useEffect(() => {
    const root = document.documentElement;
    if (bannerShown) root.dataset.beta = "";
    else delete root.dataset.beta;
  }, [bannerShown]);

  return (
    <SiteContext.Provider value={site}>
      <SiteLoadedContext.Provider value={loaded}>{children}</SiteLoadedContext.Provider>
    </SiteContext.Provider>
  );
}
