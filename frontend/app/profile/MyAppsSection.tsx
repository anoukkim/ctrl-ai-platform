"use client";

/**
 * Profile › 내가 만든 앱 — 내가 CtrlAIApps에 게시한 앱 (owner-polish 3).
 *
 * 2026-10-16까지는 "준비 중 · 아직 게시한 앱이 없어요"가 모두에게
 * 고정으로 보였습니다 — 게시가 생긴 뒤에도 그대로여서, 게시한 앱이 있는
 * 회원에게 거짓말이 됐습니다. 이제 `GET /api/apps/mine`을 읽어 CtrlAIApps와
 * 같은 카드로 보여 줍니다. 다른 사람의 앱은 절대 섞이지 않습니다.
 */

import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import Skeleton from "@/app/components/Skeleton";
import AppCard from "@/app/ctrlaistore/AppCard";
import gridStyles from "@/app/ctrlaistore/ctrlaistore.module.css";
import { listMyApps, type AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";

type State =
  | { phase: "loading" }
  | { phase: "ready"; apps: AppListing[] }
  | { phase: "error"; message: string };

export default function MyAppsSection() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    listMyApps()
      .then((apps) => {
        if (!cancelled) setState({ phase: "ready", apps });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card" aria-labelledby="my-apps-title">
      <h2 className="section-title" id="my-apps-title">
        내가 만든 앱
        {state.phase === "ready" && <span className="badge badge-muted">{state.apps.length}개</span>}
      </h2>

      {state.phase === "loading" && <Skeleton label="게시한 앱을 불러오는 중…" />}

      {state.phase === "error" && (
        <p className="small muted" role="alert">
          게시한 앱을 불러오지 못했습니다. {state.message}.
        </p>
      )}

      {state.phase === "ready" && state.apps.length === 0 && (
        <EmptyState
          compact
          icon={LayoutGrid}
          title="아직 게시한 앱이 없어요"
          text="Project Builder에서 만든 앱을 'CtrlAIApps에 게시'하면 여기에 모여요."
          action={{ label: "앱 만들러 가기", href: "/builder" }}
        />
      )}

      {state.phase === "ready" && state.apps.length > 0 && (
        <div className={gridStyles.grid} data-testid="my-apps-grid">
          {state.apps.map((app) => (
            <AppCard app={app} key={app.id} />
          ))}
        </div>
      )}
    </section>
  );
}
