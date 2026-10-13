import type { NextConfig } from "next";

/**
 * 백엔드 주소. 브라우저가 아니라 Next.js 서버가 쓰는 값이므로
 * `NEXT_PUBLIC_`을 붙이지 않습니다. 브라우저에는 노출되지 않습니다.
 *
 * **빌드할 때 정해집니다.** rewrites는 `next build`가 결과물에 적어
 * 넣으므로, 배포 이미지에서는 Dockerfile의 빌드 인자(`http://api:8000`)가
 * 이 값입니다. 서버의 .env를 바꿔서는 바뀌지 않습니다.
 */
const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  /**
   * 배포용 이미지(frontend/Dockerfile)는 `.next/standalone`의 작은 서버만
   * 담습니다. node_modules 전체를 이미지에 넣지 않아도 됩니다. 개발 서버
   * (`npm run dev`)에는 영향이 없습니다.
   */
  output: "standalone",

  /**
   * 개발 중에만 보이는 Next.js 표시기를 끕니다.
   *
   * 화면 왼쪽 아래에 떠 있어 사이드바 바닥의 로그아웃 버튼을 가립니다.
   * 빌드 결과에는 영향이 없고 개발 화면에서만 사라집니다.
   */
  devIndicators: false,

  /**
   * `/api/*` 요청을 Next.js가 받아 FastAPI로 넘깁니다.
   *
   * 이렇게 하면 브라우저 입장에서 프런트엔드와 백엔드가 같은 출처(origin)가
   * 됩니다. 세션 쿠키를 HttpOnly로 두고도 자동으로 전송되며, 자바스크립트는
   * 쿠키를 읽을 수 없습니다. CORS 설정이나 교차 출처 쿠키 플래그도 필요
   * 없습니다. 배포 환경에서도 같은 구조를 그대로 씁니다(Phase 9).
   */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
