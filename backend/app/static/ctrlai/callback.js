/*
 * CTRL+AI 기능 상자 — the end of signing in to an app (app-platform P2).
 *
 * The consent window lands here (apps.<domain>/<slug>/_ctrlai/callback).
 * The server has already set — or refused — this app's cookie; this page
 * only tells the shell that opened the window (same origin) and closes.
 * Opened without a shell (the window was not a popup), it goes to the app.
 */
(function () {
  "use strict";
  var body = document.body;
  var ok = body.getAttribute("data-ok") === "1";
  var slug = body.getAttribute("data-slug") || "";
  var opener = null;
  try {
    opener = window.opener;
  } catch (error) {
    opener = null;
  }
  if (opener) {
    try {
      opener.postMessage({ ctrlai: "login", ok: ok }, location.origin);
    } catch (error) {
      /* the app was closed meanwhile */
    }
    setTimeout(function () {
      window.close();
    }, ok ? 400 : 3000);
  } else if (ok && /^[a-z2-9]{10}$/.test(slug)) {
    location.replace("/" + slug + "/");
  }
})();
