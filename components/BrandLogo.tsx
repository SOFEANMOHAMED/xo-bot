import React from 'react';

export const BRAND_LOGO_SRC = '/xo-bot-logo.png';
export const BRAND_MARK_SRC = '/xo-bot-mark.png';

type BrandLogoVariant = 'full' | 'mark';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  /** Decorative when paired with visible text; defaults to meaningful alt for full lockup */
  decorative?: boolean;
}

/**
 * Official Xo Bot brand mark / lockup.
 * Prefer `full` on light surfaces (includes wordmark). Use `mark` on dark surfaces or tight UI.
 */
const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'full',
  className = '',
  style,
  alt,
  decorative = false,
}) => {
  const src = variant === 'mark' ? BRAND_MARK_SRC : BRAND_LOGO_SRC;
  const resolvedAlt = decorative ? '' : alt ?? 'Xo Bot';

  return (
    <img
      src={src}
      alt={resolvedAlt}
      className={className}
      style={style}
      draggable={false}
      decoding="async"
      {...(decorative ? { 'aria-hidden': true as const } : {})}
    />
  );
};

export default BrandLogo;
