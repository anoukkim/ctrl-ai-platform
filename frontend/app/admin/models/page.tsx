/** Admin › Models — Chat | Video | Image | 한도 | 보정 (admin-consolidation v3; Image: image-generation). */
import CalibrationPanel from "../ai-models/CalibrationPanel";
import ModelCatalog from "../ai-models/ModelCatalog";
import SectionPanels from "../SectionPanels";
import FoldHost from "./FoldHost";
import ClaudePricingPanel from "../system/ClaudePricingPanel";
import VideoModelCatalog from "../video-models/VideoModelCatalog";
import ImageModelCatalog from "../image-models/ImageModelCatalog";

export default function AdminModelsPage() {
  return (
    <SectionPanels
      section="models"
      panels={{
        "ai-models": <ModelCatalog />,
        "video-models": <VideoModelCatalog />,
        "image-models": <ImageModelCatalog />,
        limits: <FoldHost title="채팅 한도" screen="models-limits"><ClaudePricingPanel part="limits" /></FoldHost>,
        calibration: (
          <FoldHost title="비용 보정" screen="models-calibration" note="어림값과 실제 답장 비교 · 최근 200회까지">
            <CalibrationPanel />
          </FoldHost>
        ),
      }}
    />
  );
}
