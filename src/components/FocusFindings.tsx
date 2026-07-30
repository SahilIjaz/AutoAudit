"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VerifiedFinding, RepoMeta } from "@/engine/types";
import { FindingCard } from "./FindingCard";

type Dir = "next" | "prev";
const DURATION = 460;

/**
 * Shows one finding in a fixed slot. Advancing (Prev/Next buttons or scrolling
 * over the stage) animates the current card out while the next slides in to
 * take its place. The page length stays constant regardless of finding count.
 */
export function FocusFindings({
  findings,
  repo,
}: {
  findings: VerifiedFinding[];
  repo: RepoMeta;
}) {
  const total = findings.length;
  const [index, setIndex] = useState(0);
  const [anim, setAnim] = useState<{ prev: number; dir: Dir } | null>(null);
  const idxRef = useRef(0);
  const lock = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (dir: Dir) => {
      if (lock.current) return;
      const i = idxRef.current;
      const target = dir === "next" ? i + 1 : i - 1;
      if (target < 0 || target >= total) return;
      lock.current = true;
      idxRef.current = target;
      setAnim({ prev: i, dir });
      setIndex(target);
    },
    [total]
  );

  // Clear the outgoing card once its animation finishes.
  useEffect(() => {
    if (!anim) return;
    const t = window.setTimeout(() => {
      setAnim(null);
      lock.current = false;
    }, DURATION);
    return () => window.clearTimeout(t);
  }, [anim]);

  // Scroll over the stage to advance; falls back to page scroll at the ends.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 8) return;

      // With the depth analysis expanded a card can overflow its slot. Let it
      // scroll to its own edge before the wheel starts advancing findings.
      const card = activeRef.current;
      if (card && card.scrollHeight - card.clientHeight > 2) {
        const atTop = card.scrollTop <= 0;
        const atBottom = card.scrollTop + card.clientHeight >= card.scrollHeight - 1;
        if (e.deltaY > 0 ? !atBottom : !atTop) return;
      }

      const dir: Dir = e.deltaY > 0 ? "next" : "prev";
      const i = idxRef.current;
      const canMove = dir === "next" ? i < total - 1 : i > 0;
      if (canMove) {
        e.preventDefault();
        move(dir);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [move, total]);

  return (
    <div>
      <div ref={stageRef} className="swap-stage">
        {anim && (
          <div
            key={`out-${anim.prev}`}
            className={`swap-card ${anim.dir === "next" ? "swap-exit-next" : "swap-exit-prev"}`}
          >
            <FindingCard finding={findings[anim.prev]} repo={repo} />
          </div>
        )}
        <div
          key={`in-${index}`}
          ref={activeRef}
          className={`swap-card ${
            anim ? (anim.dir === "next" ? "swap-enter-next" : "swap-enter-prev") : ""
          }`}
        >
          <FindingCard finding={findings[index]} repo={repo} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span className="font-mono">
          <span className="text-[var(--text)]">{index + 1}</span> / {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => move("prev")}
            disabled={index === 0}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition-colors hover:text-[var(--text)] disabled:opacity-30"
          >
            ↑ Prev
          </button>
          <button
            type="button"
            onClick={() => move("next")}
            disabled={index === total - 1}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition-colors hover:text-[var(--text)] disabled:opacity-30"
          >
            Next ↓
          </button>
        </div>
      </div>
    </div>
  );
}
