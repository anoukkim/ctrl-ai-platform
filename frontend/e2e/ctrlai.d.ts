/**
 * What the member app's page sees (the SDK, /_ctrlai/sdk.js) — for the
 * Playwright tests that drive it from inside the app frame.
 */

type CtrlaiUser = { displayName: string; appUserId: string };

interface Ctrlai {
  version: string;
  connected: boolean;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
  };
  app(): Promise<{ slug: string | null; mode: string; framed?: boolean }>;
  user(): Promise<CtrlaiUser | null>;
  login(): Promise<CtrlaiUser>;
  logout(): Promise<void>;
  ai: {
    ask(options: unknown): Promise<{ text: string; json: unknown; chargedKrw: number; model: string }>;
    stream(options: unknown, onChunk: (text: string) => void): Promise<{ text: string; chargedKrw: number }>;
  };
}

interface Window {
  ctrlai: Ctrlai;
  __w: Window | null;
  __chunks: string[];
}
