"use client";

/**
 * Admin › System — 공지 띠 (admin-consolidation v3 (4)).
 *
 * 모든 화면 맨 위의 한 줄. 오너: "배너 없앨 수도 있는 옵션" — 문구,
 * 「띠 보이기」, 그리고 띠 안의 의견 보내기 링크를 여기서 정합니다. 저장하면
 * 바로 `/api/site`가 새 값을 주고, 다음에 여는 화면부터 모두 따릅니다.
 * 감사 기록에 남습니다.
 *
 * admin-ui-unify: 카드에는 지금 상태만, 바꾸기는 오른쪽 판에서.
 */

import { useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import { formatWhen, getBannerSetting, saveBannerSetting, type BannerSetting } from "@/lib/admin";
import { describeError } from "@/lib/http";

import { PanelSection, Pill, SettingsCard, SidePanel, SwitchRow } from "../components/AdminUI";

export default function BannerPanel() {
  const [setting, setSetting] = useState<BannerSetting | null>(null);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState("");
  const [feedbackLink, setFeedbackLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

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
    return (
      <SettingsCard title="공지 띠">
        {error === null ? <Skeleton /> : <p className="small muted">공지 띠를 불러오지 못했습니다. {error}.</p>}
      </SettingsCard>
    );
  }

  const open = () => {
    take(setting);
    setError(null);
    setSaved(null);
    setEditing(true);
  };

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

  const changedBy = setting.set_at
    ? `${setting.set_by_username || "—"} · ${formatWhen(setting.set_at)}`
    : "아직 바꾼 적 없음 — 베타에서만 기본 문구로 보여요";

  return (
    <SettingsCard title="공지 띠" extra="모든 화면 맨 위의 한 줄">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
        <Pill tone={setting.shown ? "ok" : "off"}>{setting.shown ? "보임" : "숨김"}</Pill>
        <span className="small dim">의견 보내기 링크 {setting.feedback_link ? "있음" : "없음"}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        &ldquo;{setting.text || setting.default_text}&rdquo;
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
        <button className="btn btn-sm" type="button" onClick={open}>
          공지 띠 바꾸기
        </button>
        <span className="small dim">{changedBy}</span>
      </div>

      {editing && (
        <SidePanel
          title="공지 띠"
          subtitle="저장하면 새로 여는 화면부터 따라요 · 감사 기록에 남아요"
          onClose={() => setEditing(false)}
          testId="banner-panel"
          footer={
            <>
              <button className="btn btn-sm" type="button" onClick={() => setEditing(false)}>
                닫기
              </button>
              <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void save()}>
                저장
              </button>
            </>
          }
        >
          <PanelSection title="보이기">
            <SwitchRow
              label="띠 보이기"
              hint="모든 화면 맨 위에"
              checked={shown}
              onChange={setShown}
              testId="banner-shown"
            />
            <SwitchRow
              label="띠에 의견 보내기 링크"
              hint="사이드바의 의견 보내기는 그대로예요"
              checked={feedbackLink}
              onChange={setFeedbackLink}
              testId="banner-feedback"
            />
          </PanelSection>
          <PanelSection title="문구">
            <label className="small" htmlFor="banner-text" style={{ display: "grid", gap: "0.3rem" }}>
              <span>
                문구 <span className="dim">(비우면 기본 문구 · 최대 {setting.max_length}자)</span>
              </span>
              <input
                className="field"
                id="banner-text"
                value={text}
                maxLength={setting.max_length}
                placeholder={setting.default_text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <p className="small dim" style={{ margin: 0 }}>
              {changedBy}
            </p>
          </PanelSection>
          {error !== null && (
            <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
              {error}
            </p>
          )}
          {saved !== null && (
            <p className="small" role="status" style={{ margin: 0 }}>
              {saved}
            </p>
          )}
        </SidePanel>
      )}
    </SettingsCard>
  );
}
