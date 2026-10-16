"use client";

/**
 * CtrlAIApps 목록과 검색 (ctrlaiapps-publish).
 *
 * 회원들이 Project Builder에서 게시한 앱입니다. 예시(목업) 앱은 모두
 * 지웠습니다 — 아직 아무도 게시하지 않았으면 빈 화면이 그렇게 말합니다.
 * 카드마다 이름 · 짧은 설명 · 만든 사람 · "v5 · 3일 전 업데이트" · 업데이트
 * 메모(있으면).
 */

import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import ListToolbar from "@/app/components/ListToolbar";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import Skeleton from "@/app/components/Skeleton";
import { listApps, type AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";

import AppCard from "./AppCard";
import styles from "./ctrlaistore.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; apps: AppListing[] }
  | { phase: "error"; message: string };

export default function AppGrid({ onCount }: { onCount?: (count: number) => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    listApps()
      .then((apps) => {
        setState({ phase: "ready", apps });
        onCount?.(apps.length);
      })
      .catch((error: unknown) => setState({ phase: "error", message: describeError(error) }));
  }, [onCount]);

  if (state.phase === "loading") return <Skeleton label="앱을 불러오는 중…" />;
  if (state.phase === "error") {
    return (
      <p className="small muted" role="alert">
        앱 목록을 불러오지 못했습니다. {state.message}.
      </p>
    );
  }
  if (state.apps.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="아직 게시된 앱이 없어요"
        text="Project Builder에서 앱을 만들고 'CtrlAIApps에 게시'를 누르면 여기에 올라와요. 첫 번째 앱의 주인공이 되어 보세요."
        action={{ label: "Project Builder로 가기", href: "/builder" }}
      />
    );
  }

  const visible = state.apps.filter((app) =>
    matchesQuery(query, app.name, app.description, app.author_name, app.publish_note),
  );

  return (
    <>
      <ListToolbar
        label={
          <p className={styles.sectionLabel}>
            게시된 앱 <span className={styles.count}>{state.apps.length}개</span>
          </p>
        }
        search={
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="앱 이름, 설명, 만든 사람으로 검색"
            resultCount={visible.length}
            totalCount={state.apps.length}
            grow
          />
        }
      />

      {visible.length === 0 ? (
        <div className={styles.searchEmpty}>
          <p>검색 결과가 없습니다. 다른 낱말로 찾아보세요.</p>
          <button className="btn btn-sm" type="button" onClick={() => setQuery("")}>
            검색 조건 지우기
          </button>
        </div>
      ) : (
        <div className={styles.grid} data-testid="app-grid">
          {visible.map((app) => (
            <AppCard app={app} key={app.id} />
          ))}
        </div>
      )}
    </>
  );
}
