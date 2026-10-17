/** Admin › Community — 신고 | 의견 | 앱 | 지운 작업 (admin-consolidation v3). */
import AppsList from "../apps/AppsList";
import ContentAdmin from "../content/ContentAdmin";
import DeletedWorkAdmin from "../deleted/DeletedWorkAdmin";
import FeedbackAdmin from "../feedback/FeedbackAdmin";
import SectionPanels from "../SectionPanels";

export default function AdminCommunityPage() {
  return (
    <SectionPanels
      section="community"
      panels={{ content: <ContentAdmin />, feedback: <FeedbackAdmin />, apps: <AppsList />, deleted: <DeletedWorkAdmin /> }}
    />
  );
}
