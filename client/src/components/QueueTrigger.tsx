import { useEffect, useRef, useState } from "react";
import layerIcon from "../assets/icons/layer.svg?raw";
import { Icon } from "./Icon";

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

  return (
    <button
      type="button"
      title="Processing queue"
      onClick={onClick}
      className={`neo-btn-secondary gap-1.5 bg-blue text-ink hover:bg-[#7bb8e8] !px-3 !py-2 text-[0.82rem] ${animating ? "animate-pop" : ""}`}
    >
      <Icon src={layerIcon} className="h-5 w-5" />
      {count > 0 && <span className="font-800">{count}</span>}
    </button>
  );
}