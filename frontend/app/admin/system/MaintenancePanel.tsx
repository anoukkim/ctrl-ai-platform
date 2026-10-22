"use client";

/**
 * Admin › System › 유지보수 (admin-consolidation v3) — 가끔 누르는 일 두 가지.
 *
 * - 게시된 앱 썸네일 다시 만들기: Community › 앱의 썸네일 만들기로 (서버
 *   썸네일이 켜져 있으면 서버가, 아니면 이 브라우저가 찍어요).
 * - 환율 지금 새로 고침: Frankfurter(ECB, 무료)에서 오늘 환율을 받아 와요.
 *   직접 적어 둔 환율이 있으면 그대로 두고 자동 반영을 다시 켜요 — 환율
 *   칸과 같은 동작이고 감사 기록에 남아요.
 */

import Link from "next/link";
import { useState } from "react";

import { refreshExchangeRate } from "@/lib/admin";
import { describeError } from "@/lib/http";

import { ItemList, ItemRow, SettingsCard } from "../components/AdminUI";
import { tabHref } from "../sections";

export default function MaintenancePanel() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setNote(null);
    try {
      const next = await refreshExchangeRate();
      const rate = next.exchange_rate?.krw_per_usd;
      setNote(rate ? `환율을 새로 받았어요 — 1달러 = ${Number(rate).toLocaleString()}원` : "환율을 새로 받았어요.");
    } catch (caught) {
      setNote(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard title="유지보수" extra="가끔 누르는 일">
      <ItemList testId="maintenance">
        <ItemRow
          title="앱 썸네일 다시 만들기"
          sub="Community › 앱의 썸네일 만들기에서"
          action={
            <Link className="btn btn-sm" href={tabHref("community", "apps")}>
              열기
            </Link>
          }
        />
        <ItemRow
          title="환율 지금 새로 고침"
          sub="Frankfurter(ECB) · 감사 기록에 남아요"
          action={
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void refresh()}>
              {busy ? "받는 중…" : "새로 고침"}
            </button>
          }
        />
      </ItemList>
      {note && (
        <p className="small muted" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
    </SettingsCard>
  );
}
