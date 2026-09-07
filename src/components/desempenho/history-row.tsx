import Link from "next/link";

export function HistoryRow({
  href,
  label,
  badgeText,
  badgeClass,
}: {
  href: string;
  label: string;
  badgeText: string;
  badgeClass: string;
}) {
  return (
    <Link
      href={href}
      className="card-link flex items-center justify-between gap-3 p-4 text-sm"
    >
      <span className="text-ink">{label}</span>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}
      >
        {badgeText}
      </span>
    </Link>
  );
}
