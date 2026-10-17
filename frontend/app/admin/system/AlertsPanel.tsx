"use client";

/**
 * Admin › System — 알림 기준 (admin-consolidation v3 (4)).
 *
 * Dashboard의 자동 알림이 어디서 울릴지: 지원금 사용률(Members의 주황도
 * 같은 기준), Anthropic 이번 달 예산, 마지막 백업 뒤로 지난 시간. 범위는
 * 백엔드가 정하고 지킵니다. 감사 기록에 남습니다.
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
    return error === null ? <Skeleton /> : <p className="small muted">알림 기준을 불러오지 못했습니다. {error}.</p>;
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

  return (
    <div data-testid="alerts-panel" style={{ display: "grid", gap: "0.75rem", maxWidth: "32rem" }}>
      {FIELDS.map((field) => {
        const [low, high] = setting.ranges[field.key];
        return (
          <label
            key={field.key}
            className="small"
            htmlFor={`alert-${field.key}`}
            style={{ display: "grid", gridTemplateColumns: "1fr 6rem auto", gap: "0.5rem", alignItems: "center" }}
          >
            <span>
              {field.label}{" "}
              <span className="dim">
                ({low}–{high})
              </span>
            </span>
            <input
              className="field"
              id={`alert-${field.key}`}
              type="number"
              inputMode="numeric"
              min={low}
              max={high}
              value={draft[field.key]}
              onChange={(event) => setDraft((value) => ({ ...value, [field.key]: event.target.value }))}
            />
            <span className="dim">{field.unit}</span>
          </label>
        );
      })}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void save()}>
          저장
        </button>
        <span className="small dim">
          {setting.set_at ? `${setting.set_by_username || "—"} · ${formatWhen(setting.set_at)}` : "기본값 (80% · 80% · 48시간)"}
        </span>
      </div>
      {error !== null && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="small" role="status">
          저장했어요. Dashboard 알림이 이 기준을 따라요.
        </p>
      )}
    </div>
  );
}
