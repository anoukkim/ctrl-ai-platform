import PageTransition from "@/app/components/PageTransition";

/**
 * template은 layout과 달리 화면을 옮길 때마다 새로 그려집니다. 그래서
 * 여기 둔 등장 효과가 화면마다 한 번씩 일어납니다(ui-friendly-motion).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
