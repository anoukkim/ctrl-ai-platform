/**
 * 백엔드가 거절한 이유를 한국어 그대로 보여 주는지 (fix-quarter-form-autofill).
 *
 * 라우트의 거절은 detail이 문자열이고, 스키마의 거절(422)은 목록입니다.
 * 422에서도 백엔드가 쓴 한국어 문장이 화면에 나와야 합니다.
 */

import { afterEach, expect, test, vi } from "vitest";

import { request } from "@/lib/http";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

test("422의 한국어 문장을 꺼내고 'Value error, '를 뗀다", async () => {
  respond(422, { detail: [{ msg: "Value error, 분기 코드는 2026-Q4 꼴로 입력해 주세요.", type: "value_error" }] });
  await expect(request("/admin/quarters", { method: "POST", body: "{}" })).rejects.toThrow(
    "분기 코드는 2026-Q4 꼴로 입력해 주세요.",
  );
});

test("한국어가 아닌 422는 기본 문구", async () => {
  respond(422, { detail: [{ msg: "Field required", type: "missing" }] });
  await expect(request("/x")).rejects.toThrow("입력한 내용을 다시 확인해 주세요.");
});

test("문자열 detail은 그대로", async () => {
  respond(409, { detail: "2026-Q4 분기가 이미 있습니다." });
  await expect(request("/x")).rejects.toThrow("2026-Q4 분기가 이미 있습니다.");
});
