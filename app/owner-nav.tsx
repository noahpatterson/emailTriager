import Link from "next/link";

export type OwnerNavActive = "home" | "review" | "demotion" | "configuration" | "settings" | "run";

const LINKS = [
  { id: "home", href: "/", label: "Sync" },
  { id: "review", href: "/review", label: "Review" },
  { id: "demotion", href: "/demotion", label: "Demotions" },
] as const satisfies ReadonlyArray<{
  id: OwnerNavActive;
  href: string;
  label: string;
}>;

export function OwnerNav({
  active,
}: {
  active: OwnerNavActive;
}) {
  return (
    <nav className="owner-nav" aria-label="Owner console">
      {LINKS.map((link) => {
        const isActive = link.id === active
          || (active === "run" && link.id === "home");
        return (
          <Link
            key={link.id}
            href={link.href}
            className={isActive ? "owner-nav-link is-active" : "owner-nav-link"}
            aria-current={isActive ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
