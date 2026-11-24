export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="brand-book-svg"
    >
      <path
        d="M3.5 5.2C3.5 4.54 4.04 4 4.7 4H9.6C10.93 4 12 5.07 12 6.4V19.6C11.1 18.85 9.95 18.4 8.7 18.4H4.7C4.04 18.4 3.5 17.86 3.5 17.2V5.2Z"
        fill="var(--color-terracotta)"
      />
      <path
        d="M20.5 5.2C20.5 4.54 19.96 4 19.3 4H14.4C13.07 4 12 5.07 12 6.4V19.6C12.9 18.85 14.05 18.4 15.3 18.4H19.3C19.96 18.4 20.5 17.86 20.5 17.2V5.2Z"
        fill="var(--color-accent)"
      />
      <path d="M12 6.2V19.4" stroke="var(--color-surface)" strokeWidth="1.25" />
    </svg>
  );
}
