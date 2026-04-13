interface IconProps {
  src: string; // raw SVG string (imported with ?raw)
  className?: string;
}

export function Icon({ src, className = "h-4 w-4" }: IconProps) {
  const maskUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(src)}")`;
  return (
    <span
      className={`inline-block shrink-0 ${className}`}
      style={{
        backgroundColor: "currentColor",
        maskImage: maskUrl,
        WebkitMaskImage: maskUrl,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
