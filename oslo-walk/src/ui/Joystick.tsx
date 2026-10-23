import { useRef } from 'react';

/** On-screen movement stick for touch devices (look by dragging anywhere else). */
export function Joystick({ onMove }: { onMove(x: number, y: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLElement>(null);
  const active = useRef<number | null>(null);

  const update = (t: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    knob.current!.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    onMove(dx, -dy);
  };
  const end = () => {
    active.current = null;
    knob.current!.style.transform = '';
    onMove(0, 0);
  };
  return (
    <div
      ref={ref}
      className="stick"
      aria-label="Movement control"
      onTouchStart={(e) => {
        e.stopPropagation();
        const t = e.changedTouches[0];
        active.current = t.identifier;
        update(t);
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
        for (const t of Array.from(e.changedTouches)) if (t.identifier === active.current) update(t);
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        end();
      }}
      onTouchCancel={end}
    >
      <i ref={knob} />
    </div>
  );
}
