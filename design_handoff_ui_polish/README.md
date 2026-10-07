# Handoff: CTRL+AI UI polish (variant B) + light/dark theme

## Overview
Visual polish for every route in `frontend/app`, plus a user-selectable **light / dark theme (dark is default)**. Structure, routes, copy and data flow stay the same. Most of the work is token changes in `globals.css` plus spacing, radius and hierarchy updates in each screen's CSS module.

**Synced to repo `main` as of 2026-10-07 05:33 UTC**, which already includes the live Claude chat. This pass is visual only: keep the logic, API calls, streaming, `useChatIdea`, `useMayCreate`, ConfirmDialogs and tests exactly as they are. Restyle the existing markup and CSS modules only.

## About the design files
`CTRL+AI Full Site.html` is a **design reference built in HTML**: a clickable prototype that shows the intended look and behavior. It is not production code. Recreate it in the existing Next.js app using the current components, CSS modules and `globals.css` tokens. Do not copy its inline styles.

Open it in a browser. The sidebar ☀ button (next to logout) switches the theme.

## Fidelity
**High-fidelity.** Match the colors, radii, spacing and type scale below. The Korean copy in the prototype matches the repo; keep the repo's copy where they differ.

---

## 1. Theme system (do this first)

### 1a. `globals.css`
The header comment currently says the app has a single fixed dark theme ("밝은 테마는 두지 않고…"). Update that comment. Then:

- Keep the existing `:root` block as the **dark** theme (default) and add `[data-theme="dark"]` to its selector.
- Add a **light** block with the values below.
- Add the variant B shape tokens (they apply to both themes).

```css
:root, [data-theme="dark"] { color-scheme: dark; /* existing values unchanged */ }

[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f6f7;
  --bg-rail: #efeff1;
  --panel: #ffffff;
  --panel-2: #f2f2f4;
  --elevated: #ffffff;
  --border: #e2e2e6;
  --border-strong: #8a8a94;
  --text: #17171a;
  --text-muted: #3d3d44;
  --text-dim: #686871;
  --accent: #0153cc;
  --accent-soft: rgba(1, 83, 204, 0.08);
  --accent-border: rgba(1, 83, 204, 0.35);
  --accent-strong: #0153cc;
  --accent-strong-edge: #0153cc;
  --on-accent: #ffffff;
  --focus: #0153cc;
  --build: #9b1fe0;
  --build-text: #7a17b3;
  --build-soft: rgba(155, 31, 224, 0.09);
  --video: #00a9b8;
  --video-text: #00737d;
  --video-soft: rgba(0, 169, 184, 0.10);
  --video-letterbox: #101215;   /* the video stage stays dark in light mode */
  --ok-text: #16764a;
  --ok-soft: rgba(22, 118, 74, 0.09);
  --warn-text: #835a00;
  --warn-soft: rgba(224, 167, 34, 0.14);
  --error-text: #b42318;
  --error-soft: rgba(180, 35, 24, 0.08);
}

/* Variant B shape: both themes */
:root {
  --radius: 16px;      /* was 10px — cards, panels, workspace frames */
  --radius-sm: 10px;   /* was 6px — buttons, inputs, chips, file rows */
  --shadow: 0 1px 2px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06);
}
```

- Add `box-shadow: var(--shadow)` to `.card` and to every card-like module class (library cards, app/video cards, stat cards, workspace frames).
- Audit for hard-coded colors that break in light mode. Known ones:
  - `.field:hover` and the scrollbar thumb hover use `#3a4459`. Replace with `var(--border-strong)`.
  - Badge borders use hard-coded `rgba(...)`. Swap them for theme tokens, or add light overrides.
  - Search all `*.module.css` files for `#` and `rgba(`.

### 1b. Applying the theme (no flash on load)
- Store the choice in `localStorage` under the key `ctrlai-theme` (`"dark"` | `"light"`). If nothing is stored, use **dark**. Do not follow the OS setting unless you decide to.
- In `app/layout.tsx`, set `<html lang="ko" data-theme="dark" suppressHydrationWarning>` and add an inline script in `<head>` that runs before paint:
  ```html
  <script dangerouslySetInnerHTML={{ __html:
    `try{var t=localStorage.getItem('ctrlai-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}` }} />
  ```
- Add a small client hook or provider (`ThemeProvider` / `useTheme`) that reads `document.documentElement.dataset.theme`, exposes `toggle()`, writes to `localStorage`, and updates the `data-theme` attribute.

### 1c. Toggle UI
- **Sidebar footer** (`AppShell.tsx`): a 30×30 icon button between the user name and logout, using lucide `Sun` or `Moon` at 16px, `color: var(--text-dim)`. On hover: `background: var(--panel-2)` and `color: var(--text)`. Set `aria-label` / `title` to `밝은 화면으로` or `어두운 화면으로`.
- Optional: a "화면 테마 · 어둡게 / 밝게" segmented control in Profile → 계정 설정.

---

## 2. Shell (`AppShell.tsx` + module)
- Sidebar: width 244px, background `--bg-rail`, 1px right border, padding 20px 12px 14px.
- Brand: the "+" uses the existing logo gradient (`--logo-from` → `--logo-to`). Name 17px/750; subtitle 12px `--text-dim`.
- Nav items: padding 8px 10px, radius `--radius-sm`, 14px text, 11px gap to a 17px icon. The Project Builder icon is stroked in `--build`; the Video Generator icon in `--video`.
  - **Active:** background `--accent-soft`, text `--accent`, no left bar (variant B).
  - Hover: `--panel-2`.
- Section labels (Create, Explore, Account): 11px/650, `--text-dim`, letter-spacing .04em.
- Admin item: a warning count pill on the right (e.g. pending applications).
- **Account:** a row of 3 compact items (Usage, Profile, Report): icon above an 11.5px label, each one-third of the width.
- **Quarter card:** radius `--radius`, shadow, padding 14px.
  - "2026 Q4" 14px/700, with D-85 in mono next to it.
  - 활동 회원 badge.
  - Two 4px meters: Build in `--build`, Video in `--video`. Fill = **used** amount, matching the Usage page.
- **User footer:** 30px avatar, name, @handle in mono, the theme button, and a logout icon button. The full-width 로그아웃 button is removed.

## 3. Shared patterns (all list pages)
- **Page header:**
  - Optional eyebrow: a 6px dot plus "Create", tinted by area.
  - h1 24px/750.
  - Subtitle 14px `--text-muted`, max-width ~720px.
  - Primary action aligned to the right.
  - Bottom border, then 22px gap.
- **Toolbar:**
  - Count label on the left ("내 프로젝트 1개").
  - Search field on the right: max 380px, with a magnifier icon.
  - Filters are **chip/segmented groups instead of `<select>`**. The selected chip uses the accent-soft background, `--accent-border` outline and accent text.
- **Card grid:** `repeat(auto-fill, minmax(300px, 1fr))`, 14–16px gap.
- **New-item tile:** 1.5px dashed border. On hover the border takes the area color and the area-soft background fills in.
- **Badges:** never wrap (`white-space: nowrap`). Membership: 활동 = ok, 비활동 = warn, 탈퇴 = muted. "준비 중" stays a dashed mock badge.
- **Buttons:** never wrap; give them `flex: none` inside toolbars.

## 4. Screens
The prototype has the exact layout for each. Key changes:

- **Chat (`ChatWorkspace.tsx` + `ChatWorkspace.module.css`):**
  - **Layout:** the conversation list sits on the left at 236px (background `--bg`, right border); the chat column fills the rest. The whole area is 100vh, the thread scrolls and the composer stays pinned to the bottom. Below 1100px, keep the existing `listToggle` drawer behaviour.
  - **Conversation list:**
    - 새 대화: full-width outline button with `--radius-sm`; on hover, accent border and text.
    - A "최근 대화" label in the section-label style (11px/650, `--text-dim`).
    - Items: 13.5px, padding 6px 4px 6px 10px, with the title truncated by ellipsis. Active item: `--accent-soft` background and `--accent` text. Hover: `--panel-2`.
    - Rename and delete are 24px icon buttons (13px icons). The delete icon turns error-red on hover.
  - **Test-mode badge:** centered at the top of the chat column, dashed mock style.
  - **Empty state:** 52px BrandMark tile, h1 28px, subtitle max 560px. The 4 shortcut cards get 34px tinted icon tiles (Build purple, Video cyan, Apps/Tube accent); the card hover border takes the area color.
  - **Messages:** role label 11.5px/650 `--text-dim` ("나" / "CTRL+AI"). Bubbles: radius `--radius`, padding 12px 15px, 14.5px/1.65, max-width 85%. Mine use `--accent-soft` with an `--accent-border` outline; the assistant's use `--panel` with a `--border` outline.
  - **Streaming caret:** an 8×16px accent block with a 2px radius.
  - **Action link** (`ACTION_LABEL` + →): restyle it as a pill button. Padding 7px 14px, `--accent-soft` background, `--accent-border` outline, accent text, 13.5px/650.
  - **Notes:** the status note is 12px `--text-dim`. The error note uses error-soft with error text.
  - **Composer:** radius `--radius + 4px`, `--border-strong` outline, shadow. Send button 38×38 with `--accent-strong` fill. The stop button is the same size with `--panel-2` fill and a 11px square glyph.
  - **Hint:** one line below the composer, 12px `--text-dim`. Use the existing `hint` text.
- **Builder list / Video list — new-project form (`?idea=` from Chat):**
  - Show it as a card above the grid: `--accent-border` outline, radius, shadow, padding 18px.
  - Title "새 프로젝트" (Video: "새 영상 프로젝트").
  - Below it, one row: the name input (flex 1), the primary 만들기 button and an outline 취소 button.
  - `.createIdea` box: Builder uses `--accent-soft` with an accent label; Video uses `--video-soft` with a `--video-text` label. Label 12px/650, idea text 14px.
  - Copy fix: "프로젝트 설명로" → "프로젝트 설명으로".
- **Builder list / Video list:**
  - Builder project cards get a 120px thumbnail placeholder on top.
  - Video project cards show a 72×128 9:16 thumbnail on the left.
  - 최종본 선택됨 shown in ok color.
- **Builder workspace:**
  - Inset frame (16px page padding) with radius and shadow.
  - Columns: 220px file tree / flexible editor / 320px Claude panel. Below 1250px, hide the file tree.
  - Pill tabs 코드 / 미리보기 / 나란히.
  - Code syntax colors: keyword `#d7a6ff` (light `#8a1fc4`), string `#9fe3b8` (light `#16764a`), tag `--accent`.
  - Chat bubbles: mine use accent-soft; Claude's use the panel color.
- **Video workspace:**
  - Columns: settings 340px / stage / Claude 300px. Below 1250px, hide the Claude panel.
  - Model picker: **radio cards** (name + one-line description) instead of a `<select>`.
  - Ratio chips include a small aspect-ratio glyph.
  - The sound warning is a single warn box.
  - The settings summary sits right above Claude로 다듬기 and the primary button.
  - Version strip: thumbnail + mono time and model.
- **CtrlAIApps:**
  - Category chips instead of a select.
  - Covers use **soft oklch tints** (`oklch(.42 .09 H)` → `oklch(.30 .07 H+20)`) instead of saturated gradients.
- **App detail:**
  - Hero: 16:10 artwork + meta.
  - Underline tabs.
  - Feature cards with a ✓ tile.
  - 9:16 screenshot row.
  - Timeline with a 최신 badge.
  - "{creator}의 다른 앱" row.
- **CtrlAITube list / watch:**
  - 16:10 thumbnails with a play glyph and duration.
  - Watch page: the comments panel is sticky at ≥1150px and stacks below the video when narrower.
- **Usage:**
  - Season bar.
  - Build and Video cards: remaining amount in 32px mono; meter = used.
  - Personal-balance card kept visually separate.
  - Table with a 지원금 badge.
- **Profile:**
  - 60px avatar with badges.
  - Quarter card with 3 fact tiles.
  - Approved: Build and Video amount tiles.
  - Apply state: range slider + presets + live split preview.
  - Two-column 계정 설정 / 연결한 서비스.
  - Three summary cards.
  - Withdrawal collapsed by default; the danger button only appears after expanding.
- **Report Issue:**
  - Numbered steps (26px accent-soft circles).
  - Warn-tinted caution card.
  - Dashed placeholder card.
- **Login / Signup:**
  - Centered card (400/440px) on a faint radial tint (accent for login, build for signup).
  - Signup hints turn ok or error color live.
- **Admin:**
  - Horizontal tab bar with the quarter picker on the right.
  - Stat cards are clickable filters; the selected card uses accent-soft, and a needs-attention card uses warn-soft.
  - Tables: header row in `--panel-2` at 12px/650, rows 13.5px, inline primary/danger buttons for row actions.
  - A green result banner after each action.
  - Member detail: segmented controls for participation status and role, Build/Video meters, and a danger card.
  - **System:**
    - The server (`BackendStatus`) and external providers (`ProviderPanel`) become status cards with a colored dot and a status badge.
    - **Claude 요금 (`ClaudePricingPanel`):** wrap it in one card.
      - The `providerFacts` dl becomes a grid of 4 `--panel-2` fact tiles (label 12px `--text-dim`, value mono 13px).
      - The price table uses the shared table style. Inputs are 100px mono with `--radius-sm`; the 사용 중 badge is the accent badge.
      - The exchange rate sits at the bottom, separated by a top border: a 120px input + 저장 button, and the history in 12px mono `--text-dim`.
  - Dev Tools: chip pickers + result card.

## 5. Responsive
- Workspaces: at <1250px hide the side panel (Builder → file tree, Video → Claude panel).
- Tube watch: one column at <1150px.
- All grids use `auto-fill` / `auto-fit` with `minmax`.

## Files
- `CTRL+AI Full Site.html`: offline clickable reference for every page.

## Prompt for Claude Code (all at once)
> Read `design_handoff_ui_polish/README.md` completely and open `design_handoff_ui_polish/CTRL+AI Full Site.html` in a browser as the visual reference. The ☀ button in the sidebar switches to light mode.
>
> Implement the whole README in one go on the current branch:
> 1. Section 1: theme tokens in `globals.css` (dark default plus a light block), variant B radius and shadow, the no-flash script in `layout.tsx`, a ThemeProvider, and the sidebar theme toggle.
> 2. Sections 2–5: restyle every route listed (shell, chat, builder, video, apps, tube, usage, profile, issues, login, signup, and all admin sub-pages including the System → Claude 요금 panel).
>
> Rules:
> - This is a visual pass. Do not change API calls, streaming, state logic, routes or copy (except the one copy fix noted).
> - Replace hard-coded colors in `*.module.css` with tokens so both themes work.
> - Where the README replaces a `<select>` with chips or radio cards, keep the same state and values.
>
> When done:
> - Run `npm run lint`, `npx tsc --noEmit` and `npm test` in `frontend/`, and fix any failures (update tests that query removed `<select>`s).
> - Click through every page in both themes.
> - Commit as separate commits per area, then summarize what changed and anything you couldn't match.
