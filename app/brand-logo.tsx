import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = Readonly<{
  /** Home link; pass `null` for a non-clickable mark. */
  href?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}>;

const SIZE_PX = { sm: 40, md: 56, lg: 72 } as const;

export function BrandLogo({ href = "/", size = "md", className }: BrandLogoProps) {
  const px = SIZE_PX[size];
  const image = (
    <Image
      src="/brand/logo.png"
      alt=""
      width={px}
      height={px}
      className={`brand-logo brand-logo-${size}${className ? ` ${className}` : ""}`}
      priority={size !== "sm"}
    />
  );
  if (href === null) {
    return <span className="brand-logo-wrap" aria-hidden="true">{image}</span>;
  }
  return (
    <Link href={href} className="brand-logo-link" aria-label="Email Triage home">
      {image}
    </Link>
  );
}
