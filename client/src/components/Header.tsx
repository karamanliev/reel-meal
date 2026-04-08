export function Header() {
  return (
    <header className="flex items-center gap-3 mb-6">
      <div className="w-9 h-9 text-primary-500 shrink-0" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
          <path d="M7 2v20" />
          <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-surface-900 dark:text-surface-50 m-0">
          Recipe Parser
        </h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 m-0">
          Import recipes from YouTube & Instagram into Mealie
        </p>
      </div>
    </header>
  );
}
