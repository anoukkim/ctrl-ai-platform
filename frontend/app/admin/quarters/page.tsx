/** Admin › Quarters — 분기 · 예산 | 사용 분석 (admin-consolidation v3). */
import BudgetAdmin from "../budget/BudgetAdmin";
import SectionPanels from "../SectionPanels";
import QuarterPlan from "./QuarterPlan";

export default function AdminQuartersPage() {
  return <SectionPanels section="quarters" panels={{ quarters: <QuarterPlan />, budget: <BudgetAdmin /> }} />;
}
