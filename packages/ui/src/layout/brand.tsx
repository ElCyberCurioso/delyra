import { APP_NAME } from "@delyra/shared";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="delyra-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-1)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="url(#delyra-mark)" />
      <path
        d="M10 8h6.5a8 8 0 0 1 0 16H10z"
        fill="none"
        stroke="white"
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
      className="group flex items-center gap-2.5 rounded-lg text-[1.05rem] font-bold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <BrandMark className="size-8 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transition-none" />
      <span className="hidden sm:inline">{APP_NAME}</span>
      <span className="sr-only sm:hidden">{APP_NAME}</span>
    </a>
  );
}
