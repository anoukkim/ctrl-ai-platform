/**
 * The cover's hue (`coverHue`) — the colour of an app's card cover before
 * it has a picture. Pinned so the cards keep their colours. (The tab icon
 * no longer uses it: since 2026-10-17 every app tab has one shared icon.)
 */
import { describe, expect, test } from "vitest";

import { coverHue } from "@/lib/apps";

describe("coverHue", () => {
  test("reference values", () => {
    expect(["abcdefgh23", "hjy5qfvr6t", "zzzzzzzzzz", "3"].map(coverHue)).toEqual([117, 341, 0, 51]);
    // Beyond the slug alphabet too (an astral character counts as its high surrogate).
    expect(["a\u{1F600}b", "가계부"].map(coverHue)).toEqual([22, 92]);
  });
});
