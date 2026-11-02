import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A floating menu that opens next to the element that was clicked. On phones, CSS turns it into a bottom sheet. */
export function FloatingMenu({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      if (!el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
      const below = r.bottom + 10;
      const top = below + h > window.innerHeight - 12 ? Math.max(12, r.top - h - 10) : below;
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, children]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      if (document.body.contains(anchor)) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose]);

  // A portal still passes events up the React tree, and the badge sits inside a bot row that selects itself on click.
  const keep = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <>
      <div
        className="pop-scrim"
        onClick={(e) => {
          keep(e);
          onClose();
        }}
      />
      <div ref={box} className="pop" role="dialog" aria-label={label} onClick={keep} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}>
        {children}
      </div>
    </>,
    document.body,
  );
}
