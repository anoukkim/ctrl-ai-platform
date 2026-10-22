"use client";

/**
 * 이미지 만들기 카드 (image-generation).
 *
 * Claude가 그림을 원하는 회원에게 `[[action:image|…]]`로 내놓는 카드입니다.
 * 설명(Claude가 쓴 영어 문장 — 고쳐도 됩니다), 모델, 크기, 비율을 고르고
 * 가격을 본 뒤 만들기를 누르면 그림 한 장이 이 답장에 붙습니다. 가격은
 * 모델 목록의 금액 그대로이고, 거절·실패면 0원입니다(백엔드가 보장).
 * 이 카드에서 만든 그림은 아래에 크게 보이고, 열기·내려받기가 됩니다.
 */

import { useEffect, useId, useState } from "react";

import { type ImageModelList, RATIO_LABEL, getImageModels, makeImage } from "@/lib/chat";
import { type ChatAttachment, attachmentUrl } from "@/lib/chat-files";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import WorkingSince from "./WorkingSince";
import styles from "./ImageCard.module.css";

/** 만들기를 누른 시각 — "그리는 중… N초"가 셉니다. */
function startedNow(): number {
  return Date.now();
}

interface Props {
  messageId: number;
  prompt: string;
  /** 이 답장에서 이미 만든 그림. */
  images: ChatAttachment[];
  /** 이번 분기에 참여 중일 때만 만들 수 있습니다. */
  disabled: boolean;
  onMade: (attachment: ChatAttachment, chargedKrw: number) => void;
}

export default function ImageCard({ messageId, prompt, images, disabled, onMade }: Props) {
  const ids = useId();
  const [list, setList] = useState<ImageModelList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState(prompt);
  const [modelId, setModelId] = useState<number | null>(null);
  const [size, setSize] = useState<string>("");
  const [ratio, setRatio] = useState<string>("");
  const [busySince, setBusySince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // 카드가 열릴 때마다 새로 읽습니다 — 관리자가 바꾼 가격·잠금이 바로 보이도록.
    getImageModels()
      .then((value) => {
        if (!live) return;
        setList(value);
        const first = value.models[0];
        if (first) {
          setModelId(first.id);
          setSize(first.capabilities.defaults.size);
          setRatio(first.capabilities.defaults.aspect_ratio);
        }
      })
      .catch((err) => live && setLoadError(describeError(err)));
    return () => {
      live = false;
    };
  }, []);

  const model = list?.models.find((m) => m.id === modelId) ?? null;
  const price = model ? model.capabilities.price_per_image_krw[size] ?? null : null;
  const busy = busySince !== null;
  const canMake = Boolean(list?.open && model && price !== null && text.trim()) && !busy && !disabled;

  function chooseModel(id: number) {
    const next = list?.models.find((m) => m.id === id);
    if (!next) return;
    setModelId(id);
    if (!next.capabilities.sizes.includes(size as never)) setSize(next.capabilities.defaults.size);
    if (!next.capabilities.aspect_ratios.includes(ratio)) setRatio(next.capabilities.defaults.aspect_ratio);
  }

  async function make() {
    if (!canMake || !model) return;
    setError(null);
    setBusySince(startedNow());
    try {
      const made = await makeImage(messageId, {
        prompt: text.trim(),
        model: model.id,
        size,
        aspect_ratio: ratio,
        expected_krw: price ?? undefined,
      });
      onMade(made.attachment, made.charged_krw);
    } catch (err) {
      setError(describeError(err));
      // 가격이 바뀌었다면(409) 새 가격을 보여 줍니다.
      getImageModels()
        .then(setList)
        .catch(() => undefined);
    } finally {
      setBusySince(null);
    }
  }

  return (
    <section className={styles.card} aria-label="이미지 만들기" data-testid="image-card">
      <header className={styles.head}>
        <span className={styles.title}>🎨 이미지 만들기</span>
        {list?.mock && <span className={styles.mock}>테스트 모드 — 예시 그림이 만들어져요</span>}
      </header>

      {images.length > 0 && (
        <ul className={styles.results} data-testid="image-results">
          {images.map((image) => (
            <li key={image.id} className={styles.result}>
              <a href={attachmentUrl(image.id)} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- 저장된 사본, 자기 파일만 열림 */}
                <img
                  className={styles.image}
                  src={attachmentUrl(image.id)}
                  alt={image.prompt || image.name}
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  loading="lazy"
                />
              </a>
              <div className={styles.resultActions}>
                <span className={styles.meta}>
                  {image.width}×{image.height}
                </span>
                <a className={styles.button} href={`${attachmentUrl(image.id)}?download=true`} download={image.name}>
                  내려받기
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : !list ? (
        <p className={styles.note}>불러오는 중…</p>
      ) : !list.open ? (
        <p className={styles.note}>이미지 만들기는 다음 단계에서 열려요 — 지금은 준비 중이에요.</p>
      ) : list.models.length === 0 ? (
        <p className={styles.note}>지금 쓸 수 있는 이미지 모델이 없어요. 관리자에게 알려 주세요.</p>
      ) : (
        <div className={styles.form}>
          <label className={styles.label} htmlFor={`${ids}-prompt`}>
            그림 설명 <span className={styles.hint}>영어가 가장 잘 돼요 — 한국어로 고쳐도 괜찮아요</span>
          </label>
          <textarea
            id={`${ids}-prompt`}
            className={styles.prompt}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={busy}
          />
          <div className={styles.options}>
            {list.models.length > 1 && (
              <label className={styles.option}>
                <span>모델</span>
                <select
                  value={modelId ?? ""}
                  onChange={(event) => chooseModel(Number(event.target.value))}
                  disabled={busy}
                >
                  {list.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {model && (
              <>
                <fieldset className={styles.sizes} disabled={busy}>
                  <legend>크기</legend>
                  {model.capabilities.sizes.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={value === size ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                      aria-pressed={value === size}
                      onClick={() => setSize(value)}
                    >
                      {value} · {formatKrw(model.capabilities.price_per_image_krw[value] ?? 0)}
                    </button>
                  ))}
                </fieldset>
                <label className={styles.option}>
                  <span>비율</span>
                  <select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={busy}>
                    {model.capabilities.aspect_ratios.map((value) => (
                      <option key={value} value={value}>
                        {RATIO_LABEL[value] ?? value}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          {model?.description && <p className={styles.note}>{model.description}</p>}
          <div className={styles.footer}>
            <button type="button" className={styles.make} onClick={make} disabled={!canMake} data-testid="image-make">
              {busy ? "그리는 중…" : `만들기 · ${price === null ? "-" : formatKrw(price)}`}
            </button>
            {busySince !== null && <WorkingSince since={busySince} className={styles.meta} />}
            {disabled && <span className={styles.meta}>이번 분기에 참여 중일 때 만들 수 있어요.</span>}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
