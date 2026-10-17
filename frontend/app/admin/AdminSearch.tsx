"use client";

/**
 * Admin 위쪽의 찾기 (admin-consolidation v3) — 회원·앱 이름으로. ⌘K(또는
 * Ctrl+K)로 바로 갑니다. 회원은 회원 상세로, 앱은 Community › 앱의 상세로.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { searchAdmin, type AdminSearchResult } from "@/lib/admin";

import styles from "./admin.module.css";

const EMPTY: AdminSearchResult = { members: [], apps: [] };

export default function AdminSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<AdminSearchResult>(EMPTY);
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
            setActive(0);
          }
        })
        .catch(() => {
          if (!stale) setFound(EMPTY);
        });
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const links = [
    ...found.members.map((member) => ({
      key: `m${member.id}`,
      href: `/admin/members/${member.id}`,
      label: member.display_name,
      meta: `@${member.username}`,
      group: "회원",
    })),
    ...found.apps.map((app) => ({
      key: `a${app.id}`,
      href: `/admin/apps/${app.id}`,
      label: app.name,
      meta: `@${app.owner_username}`,
      group: "앱",
    })),
  ];
  const shown = open && query.trim() !== "";

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
      {!query && <span className={styles.searchKey} aria-hidden="true">⌘K</span>}
      {shown && (
        <ul className={styles.searchResults} id={listId} role="listbox" aria-label="찾은 것">
          {links.length === 0 && <li className={styles.searchGroup}>찾은 것이 없어요</li>}
          {links.map((link, index) => (
            <li key={link.key} role="option" id={`${listId}-${link.key}`} aria-selected={index === active}>
              {(index === 0 || links[index - 1].group !== link.group) && (
                <div className={styles.searchGroup}>{link.group}</div>
              )}
              <Link
                className={styles.searchItem}
                data-active={index === active}
                href={link.href}
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(link.href);
                }}
              >
                {link.label} <span className={styles.searchMeta}>{link.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
