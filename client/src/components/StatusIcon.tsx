import type { StepStatus } from "../lib/types";

export function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "loading":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-5 h-5 animate-spin"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="32"
            strokeDashoffset="12"
          />
        </svg>
      );
    case "error":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-9a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1z"
            clipRule="evenodd"
          />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="w-5 h-5"
        >
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
  }
}
