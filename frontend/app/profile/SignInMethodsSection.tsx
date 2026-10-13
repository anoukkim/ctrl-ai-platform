"use client";

/**
 * Profile › 로그인 방법 (member-password-login, 2026-10-14).
 *
 * 회원은 Google, 아이디·비밀번호, 또는 둘 다로 들어옵니다. 여기서
 * - Google 회원은 비밀번호를 만들고(그다음부터 아이디로도 로그인),
 * - 비밀번호 회원은 Google을 연결하고(`sub`로 이어집니다, 이메일이 아니라),
 * - 둘 다 있으면 하나를 없앨 수 있습니다.
 *
 * **하나만 남았을 때는 없애는 단추가 꺼져 있고**, 왜 꺼졌는지 바로 아래
 * 글로 알려 줍니다(`aria-describedby`). 실제로 막는 것은 백엔드입니다 —
 * 계정 행을 잠근 채로 다른 방법이 남아 있는지 다시 확인합니다.
 *
 * 비밀번호를 바꾸거나 없애거나 Google을 끊을 때는 현재 비밀번호를 다시
 * 묻습니다. 처음 비밀번호를 만들거나 Google을 연결할 때는 물을 비밀번호가
 * 없으니, 로그인한 지 10분이 지났으면 다시 로그인하라고 합니다 — 열려
 * 있던 브라우저만으로 로그인 방법이 늘지 않게 하려는 것입니다. 무엇을
 * 바꾸든 다른 브라우저는 로그아웃됩니다.
 *
 * Google에서 돌아오면 주소에 `?google=linked` 같은 결과가 붙어 옵니다.
 */

import { useEffect, useId, useRef, useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { useToast } from "@/app/components/ToastProvider";
import { describeError } from "@/lib/http";
import {
  GOOGLE_LINK_URL,
  MIN_PASSWORD_LENGTH,
  fetchSignInMethods,
  googleResultMessage,
  removePassword,
  setPassword,
  unlinkGoogle,
  type SignInMethods,
} from "@/lib/auth";

import styles from "./profile.module.css";

type Editing = null | "set" | "change" | "remove" | "unlink";

/** 백엔드가 받는 가장 긴 비밀번호. */
const MAX_PASSWORD_LENGTH = 128;

const FORM_TITLE: Record<Exclude<Editing, null>, string> = {
  set: "비밀번호 만들기",
  change: "비밀번호 바꾸기",
  remove: "비밀번호 로그인 없애기",
  unlink: "Google 연결 끊기",
};

const DONE: Record<Exclude<Editing, null>, string> = {
  set: "비밀번호를 만들었어요. 이제 아이디로도 로그인할 수 있어요. 다른 브라우저는 로그아웃됐어요.",
  change: "비밀번호를 바꿨어요. 다른 브라우저는 로그아웃됐어요.",
  remove: "비밀번호 로그인을 없앴어요. 이제 Google로만 로그인해요. 다른 브라우저는 로그아웃됐어요.",
  unlink: "Google 연결을 끊었어요. 이제 아이디와 비밀번호로만 로그인해요. 다른 브라우저는 로그아웃됐어요.",
};

export default function SignInMethodsSection() {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useCurrentUser();
  const toast = useToast();
  const id = useId();
  /** 폼을 연 단추. 닫히면 초점을 여기로 돌려줍니다. */
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSignInMethods()
      .then((value) => {
        if (!cancelled) setMethods(value);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(describeError(caught));
      });
    const message = googleResultMessage(new URLSearchParams(window.location.search).get("google"));
    if (message) queueMicrotask(() => setNote(message));
    return () => {
      cancelled = true;
    };
  }, []);

  function open(which: Exclude<Editing, null>, button: HTMLButtonElement) {
    opener.current = button;
    setEditing(which);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  function close() {
    setEditing(null);
    // 폼을 연 단추로. 그 단추가 사라졌으면 칸 제목으로.
    setTimeout(() => {
      const target = opener.current?.isConnected
        ? opener.current
        : document.getElementById(`${id}-title`);
      target?.focus();
    }, 0);
  }

  const needsCurrent = editing === "change" || editing === "remove" || editing === "unlink";
  const needsNew = editing === "set" || editing === "change";
  const newValid = next.length >= MIN_PASSWORD_LENGTH && next === confirm;
  const canSubmit = !busy && (!needsCurrent || current.length > 0) && (!needsNew || newValid);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || editing === null) return;
    const action = editing;
    setBusy(true);
    setError(null);
    try {
      const updated =
        action === "set"
          ? await setPassword(next)
          : action === "change"
            ? await setPassword(next, current)
            : action === "remove"
              ? await removePassword(current)
              : await unlinkGoogle(current);
      setMethods(updated);
      setNote(null);
      close();
      toast.show(DONE[action], "ok");
      // 탈퇴 칸은 비밀번호가 있는지에 따라 묻는 것이 달라집니다.
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="card">
        <h2 className="section-title">로그인 방법</h2>
        <p className={styles.connectionHint} role="alert">
          {loadError}
        </p>
      </section>
    );
  }

  const google = methods?.google;
  const hasPassword = methods?.password ?? false;
  const linked = google?.linked ?? false;
  const googleOn = google?.available ?? false;
  const unlinkBlocked = linked && !hasPassword;
  const removeBlocked = hasPassword && !(linked && googleOn);

  const form = editing !== null && (
    <form className={styles.methodForm} onSubmit={submit} aria-labelledby={`${id}-form`}>
      <p className={styles.connectionName} id={`${id}-form`}>
        {FORM_TITLE[editing]}
      </p>
      {needsCurrent && (
        <label className={styles.methodField} htmlFor={`${id}-current`}>
          <span>현재 비밀번호</span>
          <input
            className="field"
            id={`${id}-current`}
            type="password"
            autoComplete="current-password"
            maxLength={MAX_PASSWORD_LENGTH}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoFocus
          />
        </label>
      )}
      {needsNew && (
        <>
          <label className={styles.methodField} htmlFor={`${id}-new`}>
            <span>새 비밀번호</span>
            <input
              className="field"
              id={`${id}-new`}
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoFocus={!needsCurrent}
              aria-describedby={`${id}-rule`}
            />
          </label>
          <label className={styles.methodField} htmlFor={`${id}-confirm`}>
            <span>새 비밀번호 확인</span>
            <input
              className="field"
              id={`${id}-confirm`}
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-describedby={`${id}-rule`}
            />
          </label>
          <p className={styles.connectionHint} id={`${id}-rule`}>
            {next && next.length < MIN_PASSWORD_LENGTH
              ? `${MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.`
              : confirm && next !== confirm
                ? "두 칸의 비밀번호가 달라요."
                : `${MIN_PASSWORD_LENGTH}자 이상. 다른 곳에서 쓰지 않는 비밀번호가 좋아요.`}
          </p>
        </>
      )}
      {editing === "remove" && (
        <p className={styles.connectionHint}>없애면 Google로만 로그인할 수 있어요.</p>
      )}
      {editing === "unlink" && (
        <p className={styles.connectionHint}>끊으면 아이디와 비밀번호로만 로그인할 수 있어요.</p>
      )}
      {error && (
        <p className={styles.methodError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.methodActions}>
        <button className="btn btn-sm" type="button" onClick={close} disabled={busy}>
          취소
        </button>
        <button
          className={`btn btn-sm ${editing === "remove" || editing === "unlink" ? "btn-danger" : "btn-primary"}`}
          type="submit"
          disabled={!canSubmit}
        >
          {busy ? "처리 중…" : editing === "remove" ? "없애기" : editing === "unlink" ? "연결 끊기" : "저장"}
        </button>
      </div>
    </form>
  );

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 className="section-title" id={`${id}-title`} tabIndex={-1}>
        로그인 방법
      </h2>
      <p className={styles.connectionHint}>
        Google 계정이나 아이디·비밀번호로 로그인해요. 로그인 방법은 하나 이상 있어야 해서,
        하나만 있을 때는 없앨 수 없어요.
      </p>
      {note && (
        <p className={styles.connectionHint} role="status">
          {note}
        </p>
      )}

      {/* Google */}
      <div className={styles.connection}>
        <div>
          <p className={styles.connectionName}>Google 계정</p>
          <p className={styles.connectionHint}>
            {methods === null
              ? "불러오는 중…"
              : linked
                ? `${google?.email}(으)로 로그인해요.`
                : "연결해 두면 Google로도 로그인할 수 있어요."}
          </p>
        </div>
        {methods !== null && (
          <span className={styles.connectionRight}>
            {linked ? (
              <>
                <span className="badge badge-ok">연결됨</span>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={(event) => open("unlink", event.currentTarget)}
                  disabled={unlinkBlocked || busy}
                  aria-describedby={unlinkBlocked ? `${id}-unlink-why` : undefined}
                >
                  연결 끊기
                </button>
              </>
            ) : googleOn ? (
              <>
                <span className="badge badge-muted">연결 안 됨</span>
                <a className="btn btn-sm" href={GOOGLE_LINK_URL}>
                  연결하기
                </a>
              </>
            ) : (
              <>
                <span className="badge badge-muted">준비 중</span>
                <button className="btn btn-sm" type="button" disabled aria-describedby={`${id}-google-off`}>
                  연결하기
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {unlinkBlocked && (
        <p className={styles.connectionHint} id={`${id}-unlink-why`}>
          Google 연결을 끊으려면 먼저 비밀번호를 만들어 주세요.
        </p>
      )}
      {methods !== null && !linked && !googleOn && (
        <p className={styles.connectionHint} id={`${id}-google-off`}>
          이 서버에서는 Google 로그인이 아직 켜지지 않았어요.
        </p>
      )}
      {editing === "unlink" && form}

      {/* 비밀번호 */}
      <div className={styles.connection}>
        <div>
          <p className={styles.connectionName}>아이디와 비밀번호</p>
          <p className={styles.connectionHint}>
            {methods === null
              ? "불러오는 중…"
              : hasPassword
                ? "아이디와 비밀번호로 로그인할 수 있어요."
                : "비밀번호를 만들면 아이디로도 로그인할 수 있어요."}
          </p>
        </div>
        {methods !== null && (
          <span className={styles.connectionRight}>
            {hasPassword ? (
              <>
                <span className="badge badge-ok">사용 중</span>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={(event) => open("change", event.currentTarget)}
                  disabled={busy}
                >
                  바꾸기
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={(event) => open("remove", event.currentTarget)}
                  disabled={removeBlocked || busy}
                  aria-describedby={removeBlocked ? `${id}-remove-why` : undefined}
                >
                  없애기
                </button>
              </>
            ) : (
              <>
                <span className="badge badge-muted">없음</span>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={(event) => open("set", event.currentTarget)}
                  disabled={busy}
                >
                  만들기
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {removeBlocked && methods !== null && (
        <p className={styles.connectionHint} id={`${id}-remove-why`}>
          {linked
            ? "이 서버에서 Google 로그인이 꺼져 있어 비밀번호를 없앨 수 없어요."
            : "비밀번호를 없애려면 먼저 Google을 연결해 주세요."}
        </p>
      )}
      {editing !== null && editing !== "unlink" && form}
    </section>
  );
}
