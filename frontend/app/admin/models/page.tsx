/** Admin › Models — Chat | Video (admin-consolidation v3). */
import ModelCatalog from "../ai-models/ModelCatalog";
import SectionPanels from "../SectionPanels";
import VideoModelCatalog from "../video-models/VideoModelCatalog";

export default function AdminModelsPage() {
  return <SectionPanels section="models" panels={{ "ai-models": <ModelCatalog />, "video-models": <VideoModelCatalog /> }} />;
}
