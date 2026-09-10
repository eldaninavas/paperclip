import type { SVGProps } from "react";

interface PaperclipLockupProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  decorative?: boolean;
  title?: string;
}

/** Foundation lockup. The legacy export name remains an internal compatibility seam. */
export function PaperclipLockup({
  decorative = false,
  title = "Foundation",
  className,
  ...rest
}: PaperclipLockupProps) {
  return (
    <svg
      {...rest}
      className={className}
      viewBox="0 0 164 32"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      focusable="false"
    >
      <image href="/foundation-mark.svg?v=pillar-4" x="0" y="0" width="32" height="32" />
      <text
        x="42"
        y="22"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="18"
        fontWeight="650"
        letterSpacing="-0.35"
      >
        Foundation
      </text>
    </svg>
  );
}
