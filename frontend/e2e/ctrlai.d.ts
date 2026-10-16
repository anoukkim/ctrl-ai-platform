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
    estimate(options: unknown): Promise<{ typicalKrw: number; maxKrw: number; model: string }>;
    /** app-ai-access: "live" or "demo" (the maker's setting and the visitor's switch together). */
    mode(): Promise<"live" | "demo">;
  };
  db: {
    save(collection: string, data: Record<string, unknown>, options?: { shared?: boolean }): Promise<CtrlaiItem>;
    list(collection: string, options?: Record<string, unknown>): Promise<{ items: CtrlaiItem[]; nextCursor: string | null }>;
    get(collection: string, id: string, options?: { shared?: boolean }): Promise<CtrlaiItem | null>;
    update(collection: string, id: string, changes: Record<string, unknown>, options?: { shared?: boolean }): Promise<CtrlaiItem>;
    remove(collection: string, id: string, options?: { shared?: boolean }): Promise<void>;
    count(collection: string, options?: Record<string, unknown>): Promise<number>;
    report(collection: string, id: string, reason: string): Promise<void>;
  };
}

type CtrlaiItem = {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  canDelete: boolean;
  author: { displayName: string; appUserId: string | null };
};

interface Window {
  ctrlai: Ctrlai;
  __w: Window | null;
  __chunks: string[];
}
