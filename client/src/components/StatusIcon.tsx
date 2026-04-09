import type { StepStatus } from "../lib/types";

export function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <circle cx="12" cy="12" r="10" fill="#b9ef73" stroke="#171717" strokeWidth="2.5" />
          <path
            d="M7 12.5L10.5 16L17 9"
            stroke="#171717"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "loading":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 animate-spin-slow">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="#171717"
            strokeOpacity="0.18"
            strokeWidth="3"
          />
          <path
            d="M12 3A9 9 0 0 1 21 12"
            stroke="#171717"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "error":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <circle cx="12" cy="12" r="10" fill="#ff9485" stroke="#171717" strokeWidth="2.5" />
          <path
            d="M8.5 8.5L15.5 15.5M15.5 8.5L8.5 15.5"
            stroke="#171717"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="#fffaf2"
            stroke="#171717"
            strokeWidth="2.5"
            strokeDasharray="5 3"
          />
        </svg>
      );
  }
}
