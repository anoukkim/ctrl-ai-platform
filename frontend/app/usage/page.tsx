/**
 * Usage — 이번 분기 사용량.
 *
 * 회원이 보는 돈은 동아리 지원 지갑 하나입니다. 개인 충전을 받지 않는
 * 동안(personal-topup-off, 2026-10-14)은 개인 잔액 구역이 통째로 보이지
 * 않고, 켜져 있을 때도 지원금과 끝까지 분리합니다 — 합치면 회원이
 * "지원을 더 받았다"고 오해합니다.
 *
 * 금액의 기준은 원(KRW)입니다. 토큰이나 생성 횟수로 환산하지 않습니다.
 *
 * 내용은 UsageView가 그립니다. 백엔드에서 값을 가져와야 하므로 Client
 * Component이고, 이 파일은 제목만 담당하는 Server Component입니다.
 */

import type { Metadata } from "next";

import PageHeader from "@/app/components/PageHeader";

import UsageView from "./UsageView";

export const metadata: Metadata = {
  title: "Usage — CTRL+AI",
};

export default function UsagePage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Usage"
        subtitle="이번 분기에 남은 동아리 지원 금액과 쓴 내역입니다."
      />

      <UsageView />
    </>
  );
}
