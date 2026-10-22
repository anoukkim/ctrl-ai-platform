/**
 * Admin › Models — Chat | Video | Image | 한도 | 보정 (admin-consolidation v3; Image: image-generation).
 *
 * admin-ui-unify: the section title and description are drawn once by
 * `AdminFrame`; each tab starts with its own StatusStrip / PanelBar, so 한도 and
 * 보정 no longer sit under a page header and fold of their own.
 */
import CalibrationPanel from "../ai-models/CalibrationPanel";
import ModelCatalog from "../ai-models/ModelCatalog";
import SectionPanels from "../SectionPanels";
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
        limits: <ClaudePricingPanel part="limits" />,
        calibration: <CalibrationPanel />,
      }}
    />
  );
}
