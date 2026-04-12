import { useEffect, useState } from "react";

export function Footer() {
  const [mealieUrl, setMealieUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setMealieUrl((data as { mealieUrl: string }).mealieUrl))
      .catch(() => {});
  }, []);

  if (!mealieUrl) return null;

  return (
    <footer className="relative z-10 mt-auto py-4 text-center">
      <a
        href={mealieUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="neo-btn-secondary px-4 py-2 text-[0.82rem] no-underline"
      >
        Open your Mealie instance
      </a>
    </footer>
  );
}