import layerIcon from "../assets/icons/layer.svg?raw";
import { Icon } from "./Icon";

interface QueueTriggerProps {
  count: number;
  onClick: () => void;
}

export function QueueTrigger({ count, onClick }: QueueTriggerProps) {
  return (
    <button
      type="button"
      title="Processing queue"
      onClick={onClick}
      className="neo-btn-secondary bg-blue text-ink hover:bg-[#7bb8e8] !px-3 !py-2 text-[0.82rem]"
    >
      <span
        key={count}
        className={`inline-flex items-center gap-1.5 ${count > 0 ? "animate-pop" : ""}`}
      >
        <Icon src={layerIcon} className="h-5 w-5" />
        {count > 0 && <span className="font-800">{count}</span>}
      </span>
    </button>
  );
}
