import { useEffect, useState } from "react";
import saladMascot from "../assets/images/salad.png";
import linkIcon from "../assets/icons/link.svg";
import { QueueTrigger } from "./QueueTrigger";

interface HeaderProps {
  queueCount: number;
  onQueueClick: () => void;
}

export function Header({ queueCount, onQueueClick }: HeaderProps) {
  const [mealieUrl, setMealieUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setMealieUrl((data as { mealieUrl: string }).mealieUrl))
      .catch(() => {});
  }, []);

  return (
    <header className="w-full animate-bounce-in">
      <div className="neo-bar relative overflow-hidden px-4 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="hidden sm:flex relative h-[5.25rem] w-[5.25rem] shrink-0 items-center justify-center">
              <img
                src={saladMascot}
                alt=""
                className="pointer-events-none h-20 w-auto object-contain"
              />
            </div>

            <div className="flex flex-col gap-0.5">
              <h1 className="m-0 text-[2.2rem] leading-none sm:text-[3.2rem]">
                <span data-text="ReelMeal" className="neo-logo-text">
                  ReelMeal
                </span>
              </h1>
              <p className="hidden sm:block m-0 text-[0.9rem] leading-[1.2] font-400 italic text-ink">
                From reels to meals
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {mealieUrl && (
              <a
                href={mealieUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="neo-btn-secondary no-underline gap-1.5 !px-3 !py-2 text-[0.82rem]"
                title="Open your Mealie instance"
              >
                <img src={linkIcon} alt="" className="h-4 w-4" />
                <span className="hidden sm:inline">Mealie</span>
              </a>
            )}

            <QueueTrigger count={queueCount} onClick={onQueueClick} />
          </div>
        </div>
      </div>
    </header>
  );
}

