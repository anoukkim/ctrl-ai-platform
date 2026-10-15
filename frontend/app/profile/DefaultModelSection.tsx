"use client";

/**
 * Profile › 기본 모델(quality-tuning Q1).
 *
 * 새 대화와 새 Builder 프로젝트가 처음에 쓰는 모델과 생각 깊이입니다.
 * 이미 있는 대화와 프로젝트는 각자 고른 것을 그대로 씁니다. Chat과 같은
 * 고르기 창이고, 고르는 즉시 저장됩니다.
 */

import { useEffect, useState } from "react";

import ModelDepthPicker from "@/app/components/ModelDepthPicker";
import { currentModel, getChatInfo, toPickerModel, type ChatInfo } from "@/lib/chat";
import type { DepthLevel, PickerModel } from "@/lib/depth";
import { describeError } from "@/lib/http";
import { setPreferences } from "@/lib/spend";

export default function DefaultModelSection() {
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getChatInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info || info.models.length === 0) return null;

  const selected = currentModel(info, null);
  const level: DepthLevel = info.member_default_depth ?? "medium";

  async function choose(model: PickerModel, next: DepthLevel) {
    setError(null);
    setSaved(false);
    const before = info;
    setInfo((current) =>
      current ? { ...current, member_default_model_id: model.id, member_default_depth: next } : current,
    );
    try {
      await setPreferences({ default_chat_model_id: model.id, default_depth: next });
      setSaved(true);
    } catch (caught) {
      setInfo(before);
      setError(describeError(caught));
    }
  }

  return (
    <section className="card" aria-labelledby="profile-default-model">
      <h2 className="section-title" id="profile-default-model">
        기본 모델
      </h2>
      <p className="small dim" style={{ marginBottom: "0.6rem" }}>
        새 대화와 새 Builder 프로젝트가 이 모델과 생각 깊이로 시작해요. 대화나 프로젝트마다
        바꿀 수 있어요.
      </p>
      <ModelDepthPicker
        name="기본 모델"
        placement="down"
        models={info.models.map(toPickerModel)}
        current={selected ? toPickerModel(selected) : null}
        level={level}
        onChange={(model, next) => void choose(model, next)}
      />
      {saved && (
        <p className="small dim" role="status" style={{ marginTop: "0.5rem" }}>
          저장했어요.
        </p>
      )}
      {error && (
        <p className="small" role="alert" style={{ marginTop: "0.5rem", color: "var(--error-text)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
