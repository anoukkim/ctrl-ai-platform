/**
 * "띠링" — 차감 순간의 짧은 소리 (owner-polish 10, spend-feedback v2).
 *
 * 파일을 내려받지 않고 WebAudio로 두 음을 만듭니다(약 0.25초). 브라우저는
 * 사용자가 무언가 누른 뒤에만 소리를 허락하므로, 차감은 늘 보내기·고치기
 * 같은 클릭 뒤에 오니 그 조건은 자연히 맞습니다. 안 되는 환경(오디오 없음,
 * 자동 재생 차단)에서는 조용히 넘어갑니다 — 소리는 장식입니다.
 *
 * 켜고 끄는 값은 이 기기의 localStorage에만 둡니다: 소리는 기기의
 * 사정(사무실인지, 이어폰인지)이라 계정 설정이 아니라 기기 설정에
 * 가깝고, 기본은 꺼짐입니다.
 */

import { useSyncExternalStore } from "react";

const KEY = "ctrlai.spend-sound";
const EVENT = "ctrlai-spend-sound";

/** 저장소가 막혀도 이 페이지에서는 기억합니다. */
let memory: boolean | null = null;

export function readSoundPref(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored !== null) return stored === "1";
  } catch {
    /* 저장소가 막혔으면 이 페이지의 기억으로 */
  }
  return memory ?? false;
}

export function writeSoundPref(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 메모리에는 남았습니다 */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 테스트에서 페이지를 새로 연 것처럼. */
export function forgetSoundPrefInMemory(): void {
  memory = null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 서버와 첫 화면은 꺼짐, 그다음 이 기기의 값 (lib/theme.ts와 같은 방식). */
export function useSoundPref(): boolean {
  return useSyncExternalStore(subscribe, readSoundPref, () => false);
}

let context: AudioContext | null = null;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

function audio(): AudioContext | null {
  if (context !== null) return context;
  const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** 두 음(E6 → A6)을 짧게. 실패해도 던지지 않습니다. */
export function playChime(): void {
  const ctx = audio();
  if (ctx === null) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime;
    for (const [frequency, at, length] of [
      [1318.5, 0, 0.12],
      [1760, 0.09, 0.18],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.12, start + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + length + 0.02);
    }
  } catch {
    /* 소리는 장식입니다 */
  }
}
