interface BrandGlyphProps {
  size?: number;
  className?: string;
}

/**
 * Brand mark: a crescent moon inside a fine orbit, with a small four-point
 * spark. Uses currentColor so every surface can theme it.
 */
export function BrandGlyph({ size = 24, className }: BrandGlyphProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="24"
        cy="24"
        r="19.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.34"
      />
      <circle
        cx="24"
        cy="24"
        r="16.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.18"
      />
      <path
        d="M30.2 12.4a11.8 11.8 0 1 0 0 23.2 13.9 13.9 0 1 1 0-23.2Z"
        fill="currentColor"
      />
      <path
        d="M34.2 11.2c.4 3.1 1.8 4.5 4.9 4.9-3.1.4-4.5 1.8-4.9 4.9-.4-3.1-1.8-4.5-4.9-4.9 3.1-.4 4.5-1.8 4.9-4.9Z"
        fill="currentColor"
        opacity="0.94"
      />
      <circle cx="14.4" cy="28.6" r="1.15" fill="currentColor" opacity="0.62" />
      <circle cx="33.8" cy="34.2" r="0.9" fill="currentColor" opacity="0.48" />
    </svg>
  );
}
