interface StarGlyphProps {
  size?: number;
  className?: string;
}

/** Four-point sparkle used for spine nodes and ornaments. */
export function StarGlyph({ size = 16, className }: StarGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 1.6c.55 5.55 3.25 8.25 8.8 8.8-5.55.55-8.25 3.25-8.8 8.8-.55-5.55-3.25-8.25-8.8-8.8 5.55-.55 8.25-3.25 8.8-8.8Z"
        fill="currentColor"
      />
      <circle cx="19.3" cy="4.7" r="1.15" fill="currentColor" opacity=".65" />
    </svg>
  );
}
