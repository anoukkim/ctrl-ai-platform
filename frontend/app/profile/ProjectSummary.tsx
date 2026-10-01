"use client";

/**
 * Profile의 프로젝트 요약.
 *
 * Profile은 프로젝트를 관리하는 곳이 아닙니다. 관리 화면은 각각
 * Project Builder와 Video Generator입니다. 여기서는 몇 개를 만들었고
 * 최근에 무엇을 했는지만 보여 주고, 관리 화면으로 보냅니다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  BUILDER_STATUS_BADGE,
  BUILDER_STATUS_LABEL,
  VIDEO_STATUS_BADGE,
  VIDEO_STATUS_LABEL,
  listBuilderProjects,
  listVideoProjects,
  type BuilderProject,
  type VideoProject,
} from "@/lib/projects";

import styles from "./profile.module.css";

/** 요약이므로 최근 3개까지만 보여 줍니다. */
const PREVIEW_COUNT = 3;

export default function ProjectSummary() {
  const [builder, setBuilder] = useState<BuilderProject[] | null>(null);
  const [video, setVideo] = useState<VideoProject[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([listBuilderProjects(), listVideoProjects()])
      .then(([builderProjects, videoProjects]) => {
        if (cancelled) return;
        setBuilder(builderProjects);
        setVideo(videoProjects);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section className="card">
        <h2 className="section-title">내 프로젝트</h2>
        <p className="small muted">
          프로젝트를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h2 className="section-title">
          내 프로젝트
          {builder && <span className="badge badge-muted">{builder.length}개</span>}
        </h2>

        {builder === null && <p className="small dim">불러오는 중…</p>}

        {builder?.length === 0 && (
          <p className="small dim">아직 만든 프로젝트가 없습니다.</p>
        )}

        {builder && builder.length > 0 && (
          <ul className={styles.list}>
            {builder.slice(0, PREVIEW_COUNT).map((project) => (
              <li className={styles.listItem} key={project.id}>
                <Link className={styles.listLink} href={`/builder/${project.id}`}>
                  {project.name}
                </Link>
                <span className={`badge ${BUILDER_STATUS_BADGE[project.status]}`}>
                  {BUILDER_STATUS_LABEL[project.status]}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Link className="btn btn-sm" href="/builder" style={{ marginTop: "0.6rem" }}>
          Project Builder에서 관리
        </Link>
      </section>

      <section className="card">
        <h2 className="section-title">
          내 영상 프로젝트
          {video && <span className="badge badge-muted">{video.length}개</span>}
        </h2>

        {video === null && <p className="small dim">불러오는 중…</p>}

        {video?.length === 0 && (
          <p className="small dim">아직 만든 영상 프로젝트가 없습니다.</p>
        )}

        {video && video.length > 0 && (
          <ul className={styles.list}>
            {video.slice(0, PREVIEW_COUNT).map((project) => (
              <li className={styles.listItem} key={project.id}>
                <Link className={styles.listLink} href={`/video/${project.id}`}>
                  {project.name}
                </Link>
                <span className={`badge ${VIDEO_STATUS_BADGE[project.status]}`}>
                  {VIDEO_STATUS_LABEL[project.status]}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Link className="btn btn-sm" href="/video" style={{ marginTop: "0.6rem" }}>
          Video Generator에서 관리
        </Link>
      </section>
    </>
  );
}
