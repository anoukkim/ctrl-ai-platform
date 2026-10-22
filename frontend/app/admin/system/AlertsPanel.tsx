"use client";

/**
 * Admin › System — 알림 기준 (admin-consolidation v3 (4)).
 *
 * Dashboard의 자동 알림이 어디서 울릴지: 지원금 사용률(Members의 주황도
 * 같은 기준), Anthropic 이번 달 예산, 마지막 백업 뒤로 지난 시간. 범위는
 * 백엔드가 정하고 지킵니다. 감사 기록에 남습니다.
 *
 * admin-ui-unify: 설정 카드 — `NumField` 세 칸과 `SaveBar`.
 */

import { useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import {
  formatWhen,
  getAlertThresholds,
  saveAlertThresholds,
  type AlertThresholdSetting,
  type AlertThresholds,
} from "@/lib/admin";
import { describeError } from "@/lib/http";

import { NumField, SaveBar, SettingsCard } from "../components/AdminUI";

import { useAdminQuarterOptional } from "../AdminQuarterProvider";

const FIELDS: { key: keyof AlertThresholds; label: string; unit: string }[] = [
  { key: "wallet_pct", label: "지원금을 이만큼 넘게 쓴 회원", unit: "%" },
  { key: "month_pct", label: "Anthropic 이번 달 예산", unit: "%" },
  { key: "backup_hours", label: "마지막 백업 뒤로", unit: "시간" },
];

export default function AlertsPanel() {
  const quarter = useAdminQuarterOptional();
  const [setting, setSetting] = useState<AlertThresholdSetting | null>(null);
  const [draft, setDraft] = useState<Record<keyof AlertThresholds, string>>({
    wallet_pct: "",
    month_pct: "",
    backup_hours: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const take = (value: AlertThresholdSetting) => {
    setSetting(value);
    setDraft({
      wallet_pct: String(value.wallet_pct),
      month_pct: String(value.month_pct),
      backup_hours: String(value.backup_hours),
    });
  };

  useEffect(() => {
    let cancelled = false;
    getAlertThresholds()
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
      <SettingsCard title="알림 기준">
        {error === null ? <Skeleton /> : <p className="small muted">알림 기준을 불러오지 못했습니다. {error}.</p>}
      </SettingsCard>
    );
  }

  const save = async () => {
    const bad = FIELDS.find((field) => {
      const value = Number(draft[field.key]);
      const [low, high] = setting.ranges[field.key];
      return draft[field.key].trim() === "" || !Number.isInteger(value) || value < low || value > high;
    });
    if (bad) {
      const [low, high] = setting.ranges[bad.key];
      setError(`${bad.label}: ${low}–${high} 사이의 정수로 적어 주세요.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = await saveAlertThresholds({
        wallet_pct: Number(draft.wallet_pct),
        month_pct: Number(draft.month_pct),
        backup_hours: Number(draft.backup_hours),
      });
      take(value);
      setSaved(true);
      void quarter?.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const changed = FIELDS.filter((field) => draft[field.key] !== String(setting[field.key])).length;

  return (
    <SettingsCard title="알림 기준" extra="Dashboard 알림이 울리는 곳">
      <div data-testid="alerts-panel" style={{ display: "grid", gap: "0.6rem" }}>
        {FIELDS.map((field) => {
          const [low, high] = setting.ranges[field.key];
          return (
            <NumField
              key={field.key}
              label={field.label}
              hint={`${low}–${high}`}
              unit={field.unit}
              min={low}
              max={high}
              value={draft[field.key]}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
            />
          );
        })}
        <SaveBar
          note={
            changed > 0
              ? `바뀐 값 ${changed}개`
              : setting.set_at
                ? `${setting.set_by_username || "—"} · ${formatWhen(setting.set_at)}`
                : "기본값 (80% · 80% · 48시간)"
          }
        >
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void save()}>
            저장
          </button>
        </SaveBar>
        {error !== null && (
          <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
            {error}
          </p>
        )}
        {saved && (
          <p className="small" role="status" style={{ margin: 0 }}>
            저장했어요. Dashboard 알림이 이 기준을 따라요.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
