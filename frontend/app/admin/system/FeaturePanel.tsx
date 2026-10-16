"use client";

/**
 * Admin › System — 기능 열기 (owner-polish 6).
 *
 * 관리자가 켜고 끄는 스위치. 첫 번째는 **Video Generator**: 영상은
 * 다음다음 분기에 시작하므로 그때까지 회원에게는 잠겨 있고(기본값), 메뉴와
 * 화면은 "다음 분기에 열려요"라고 말합니다. 공급자 연결은 그대로이고
 * 관리자는 잠겨 있어도 들어가 봅니다. 켜고 끈 기록은 감사 기록에 남고,
 * 바꾼 사람과 때가 옆에 보입니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import Skeleton from "@/app/components/Skeleton";
import { formatWhen, listFeatures, setFeature, type FeatureSwitch } from "@/lib/admin";
import { describeError } from "@/lib/http";

import styles from "../admin.module.css";

export default function FeaturePanel() {
  const [features, setFeatures] = useState<FeatureSwitch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFeatures(await listFeatures());
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listFeatures()
      .then((rows) => {
        if (!cancelled) setFeatures(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = (feature: FeatureSwitch) => {
    const opening = !feature.open;
    setConfirmError(null);
    setConfirm({
      title: opening ? `${feature.label}를 회원에게 열까요?` : `${feature.label}를 회원에게 잠글까요?`,
      effect: opening
        ? [
            "이번 분기에 참여하는 회원이 바로 쓸 수 있게 됩니다 — 영상 만들기는 지원금에서 차감됩니다.",
            "메뉴의 자물쇠와 '다음 분기에 열려요' 안내가 사라집니다.",
            "감사 기록에 남습니다.",
          ]
        : [
            "회원은 만들기·수정이 막히고, 메뉴와 화면에 '다음 분기에 열려요'가 보입니다.",
            "이미 만든 영상은 그대로 볼 수 있습니다. 관리자는 계속 들어갈 수 있습니다.",
            "감사 기록에 남습니다.",
          ],
      confirmLabel: opening ? "회원에게 열기" : "잠그기",
      danger: !opening,
      reason: { label: "메모 (선택) — 예: 2027 Q1부터", required: false },
      onConfirm: async (note) => {
        setBusy(true);
        try {
          const changed = await setFeature(feature.key, opening, note);
          await load();
          setSaved(`${changed.label}를 ${changed.open ? "회원에게 열었습니다" : "잠갔습니다"}.`);
          setConfirm(null);
        } catch (caught) {
          setConfirmError(describeError(caught));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <section aria-labelledby="admin-features">
      <h2 className="section-title" id="admin-features">
        기능 열기
        <span className={styles.sectionNote}>회원에게 열어 둘 기능. 바꾸면 감사 기록에 남습니다.</span>
      </h2>

      {features === null && error === null && <Skeleton />}
      {error !== null && <p className="small muted">기능 스위치를 불러오지 못했습니다. {error}.</p>}

      {features !== null && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">기능</th>
                <th scope="col">회원에게</th>
                <th scope="col">메모</th>
                <th scope="col">바꾼 사람</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature) => (
                <tr key={feature.key} data-testid={`feature-${feature.key}`}>
                  <td>{feature.label}</td>
                  <td>
                    <span className={`badge ${feature.open ? "badge-ok" : "badge-muted"}`}>
                      {feature.open ? "열림" : "잠김 · 다음 분기에 열려요"}
                    </span>
                  </td>
                  <td>{feature.note || "—"}</td>
                  <td className="small dim">
                    {feature.set_at
                      ? `${feature.set_by_username || "—"} · ${formatWhen(feature.set_at)}`
                      : "아직 바꾼 적 없음 (기본값)"}
                  </td>
                  <td>
                    <button
                      className={`btn btn-sm ${feature.open ? "btn-danger" : "btn-primary"}`}
                      type="button"
                      disabled={busy}
                      onClick={() => ask(feature)}
                    >
                      {feature.open ? "잠그기" : "회원에게 열기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {saved && (
        <p className="small" role="status">
          {saved}
        </p>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} busy={busy} error={confirmError} />
    </section>
  );
}
