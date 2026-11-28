"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { copyText } from "@/lib/clipboard";
import { formatDate, freshness } from "@/lib/filter";
import { coverage, itemTime, plainSummary, sourceLabel } from "@/lib/front-page";
import type { FeedItem, Platform } from "@/lib/types";

import StoryImage, { useImageAvailable } from "./StoryImage";

interface RelatedRow {
  id: string;
  title: string;
  platformId: string;
  url: string;
  publishedAt: string | null;
  openable: boolean;
}

function relatedRows(item: FeedItem, knownIds: ReadonlySet<string>): RelatedRow[] {
  const rows = new Map<string, RelatedRow>();
  for (const r of item.relatedArticles ?? []) {
    rows.set(r.id, { id: r.id, title: r.hook_title, platformId: r.platform_id, url: r.canonical_url, publishedAt: r.published_at, openable: true });
  }
  for (const r of item.related_refs ?? []) {
    if (r.id === item.id || rows.has(r.id)) continue;
    rows.set(r.id, { id: r.id, title: r.title_ko, platformId: r.platform_id, url: r.canonical_url, publishedAt: r.published_at, openable: knownIds.has(r.id) });
  }
  return [...rows.values()];
}

function visionText(item: FeedItem): string {
  if (item.vision_ko) return item.vision_ko;
  const tip = item.utility_tip;
  if (tip) return `${tip.work_utility} ${tip.practical_tip}`.trim();
  return item.why_ko ?? "";
}

const CloseIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8 12l4-4M7 9.5L5.6 10.9a2.5 2.5 0 003.5 3.5L10.5 13M13 10.5l1.4-1.4a2.5 2.5 0 00-3.5-3.5L9.5 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ExternalIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8 5h7v7M15 5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EXIT_MS = 200;

/**
 * 애플 리퀴드 글래스 브리핑 모달 — 20초 안에 흐름과 비전을 얻어가는 6단 구성.
 * ESC · 바깥 클릭 · 우상단 닫기. 닫을 때 바디 스크롤 위치를 그대로 둔다(스크롤바 폭만큼 튀지 않게 gutter 고정).
 */
export default function BriefingModal({
  item,
  now,
  platformsById,
  knownIds,
  onOpen,
  onClose,
}: {
  item: FeedItem | null;
  now: number;
  platformsById: Map<string, Platform>;
  knownIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<FeedItem | null>(item);
  const [closing, setClosing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // 열기·전환은 즉시, 닫기는 짧은 퇴장 모션 뒤 언마운트
  useEffect(() => {
    if (item) {
      setShown(item);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const t = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
    // shown 은 퇴장 대상 보존용이라 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const open = Boolean(item);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    html.dataset.modal = "open";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const nodes = dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      delete html.dataset.modal;
      window.removeEventListener("keydown", onKey);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [shown?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const current = shown;
  const [imageOk, markFailed] = useImageAvailable(current?.image_url);
  if (!current) return null;

  const platform = platformsById.get(current.platform_id);
  const iso = new Date(itemTime(current, now)).toISOString();
  const fresh = freshness(iso, now);
  const n = coverage(current);
  const related = relatedRows(current, knownIds);
  const vision = visionText(current);
  const story = plainSummary(current);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(current.id)}`;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: current.hook_title, url });
        return;
      } catch {
        // 공유 시트를 닫으면 복사로 넘어간다
      }
    }
    setToast((await copyText(url)) ? "브리핑 링크를 복사했어요" : "복사하지 못했어요. 주소창 링크를 복사해 주세요");
  };

  return createPortal(
    <div className="briefing-root" data-state={closing ? "closed" : "open"}>
      <div className="briefing-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="briefing-title"
        tabIndex={-1}
        className="briefing-sheet"
      >
        <button type="button" className="briefing-close" onClick={onClose} aria-label="브리핑 닫기 (ESC)">
          <CloseIcon />
        </button>
        <div ref={scrollRef} className="briefing-scroll thin-scroll">
          {imageOk && current.image_url && (
            <StoryImage
              key={current.image_url}
              src={current.image_url}
              alt=""
              ratio="16 / 9"
              radius="1.25rem"
              priority
              onFail={markFailed}
              className="briefing-photo"
            />
          )}

          <p className="briefing-meta">
            {fresh.fresh && <span className="fresh-dot" aria-hidden="true" />}
            <span>{sourceLabel(current, platform?.name)}</span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <time dateTime={iso}>
              {formatDate(iso)} · {fresh.label}
            </time>
            {n > 1 && <span className="briefing-badge tnum">관련 기사 {n}곳 묶음</span>}
          </p>

          <h2 id="briefing-title" className="briefing-title">
            {current.hook_title}
          </h2>

          {story && (
            <section className="briefing-card" aria-labelledby="b-story">
              <h3 id="b-story">한눈에 보는 이야기</h3>
              <p>{story}</p>
            </section>
          )}

          {vision && (
            <section className="briefing-card briefing-vision" aria-labelledby="b-vision">
              <h3 id="b-vision">여기서 얻을 미래 비전 & 기회</h3>
              <p>{vision}</p>
            </section>
          )}

          {current.terms.length > 0 && (
            <section className="briefing-list" aria-labelledby="b-terms">
              <h3 id="b-terms">어려운 용어 쉽게 풀기</h3>
              <dl>
                {current.terms.slice(0, 4).map((t) => (
                  <div key={t.term}>
                    <dt>{t.term}</dt>
                    <dd>{t.easy}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {related.length > 0 && (
            <section className="briefing-list" aria-labelledby="b-related">
              <h3 id="b-related">같은 소식을 다룬 다른 곳</h3>
              <ul>
                {related.map((r) => (
                  <li key={r.id}>
                    {r.openable ? (
                      <button type="button" onClick={() => onOpen(r.id)}>
                        <span className="rel-src">{platformsById.get(r.platformId)?.name ?? r.platformId}</span>
                        <span className="rel-title">{r.title}</span>
                      </button>
                    ) : (
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        <span className="rel-src">{platformsById.get(r.platformId)?.name ?? r.platformId}</span>
                        <span className="rel-title">{r.title}</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="briefing-actions">
            <button type="button" className="btn-primary" onClick={share}>
              <ShareIcon />
              브리핑 링크 공유
            </button>
            <a className="btn-secondary" href={current.canonical_url} target="_blank" rel="noopener noreferrer">
              원본 기사·글 보러가기
              <ExternalIcon />
            </a>
          </div>
        </div>
      </div>
      {toast && (
        <div role="status" className="briefing-toast">
          {toast}
        </div>
      )}
    </div>,
    document.body,
  );
}
