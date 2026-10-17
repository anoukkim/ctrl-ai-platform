/** Admin › Community — 신고 | 의견 | 앱 (admin-consolidation v3; 지운 작업 moved to the member panel). */
import AppsList from "../apps/AppsList";
import ContentAdmin from "../content/ContentAdmin";
import FeedbackAdmin from "../feedback/FeedbackAdmin";
import SectionPanels from "../SectionPanels";

export default function AdminCommunityPage() {
  return <SectionPanels section="community" panels={{ content: <ContentAdmin />, feedback: <FeedbackAdmin />, apps: <AppsList /> }} />;
}
