"use client";

/** A Models tab's page heading and fold group around a panel that was a fold elsewhere. */
import PageHeader from "@/app/components/PageHeader";

import { FoldGroup } from "../components/Fold";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

export default function FoldHost({
  title,
  note,
  screen,
  children,
}: {
  title: string;
  note?: string;
  screen: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.sections}>
      <PageHeader eyebrow="Admin" title={sectionLabel("models")} subtitle={note ? `${title} — ${note}` : title} />
      <FoldGroup screen={screen}>{children}</FoldGroup>
    </div>
  );
}
