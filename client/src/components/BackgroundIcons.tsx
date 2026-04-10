import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import burgerSvg from "../assets/icons/burger.svg?raw";
import cakeSvg from "../assets/icons/cake.svg?raw";
import eggSvg from "../assets/icons/egg.svg?raw";
import pizzaSvg from "../assets/icons/pizza.svg?raw";

const toMaskUrl = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

const ICONS = [burgerSvg, cakeSvg, eggSvg, pizzaSvg].map(toMaskUrl);

const COLORS = [
  "#fdd36b",
  "#ff63b7",
  "#a9d0f3",
  "#cdf86c",
  "#ffc8a9",
  "#ff9485",
  "#ffd96a",
  "#b9ef73",
];

interface Placement {
  id: number;
  icon: string;
  color: string;
  x: number;
  y: number;
  baseRotation: number;
  size: number;
}

function generatePlacements(): Placement[] {
  const rand = Math.random;
  const placements: Placement[] = [];
  const placed: { x: number; y: number }[] = [];

  for (let i = 0; i < 12; i++) {
    let x: number;
    let y: number;
    let attempts = 0;

    do {
      x = 5 + rand() * 90;
      y = 5 + rand() * 90;
      attempts++;
    } while (
      attempts < 50 &&
      placed.some((p) => Math.hypot(p.x - x, p.y - y) < 14)
    );

    placed.push({ x, y });

    placements.push({
      id: i,
      icon: ICONS[i % ICONS.length],
      color: COLORS[i % COLORS.length],
      x,
      y,
      baseRotation: -30 + rand() * 60,
      size: 72 + rand() * 56,
    });
  }

  return placements;
}

export function BackgroundIcons() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: -9999, y: -9999 });
  const [raf, setRaf] = useState(0);

  const placements = useMemo(() => generatePlacements(), []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      const id = requestAnimationFrame(() => {
        setMousePos({ x: e.clientX, y: e.clientY });
      });
      setRaf(id);
    },
    [raf],
  );

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(raf);
    };
  }, [handleMouseMove, raf]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {placements.map((p) => {
        const el = containerRef.current;
        const w = el ? el.clientWidth : 1;
        const h = el ? el.clientHeight : 1;
        const px = (p.x / 100) * w;
        const py = (p.y / 100) * h;
        const dx = mousePos.x - px;
        const dy = mousePos.y - py;
        const dist = Math.hypot(dx, dy);
        const threshold = 220;
        const proximity = Math.max(0, 1 - dist / threshold);

        const wiggle = proximity * 12 * Math.sin(Date.now() / 180 + p.id);
        const tilt = proximity * (dx > 0 ? 8 : -8);
        const scale = 1 + proximity * 0.25;
        const rotation = p.baseRotation + tilt + wiggle;

        return (
          <div
            key={p.id}
            className="bg-icon"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              maskImage: p.icon,
              WebkitMaskImage: p.icon,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
              transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
              transition: "transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            }}
          />
        );
      })}
    </div>
  );
}
