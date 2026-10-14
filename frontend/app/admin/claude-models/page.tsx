import { redirect } from "next/navigation";

/** 예전 주소. Claude Models는 AI Models가 되었습니다(admin-and-nav-cleanup). */
export default function ClaudeModelsRedirect() {
  redirect("/admin/ai-models");
}
