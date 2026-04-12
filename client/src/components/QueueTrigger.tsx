import { useEffect, useRef, useState } from "react";
import layerIcon from "../assets/icons/layer.svg";

interface QueueTriggerProps {
  count: number;
  onClick: () => void;
}

export function QueueTrigger({ count, onClick }: QueueTriggerProps) {
  const [animating, setAnimating] = useState(false);
  const prevCountRef = useRef(count);

  useEffect(() => {
    if (count > prevCountRef.current) {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 300);
      prevCountRef.current = count;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = count;
  }, [count]);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`neo-btn min-h-[52px] gap-2 bg-blue text-white hover:bg-[#7bb8e8] ${animating ? "animate-pop" : ""}`}
    >
      <img src={layerIcon} alt="" className="h-5 w-5" />
      <span className="font-800">{count}</span>
    </button>
  );
}