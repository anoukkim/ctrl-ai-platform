"use client";

/**
 * Admin › System — 공지 띠 (admin-consolidation v3 (4)).
 *
 * 모든 화면 맨 위의 한 줄. 오너: "배너 없앨 수도 있는 옵션" — 문구,
 * 「띠 보이기」, 그리고 띠 안의 의견 보내기 링크를 여기서 정합니다. 저장하면
 * 바로 `/api/site`가 새 값을 주고, 다음에 여는 화면부터 모두 따릅니다.
 * 감사 기록에 남습니다.
 */

import { useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import { formatWhen, getBannerSetting, saveBannerSetting, type BannerSetting } from "@/lib/admin";
import { describeError } from "@/lib/http";

export default function BannerPanel() {
  const [setting, setSetting] = useState<BannerSetting | null>(null);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState("");
  const [feedbackLink, setFeedbackLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const take = (value: BannerSetting) => {
    setSetting(value);
    setShown(value.shown);
    setText(value.text === value.default_text ? "" : value.text);
    setFeedbackLink(value.feedback_link);
  };

  useEffect(() => {
    let cancelled = false;
    getBannerSetting()
      .then((value) => {
        if (!cancelled) take(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (setting === null) {
    return error === null ? <Skeleton /> : <p className="small muted">공지 띠를 불러오지 못했습니다. {error}.</p>;
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const value = await saveBannerSetting({ shown, text: text.trim(), feedback_link: feedbackLink });
      take(value);
      setSaved(value.shown ? "저장했어요. 새로 여는 화면부터 이 띠가 보여요." : "저장했어요. 띠를 숨겼어요.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="banner-panel" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
      <label className="small" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={shown}
          checked={shown}
          onChange={(event) => setShown(event.target.checked)}
          data-testid="banner-shown"
        />
        띠 보이기 — 모든 화면 맨 위에
      </label>
      <label className="small" htmlFor="banner-text" style={{ display: "grid", gap: "0.25rem" }}>
        문구 (비우면 기본 문구)
        <input
          className="field"
          id="banner-text"
          value={text}
          maxLength={setting.max_length}
          placeholder={setting.default_text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="small" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={feedbackLink}
          checked={feedbackLink}
          onChange={(event) => setFeedbackLink(event.target.checked)}
          data-testid="banner-feedback"
        />
        띠에 의견 보내기 링크 (사이드바의 의견 보내기는 그대로예요)
      </label>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void save()}>
          저장
        </button>
        <span className="small dim">
          {setting.set_at
            ? `${setting.set_by_username || "—"} · ${formatWhen(setting.set_at)}`
            : "아직 바꾼 적 없음 — 베타에서만 기본 문구로 보여요"}
        </span>
      </div>
      {error !== null && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      {saved !== null && (
        <p className="small" role="status">
          {saved}
        </p>
      )}
    </div>
  );
}
