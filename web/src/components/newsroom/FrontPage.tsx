"use client";

import { memo, useEffect, useRef, useState, type MouseEvent } from "react";

import { freshness } from "@/lib/filter";
import { coverage, itemTime, plainSummary, sourceLabel, type FrontPageLayout } from "@/lib/front-page";
import { tooltipTerms } from "@/lib/glossary";
import type { FeedItem, Platform } from "@/lib/types";

import TermText from "../TermText";
import StoryImage, { useImageAvailable } from "./StoryImage";

export type CardVariant = "hero" | "side" | "wire" | "feature" | "stream";

interface CardContext {
  now: number;
  platformsById: Map<string, Platform>;
  readIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
}

const isRead = (item: FeedItem, readIds: ReadonlySet<string>): boolean => readIds.has(item.id);

function ReadMark() {
  return (
    <span className="read-mark" aria-label="읽은 기사">
      읽음
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Meta({ item, ctx, showCluster = true }: { item: FeedItem; ctx: CardContext; showCluster?: boolean }) {
  const iso = new Date(itemTime(item, ctx.now)).toISOString();
  const f = freshness(iso, ctx.now);
  const n = coverage(item);
  return (
    <p className="story-meta">
      {f.fresh && <span className="fresh-dot" aria-hidden="true" />}
      <time dateTime={iso}>{f.label}</time>
      <span className="sep" aria-hidden="true">
        |
      </span>
      <span className="truncate">{sourceLabel(item, ctx.platformsById.get(item.platform_id)?.name)}</span>
      {showCluster && n > 1 && (
        <>
          <span className="sep" aria-hidden="true">
            |
          </span>
          <span className="tnum">{n}곳 묶음</span>
        </>
      )}
      {isRead(item, ctx.readIds) && <ReadMark />}
    </p>
  );
}

const StoryCard = memo(function StoryCard({ item, variant, ctx }: { item: FeedItem; variant: CardVariant; ctx: CardContext }) {
  const [imageOk, markFailed] = useImageAvailable(variant === "wire" ? null : item.image_url);
  const read = isRead(item, ctx.readIds);
  const summary = plainSummary(item);
  const n = coverage(item);
  const open = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    ctx.onOpen(item.id);
  };
  const Title = variant === "hero" ? "h2" : "h3";

  return (
    <article
      className="story"
      data-variant={variant}
      data-read={read}
      data-has-image={imageOk}
      data-item-id={item.id}
    >
      {imageOk && item.image_url && (
        <StoryImage
          src={item.image_url}
          alt=""
          ratio={variant === "stream" ? "4 / 3" : "16 / 10"}
          radius={variant === "hero" ? "1.125rem" : variant === "stream" ? "0.75rem" : "0.875rem"}
          priority={variant === "hero"}
          sizes={variant === "hero" ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 100vw"}
          onFail={markFailed}
          className="story-media"
        />
      )}
      <div className="story-body">
        {variant === "hero" && n > 1 && (
          <p className="cluster-chip">
            <span className="tnum">외신·X 등 {n}곳</span> 집중 조명
          </p>
        )}
        <Title className="story-title">
          <a href={`?item=${encodeURIComponent(item.id)}`} onClick={open} className="story-link">
            {item.hook_title}
          </a>
        </Title>
        {summary && <TermText text={summary} terms={tooltipTerms(item)} className="story-summary" />}
        <Meta item={item} ctx={ctx} showCluster={variant !== "hero"} />
      </div>
    </article>
  );
});

const STREAM_BATCH = 24;

function Stream({ items, ctx }: { items: FeedItem[]; ctx: CardContext }) {
  const [visible, setVisible] = useState(STREAM_BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  const remaining = items.length - visible;

  useEffect(() => {
    if (remaining <= 0) return;
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + STREAM_BATCH);
      },
      { rootMargin: "600px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [remaining]);

  return (
    <>
      <ol className="stream-list">
        {items.slice(0, visible).map((item) => (
          <li key={item.id}>
            <StoryCard item={item} variant="stream" ctx={ctx} />
          </li>
        ))}
      </ol>
      {remaining > 0 && <div ref={sentinel} className="h-16" aria-hidden="true" />}
    </>
  );
}

function SectionHead({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <header className="section-head">
      <h2 id={id}>{title}</h2>
      {note && <span className="tnum">{note}</span>}
    </header>
  );
}

export default function FrontPage({
  layout,
  now,
  platformsById,
  readIds,
  onOpen,
  wireTitle = "최신 속보",
  streamTitle = "시간순 전체 소식",
}: {
  layout: FrontPageLayout;
  wireTitle?: string;
  streamTitle?: string;
} & CardContext) {
  const ctx: CardContext = { now, platformsById, readIds, onOpen };
  const { hero, side, wire, features, stream } = layout;

  return (
    <div className="front">
      {hero && (
        <section className="front-grid" aria-label="오늘의 1면">
          <div className="col-hero">
            <StoryCard item={hero} variant="hero" ctx={ctx} />
          </div>
          {wire.length > 0 && (
            <aside className="col-wire" aria-labelledby="wire-title">
              <header className="wire-head">
                <span className="fresh-dot" aria-hidden="true" />
                <h2 id="wire-title">{wireTitle}</h2>
              </header>
              <ol>
                {wire.map((item) => (
                  <li key={item.id}>
                    <StoryCard item={item} variant="wire" ctx={ctx} />
                  </li>
                ))}
              </ol>
            </aside>
          )}
          {side.length > 0 && (
            <div className="col-side">
              {side.map((item) => (
                <StoryCard key={item.id} item={item} variant="side" ctx={ctx} />
              ))}
            </div>
          )}
        </section>
      )}

      {features.length > 0 && (
        <section className="feature-band" aria-labelledby="feature-title">
          <SectionHead id="feature-title" title="사진으로 보는 주요 소식" />
          <div className="feature-grid">
            {features.map((item) => (
              <StoryCard key={item.id} item={item} variant="feature" ctx={ctx} />
            ))}
          </div>
        </section>
      )}

      {stream.length > 0 && (
        <section className="stream-band" aria-labelledby="stream-title">
          <SectionHead id="stream-title" title={streamTitle} note={`${stream.length}건`} />
          <Stream items={stream} ctx={ctx} />
        </section>
      )}
    </div>
  );
}
