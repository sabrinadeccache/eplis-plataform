import Link from "next/link";

export function BackLink({
  href = "/dashboard",
  children = "Página inicial",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="link mb-3 inline-flex items-center gap-1 text-sm !no-underline"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
        <path
          d="M10 3.5 5.5 8 10 12.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}
