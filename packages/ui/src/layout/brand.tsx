import { APP_NAME } from "@delyra/shared";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M10 8h6.5a8 8 0 0 1 0 16H10z"
        className="fill-none stroke-primary-foreground"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <BrandMark className="size-7" />
      <span className="hidden sm:inline">{APP_NAME}</span>
      <span className="sr-only sm:hidden">{APP_NAME}</span>
    </a>
  );
}
