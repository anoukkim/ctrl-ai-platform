/**
 * app-tab-icon — the cover's hue is one arithmetic on both sides.
 *
 * The shell page's favicon (backend `app_shell.favicon`) draws the app's
 * cover with the hue the CtrlAIApps card uses (`coverHue`); the backend
 * test pins the same four values, so a change on either side fails here
 * or there.
 */
import { describe, expect, test } from "vitest";

import { coverHue } from "@/lib/apps";

describe("coverHue", () => {
  test("the reference values the backend's cover_hue pins too", () => {
    expect(["abcdefgh23", "hjy5qfvr6t", "zzzzzzzzzz", "3"].map(coverHue)).toEqual([117, 341, 0, 51]);
  });
});
