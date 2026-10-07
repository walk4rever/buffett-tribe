type BtLogoMarkProps = {
  className?: string;
};

export function BtLogoMark({ className }: BtLogoMarkProps) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Apple Blue (#0071e3) Squircle background */}
      <rect width="512" height="512" rx="112" fill="#0071e3" />

      {/* Air7.fun "7 in flight" / "A" in Pure White */}
      <path
        d="M 88 174 L 418 108 L 192 408"
        fill="none"
        stroke="#ffffff"
        strokeWidth="58"
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
      />

      <line
        x1="142"
        y1="258"
        x2="348"
        y2="258"
        stroke="#ffffff"
        strokeWidth="42"
        strokeLinecap="round"
      />
    </svg>
  );
}
