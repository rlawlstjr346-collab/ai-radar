"use client";

import { Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { buildProjectGuide } from "@/lib/project-guide";
import type { FeedItem } from "@/lib/types";

/**
 * [내 프로젝트에 이 기술 써볼까? · 실전 도입 가이드] 아코디언.
 * 접혀 있을 땐 예전 버튼과 같은 자리·크기의 한 줄이고, 누르면 아래로 부드럽게 펼쳐진다 (grid-rows 0fr → 1fr).
 */
export default function ProjectGuide({ item, platformName }: { item: FeedItem; platformName?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const id = useId();
  const guide = buildProjectGuide(item, platformName);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="press inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[0.86rem] text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.8} aria-hidden />
        내 프로젝트에 이 기술 써볼까?
        <span className="text-fg-3">· 실전 도입 가이드</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      <div
        id={id}
        role="region"
        aria-label="실전 도입 가이드"
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div className="inset-health-card mt-2 flex flex-col gap-4 p-5">
            <section className="flex flex-col gap-1">
              <h4 className="text-[0.85rem] font-bold text-fg">① 이럴 때 바로 써보세요</h4>
              <p className="text-[0.92rem] leading-[1.7] text-fg-2">{guide.useWhen}</p>
            </section>
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[0.85rem] font-bold text-fg">② 도입 체크포인트</h4>
              <ul className="flex flex-col gap-1.5">
                {guide.checkpoints.map((c) => (
                  <li key={c.label} className="flex gap-2 text-[0.9rem] leading-[1.65] text-fg-2">
                    <span className="shrink-0 font-semibold text-fg">{c.label}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-2">
              <h4 className="text-[0.85rem] font-bold text-fg">③ AI 코딩 에이전트(Claude·Cursor)에 붙여 넣을 프롬프트</h4>
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-elevated/80 p-3.5 font-sans text-[0.84rem] leading-[1.6] text-fg-2">{guide.prompt}</pre>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => setCopied((await copyText(guide.prompt)) ? "ok" : "fail")}
                  className="press inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[0.84rem] font-medium text-fg hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {copied === "ok" ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  복사
                </button>
                <span role="status" className="text-[0.8rem] text-fg-3">
                  {copied === "ok" ? "프롬프트가 복사됐어요" : copied === "fail" ? "복사하지 못했어요. 위 글을 직접 선택해 복사해 주세요" : ""}
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
