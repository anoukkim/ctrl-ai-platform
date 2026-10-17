/** admin-consolidation v3: this address moved — see `LEGACY_ROUTES`. */
import { legacyRedirect } from "../legacy";

export default async function Moved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect("/admin/audit", searchParams);
}
