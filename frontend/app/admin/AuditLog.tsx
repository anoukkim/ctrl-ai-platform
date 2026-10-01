"use client";

/**
 * Admin — 감사 로그 (읽기 전용).
 *
 * 관리자가 회원 자격이나 지원금을 바꿀 때마다 한 줄이 남습니다. 누가,
 * 무엇을, 언제 바꿨는지가 기록되고, 이 화면에서는 읽기만 할 수 있습니다.
 * 고칠 수 있는 기록은 기록이 아니기 때문에 수정·삭제 기능은 아예 두지
 * 않았습니다.
 *
 * 아래 "사용량 시뮬레이션"은 개발 환경에서만 보입니다. 제공자를 붙이기
 * 전에 Usage 화면과 이 로그가 실제로 움직이는지 확인하기 위한 것입니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import { listAuditLog, simulateUsage, type AuditEntry } from "@/lib/quarters";

import styles from "./admin.module.css";

/** 2026-10-01T05:12:33Z → 2026.10.01 14:12 (현지 시각) */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso.slice(0, 16).replace("T", " ");
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    try {
      setEntries(await listAuditLog());
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listAuditLog()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visible = (entries ?? []).filter((entry) =>
    matchesQuery(query, entry.summary, entry.actor_username, entry.action_label, entry.target_label),
  );

  return (
    <>
      <SimulateUsage onDone={() => void reload()} />

      <section>
        <h2 className="section-title">
          감사 로그
          <span className={styles.applicationCounts}>읽기 전용 · 수정하거나 지울 수 없습니다</span>
        </h2>

        {error && (
          <div className="card">
            <p className="small muted">감사 로그를 불러오지 못했습니다. {error}.</p>
          </div>
        )}

        {!error && entries === null && <p className="small muted">불러오는 중…</p>}

        {!error && entries !== null && entries.length === 0 && (
          <div className="card">
            <p className="small muted">
              아직 기록이 없습니다. 회원 참여 상태나 지원금을 바꾸면 여기에 남습니다.
            </p>
          </div>
        )}

        {!error && entries !== null && entries.length > 0 && (
          <>
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="내용, 관리자, 대상으로 검색"
              resultCount={visible.length}
              totalCount={entries.length}
            />

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">시각</th>
                    <th scope="col">한 사람</th>
                    <th scope="col">작업</th>
                    <th scope="col">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <tr key={entry.id}>
                      <td className={styles.auditWhen}>{formatWhen(entry.created_at)}</td>
                      <td className={styles.memberHandle}>@{entry.actor_username || "—"}</td>
                      <td>
                        <span className="badge badge-muted">{entry.action_label}</span>
                      </td>
                      <td>{entry.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/**
 * 개발 환경 전용: 제공자 없이 예산을 써 보는 버튼.
 *
 * 실제 차감 코드(`charge()`)를 그대로 지나가므로, 여기서 눌러 본 결과는
 * 나중에 Claude나 Higgsfield를 붙였을 때와 같은 경로를 탑니다. 배포
 * 환경에서는 백엔드가 404를 돌려주고, 이 카드는 스스로 숨습니다.
 */
function SimulateUsage({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("5000");
  const [category, setCategory] = useState<"build" | "video">("build");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const event = await simulateUsage({
        category,
        amount_krw: Number(amount.replaceAll(",", "")) || 0,
        provider: category === "build" ? "claude" : "higgsfield",
      });
      setMessage(`${event.charged_krw.toLocaleString("ko-KR")}원을 차감했습니다.`);
      onDone();
    } catch (caught) {
      const text = describeError(caught);
      // 배포 환경에서는 이 엔드포인트가 없는 것처럼 404가 옵니다.
      if (text.includes("404") || text.includes("Not Found")) {
        setUnavailable(true);
      } else {
        setMessage(text);
      }
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) return null;

  return (
    <section>
      <h2 className="section-title">
        사용량 시뮬레이션
        <span className={styles.applicationCounts}>개발 환경 전용</span>
      </h2>
      <div className="card">
        <p className="small muted" style={{ marginBottom: "0.7rem" }}>
          제공자를 부르지 않고 내 예산에서 금액을 차감합니다. 실제 차감 코드를 그대로 지나가므로
          Usage 화면과 아래 감사 로그가 함께 바뀝니다.
        </p>
        <div className={styles.simulateRow}>
          <select
            className="field"
            value={category}
            onChange={(event) => setCategory(event.target.value as "build" | "video")}
            aria-label="구분"
          >
            <option value="build">Build (Claude)</option>
            <option value="video">Video (Higgsfield)</option>
          </select>
          <input
            className="field"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="금액 (원)"
            placeholder="5000"
          />
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void run()} disabled={busy}>
            {busy ? "차감 중…" : "사용해 보기"}
          </button>
        </div>
        {message && (
          <p className="small dim" style={{ marginTop: "0.6rem" }} role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
