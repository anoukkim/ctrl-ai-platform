/** Admin › Quarters — 분기 | 예산 (admin-consolidation v3). */
import BudgetAdmin from "../budget/BudgetAdmin";
import SectionPanels from "../SectionPanels";
import QuarterAdmin from "./QuarterAdmin";

export default function AdminQuartersPage() {
  return <SectionPanels section="quarters" panels={{ quarters: <QuarterAdmin />, budget: <BudgetAdmin /> }} />;
}
