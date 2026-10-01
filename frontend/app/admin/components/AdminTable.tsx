"use client";

/**
 * Admin의 표 — 한 벌만 씁니다.
 *
 * 이전에는 화면마다 `<table className="table">`을 따로 적었고, 머리글이
 * 고정되지 않은 표, 숫자가 가운데로 쏠린 표, 빈 상태 문구가 없는 표가
 * 섞여 있었습니다. 표를 한곳에서 만들면 그런 차이가 생길 자리가 없습니다.
 *
 * 줄 전체를 누를 수 있습니다. 상세 화면이 있는 표에서는 작은 링크를
 * 정확히 겨냥하는 것보다 줄을 누르는 쪽이 쉽고, 끝의 › 가 "눌러서 들어갈
 * 수 있다"를 알려 줍니다. 줄 안의 버튼(관리 메뉴 등)은 누르는 일이
 * 바깥으로 번지지 않도록 `RowActions`로 감쌉니다.
 *
 * 접근성: 줄을 누를 수 있어도 `<tr onClick>`만으로는 키보드로 쓸 수
 * 없습니다. 그래서 첫 칸에 실제 링크를 두고, 줄을 누르면 그 링크를 따라
 * 갑니다. 키보드는 링크에 그대로 닿고, 마우스는 줄 전체를 씁니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";

import styles from "../admin.module.css";

export interface Column<Row> {
  key: string;
  header: string;
  /** 금액·날짜처럼 자릿수를 맞춰야 하는 칸. */
  numeric?: boolean;
  render: (row: Row) => React.ReactNode;
}

interface Props<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  /** 줄을 눌렀을 때 갈 곳. 없으면 줄은 눌리지 않습니다. */
  rowHref?: (row: Row) => string;
  /** 줄 오른쪽 끝에 붙는 관리 메뉴 등. */
  rowActions?: (row: Row) => React.ReactNode;
  /** 비어 있을 때 보여 줄 한국어 문구. */
  empty: string;
  caption?: string;
}

export default function AdminTable<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowActions,
  empty,
  caption,
}: Props<Row>) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="small muted">{empty}</p>
      </div>
    );
  }

  const clickable = rowHref !== undefined;

  return (
    <div className={`table-wrap ${styles.tableWrap}`}>
      <table className={`table ${styles.table}`}>
        {caption && <caption className={styles.tableCaption}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={column.numeric ? styles.numericCell : undefined}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
            {rowActions && (
              <th className={styles.actionsCell} scope="col">
                관리
              </th>
            )}
            {clickable && (
              <th className={styles.chevronCell} scope="col">
                <span className="sr-only">상세</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);

            return (
              <tr
                className={clickable ? styles.rowClickable : undefined}
                key={rowKey(row)}
                onClick={
                  href
                    ? (event) => {
                        // 줄 안의 버튼·링크를 눌렀으면 그쪽 일만 하게 둡니다.
                        if (
                          event.target instanceof HTMLElement &&
                          event.target.closest("a, button, select, input")
                        ) {
                          return;
                        }
                        router.push(href);
                      }
                    : undefined
                }
              >
                {columns.map((column, index) => (
                  <td
                    className={column.numeric ? styles.numericCell : undefined}
                    key={column.key}
                  >
                    {/* 첫 칸만 링크로 감쌉니다. 키보드로 쓰는 길은 이 하나로
                        충분하고, 칸마다 링크를 두면 탭이 표 안에서 끝없이
                        돌게 됩니다. */}
                    {index === 0 && href ? (
                      <Link className={styles.rowLink} href={href}>
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
                {rowActions && (
                  <td className={styles.actionsCell}>{rowActions(row)}</td>
                )}
                {clickable && (
                  <td className={styles.chevronCell} aria-hidden="true">
                    ›
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
