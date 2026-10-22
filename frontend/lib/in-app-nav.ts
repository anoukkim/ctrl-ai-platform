/**
 * Whether the visitor has moved between screens inside this tab's copy of the
 * site (client-side navigation keeps `document.referrer` at the first page, so
 * it cannot tell). AppShell notes every path; BackButton asks before going back.
 */

let firstPath: string | null = null;
let moved = false;

export function notePath(path: string): void {
  if (firstPath === null) firstPath = path;
  else if (path !== firstPath) moved = true;
}

export function movedInApp(): boolean {
  return moved;
}
