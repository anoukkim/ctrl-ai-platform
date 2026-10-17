"use client";

/**
 * Admin 위쪽의 찾기 (admin-consolidation v3) — 회원·앱 이름으로. ⌘K(또는
 * Ctrl+K)로 바로 갑니다. 회원은 회원 상세로, 앱은 Community › 앱의 상세로.
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { searchAdmin, type AdminSearchResult } from "@/lib/admin";

import { withQuarter } from "./AdminQuarterProvider";

import styles from "./admin.module.css";

const EMPTY: AdminSearchResult = { members: [], apps: [] };

export default function AdminSearch({ quarterId = null }: { quarterId?: number | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<AdminSearchResult>(EMPTY);
  // The query the results answer — while a newer one is on its way, Enter
  // and the list wait rather than open a stale result.
  const [answered, setAnswered] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // ⌘K / Ctrl+K anywhere in Admin.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const text = query.trim();
    let stale = false;
    const timer = window.setTimeout(() => {
      if (!text) {
        setFound(EMPTY);
        return;
      }
      searchAdmin(text)
        .then((result) => {
          if (!stale) {
            setFound(result);
            setAnswered(text);
            setActive(0);
          }
        })
        .catch(() => {
          if (!stale) {
            setFound(EMPTY);
            setAnswered(text);
          }
        });
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const fresh = answered === query.trim();
  const links = !fresh ? [] : [
    ...found.members.map((member) => ({
      key: `m${member.id}`,
      href: withQuarter(`/admin/members/${member.id}`, quarterId),
      label: member.display_name,
      meta: `@${member.username}`,
      group: "회원",
    })),
    ...found.apps.map((app) => ({
      key: `a${app.id}`,
      href: withQuarter(`/admin/apps/${app.id}`, quarterId),
      label: app.name,
      meta: `@${app.owner_username}`,
      group: "앱",
    })),
  ];
  const shown = open && query.trim() !== "";
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <div className={styles.search}>
      <input
        ref={inputRef}
        className={`field ${styles.searchField}`}
        type="search"
        placeholder="회원·앱 이름으로 찾기"
        aria-label="회원·앱 이름으로 찾기"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && links[active] ? `${listId}-${links[active].key}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(links.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && links[active]) {
            event.preventDefault();
            go(links[active].href);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {!query && <span className={styles.searchKey} aria-hidden="true">{mac ? "⌘K" : "Ctrl K"}</span>}
      {shown && (
        <ul className={styles.searchResults} id={listId} role="listbox" aria-label="찾은 것">
          {!fresh && (
            <li role="presentation" className={styles.searchGroup}>
              찾는 중…
            </li>
          )}
          {fresh && links.length === 0 && (
            <li role="presentation" className={styles.searchGroup}>
              찾은 것이 없어요
            </li>
          )}
          {links.flatMap((link, index) => {
            const items = [];
            if (index === 0 || links[index - 1].group !== link.group) {
              items.push(
                <li key={`g-${link.group}`} role="presentation" className={styles.searchGroup}>
                  {link.group}
                </li>,
              );
            }
            items.push(
              <li
                key={link.key}
                role="option"
                id={`${listId}-${link.key}`}
                aria-selected={index === active}
                className={styles.searchItem}
                data-active={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(link.href);
                }}
              >
                {link.label} <span className={styles.searchMeta}>{link.meta}</span>
              </li>,
            );
            return items;
          })}
        </ul>
      )}
    </div>
  );
}
