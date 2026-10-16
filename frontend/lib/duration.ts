/** "1:05" — 초를 m:ss로. Video Generator의 재생 시간과 CtrlAITube의 영상 길이가 함께 씁니다. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
