/** Admin › Members — 회원 | 참여 신청 (admin-consolidation v3). */
import ApplicationReview from "../applications/ApplicationReview";
import SectionPanels from "../SectionPanels";
import MemberList from "./MemberList";

export default function AdminMembersPage() {
  return <SectionPanels section="members" panels={{ members: <MemberList />, applications: <ApplicationReview /> }} />;
}
