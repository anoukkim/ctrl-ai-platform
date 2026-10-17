/** Admin › System — 상태 | 감사 기록 (admin-consolidation v3). */
import AuditLogView from "../audit/AuditLog";
import SectionPanels from "../SectionPanels";
import SystemStatus from "./SystemStatus";

export default function AdminSystemPage() {
  return <SectionPanels section="system" panels={{ system: <SystemStatus />, audit: <AuditLogView /> }} />;
}
