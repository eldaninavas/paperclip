import type { SVGProps } from "react";

interface FoundationLockupProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  decorative?: boolean;
  title?: string;
}

export function FoundationLockup({
  decorative = false,
  title = "Foundation by Davaria",
  className,
  ...rest
}: FoundationLockupProps) {
  return (
    <svg
      {...rest}
      className={className}
      viewBox="0 0 210 32"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      focusable="false"
    >
      <image href="/foundation-mark.svg?v=pillar-4" x="0" y="0" width="32" height="32" />
      <text
        x="42"
        y="18"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="17"
        fontWeight="650"
        letterSpacing="-0.35"
      >
        Foundation
      </text>
      <text
        x="42"
        y="30"
        fill="currentColor"
        opacity="0.58"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="9"
        fontWeight="500"
        letterSpacing="0.8"
      >
        DAVARIA
      </text>
    </svg>
  );
}
