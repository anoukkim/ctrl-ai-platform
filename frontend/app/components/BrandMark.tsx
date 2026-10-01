/**
 * CTRL+AI 로고 표식.
 *
 * 이름 가운데의 `+`를 그대로 네모 안에 넣은 모양입니다. 글자 "AI"를 쓰던
 * 자리를 대신합니다.
 *
 * 그라데이션은 이 표식에서만 씁니다. 다른 화면 요소에는 쓰지 않습니다.
 * 회사 로고와는 무관한 자체 표식입니다.
 *
 * Server Component입니다. 상태도 효과도 없으니 "use client"가 필요 없고,
 * 그만큼 브라우저로 내려가는 자바스크립트도 없습니다.
 */

export default function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // 이름 옆에 늘 CTRL+AI 글자가 함께 있으므로 표식 자체는 읽어 줄
      // 필요가 없습니다.
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ctrlai-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--logo-from)" />
          <stop offset="1" stopColor="var(--logo-to)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#ctrlai-mark)" />
      {/* 가운데 + 기호. 획 끝을 둥글게 해 네모의 둥근 모서리와 맞춥니다. */}
      <path
        d="M16 9.5V22.5M9.5 16H22.5"
        stroke="var(--on-accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
