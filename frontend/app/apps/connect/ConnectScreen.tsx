"use client";

/**
 * 앱 연결 (app-platform P2) — 회원 앱이 "CTRL+AI로 로그인"을 눌렀을 때
 * 새 창으로 열리는 화면.
 *
 * 앱 이름, 만든 사람, 이 앱이 할 수 있는 일, AI 1회 비용을 보여 주고
 * [허용] [거절]. 허용하면 백엔드가 동의를 남기고 한 번만 쓰는 코드를
 * 만들어 주며, 이 창은 그 코드를 들고 앱 주소의 callback으로 갑니다 —
 * 그 다음은 앱 쪽이 처리하고 창을 닫습니다. 거절하면 앱에게 알리고
 * 창을 닫습니다.
 *
 * 주소의 `app`과 `state`는 앱의 셸이 넣은 값이라 믿지 않고 모양만
 * 거릅니다. 진짜 확인은 백엔드가 합니다.
 */

import { useEffect, useState } from "react";

import BrandMark from "@/app/components/BrandMark";
import { useSite } from "@/app/components/SiteProvider";
import styles from "@/app/login/auth.module.css";
import { describeError } from "@/lib/http";
import { SLUG_PATTERN, allowApp, getConnectInfo, type ConnectInfo } from "@/lib/app-platform";

import local from "./connect.module.css";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; info: ConnectInfo }
  | { kind: "going" }
  | { kind: "denied" };

function readParams(): { slug: string; state: string } {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("app") ?? "";
  const state = params.get("state") ?? "";
  return {
    slug: SLUG_PATTERN.test(slug) ? slug : "",
    state: /^[A-Za-z0-9_-]{16,100}$/.test(state) ? state : "",
  };
}

export default function ConnectScreen() {
  const site = useSite();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<{ slug: string; state: string } | null>(null);

  useEffect(() => {
    const read = readParams();
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setParams(read);
      if (!read.slug || !read.state) {
        setPhase({ kind: "error", message: "연결 주소가 올바르지 않아요. 앱에서 다시 로그인을 눌러 주세요." });
        return;
      }
      getConnectInfo(read.slug)
        .then((info) => live && setPhase({ kind: "ready", info }))
        .catch((caught) => live && setPhase({ kind: "error", message: describeError(caught) }));
    });
    return () => {
      live = false;
    };
  }, []);

  async function allow() {
    if (!params || busy) return;
    setBusy(true);
    try {
      const { redirect_url } = await allowApp(params.slug, params.state);
      setPhase({ kind: "going" });
      window.location.assign(redirect_url);
    } catch (caught) {
      setPhase({ kind: "error", message: describeError(caught) });
      setBusy(false);
    }
  }

  function deny() {
    // 앱의 셸에게만 알립니다(앱 주소의 출처로).
    try {
      const origin = site.apps_base_url ? new URL(site.apps_base_url).origin : null;
      if (origin && window.opener) window.opener.postMessage({ ctrlai: "login", ok: false }, origin);
    } catch {
      /* 앱 창이 이미 닫혔어요 */
    }
    setPhase({ kind: "denied" });
    window.setTimeout(() => window.close(), 1500);
  }

  return (
    <div className={`${styles.screen} ${styles.screenLogin}`}>
      <div className={`${styles.card} ${local.card}`}>
        <span className={styles.brand}>
          <BrandMark size={18} variant="glyph" />
          CTRL+AI
        </span>

        {phase.kind === "loading" && <p className={local.muted}>불러오는 중…</p>}

        {phase.kind === "error" && (
          <>
            <h1 className={styles.title}>연결할 수 없어요</h1>
            <p className={local.error} role="alert">
              {phase.message}
            </p>
          </>
        )}

        {phase.kind === "denied" && (
          <>
            <h1 className={styles.title}>거절했어요</h1>
            <p className={local.muted}>앱은 내 정보를 받지 않았어요. 이 창은 닫아도 돼요.</p>
          </>
        )}

        {phase.kind === "going" && <p className={local.muted}>앱으로 돌아가는 중…</p>}

        {phase.kind === "ready" && (
          <>
            <div>
              <h1 className={styles.title}>
                &lsquo;{phase.info.name}&rsquo;에 연결할까요?
              </h1>
              <p className={local.muted}>
                만든 사람: {phase.info.owner_name}
                {phase.info.mode === "preview" ? " · Builder 미리보기" : ""}
              </p>
            </div>

            <div>
              <p className={local.label}>이 앱이 할 수 있는 일</p>
              <ul className={local.scopes}>
                {phase.info.scopes.map((scope) => (
                  <li key={scope.key}>
                    {scope.label}
                    {scope.key === "ai" && (
                      <span className={local.cost}>
                        {" "}
                        · 1회 약 {phase.info.ai_estimate_krw ?? "?"}원 (최대 {phase.info.call_cap_krw}원)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <p className={local.note}>
              앱은 이메일, 아이디, 지원금 잔액을 볼 수 없어요. 언제든 Profile › 연결된 앱에서 연결을 끊을 수 있어요.
            </p>

            <div className={local.actions}>
              <button className="btn" type="button" onClick={deny} disabled={busy}>
                거절
              </button>
              <button className="btn btn-primary" type="button" onClick={allow} disabled={busy} autoFocus>
                {busy ? "연결하는 중…" : "허용"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
