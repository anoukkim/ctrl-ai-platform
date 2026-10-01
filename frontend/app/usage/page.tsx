/**
 * Usage — 이번 분기 사용량.
 *
 * 동아리 지원과 개인 잔액을 분명히 나눠서 보여 줍니다. 개인 충전금은
 * 분기 지원 한도에 포함되지 않습니다. 둘을 한 숫자로 합치면 회원이
 * "지원을 더 받았다"고 오해하게 되므로, 화면에서도 끝까지 분리합니다.
 *
 * 금액의 기준은 원(KRW)입니다. 토큰이나 생성 횟수로 환산하지 않습니다.
 *
 * 내용은 UsageView가 그립니다. 백엔드에서 값을 가져와야 하므로 Client
 * Component이고, 이 파일은 제목만 담당하는 Server Component입니다.
 */

import type { Metadata } from "next";

import UsageView from "./UsageView";

export const metadata: Metadata = {
  title: "Usage — CTRL+AI",
};

export default function UsagePage() {
  return (
    <>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">Usage</h1>
        <p className="page-subtitle">
          이번 분기에 남은 지원 금액입니다. 동아리 지원과 개인 충전금은 따로 계산됩니다.
        </p>
      </header>

      <UsageView />
    </>
  );
}
