import React from 'react';

interface PaymentMethodLogoProps {
  methodId: string;
  className?: string;
}

/** Sham Cash — original green mark with a cash note (not a third-party bitmap). */
export const ShamCashLogo: React.FC<{ className?: string }> = ({ className = 'w-12 h-12' }) => {
  const gradId = React.useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#17C45A" />
          <stop offset="1" stopColor="#0A8F42" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradId})`} />
      <rect x="9" y="15" width="30" height="18" rx="4" fill="#fff" />
      <path
        d="M13 20h6M13 24h4M13 28h5"
        stroke="#0A8F42"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle cx="31" cy="24" r="5.2" fill="#0A8F42" />
      <path
        d="M31 21.2v5.6M28.8 22.6c.5-.7 1.3-1.1 2.2-1.1 1.4 0 2.3.7 2.3 1.8 0 2.2-4.5 1.2-4.5 3.2 0 .9.8 1.6 2.2 1.6 1.1 0 1.8-.3 2.3-1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** Tether USDT — green disc with the familiar ₮ mark. */
export const UsdtLogo: React.FC<{ className?: string }> = ({ className = 'w-12 h-12' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#26A17B" />
    <path
      fill="#fff"
      d="M15 14.5h18v3.6H26.6v4.2c4.7.25 8.2 1.35 8.2 2.65s-3.5 2.4-8.2 2.65v8.9h-5.2v-8.9c-4.7-.25-8.2-1.35-8.2-2.65s3.5-2.4 8.2-2.65v-4.2H15V14.5zm6.4 11.05c-3.15.18-5.35.7-5.35 1.25s2.2 1.07 5.35 1.25v-2.5zm5.2 0v2.5c3.15-.18 5.35-.7 5.35-1.25s-2.2-1.07-5.35-1.25z"
    />
  </svg>
);

export const PaymentMethodLogo: React.FC<PaymentMethodLogoProps> = ({
  methodId,
  className = 'w-12 h-12',
}) => {
  if (methodId === 'usdt') return <UsdtLogo className={className} />;
  return <ShamCashLogo className={className} />;
};

export function paymentMethodHint(methodId: string, network?: string): string {
  if (methodId === 'usdt') {
    return network ? `تيثر · شبكة ${network}` : 'تحويل تيثر (USDT)';
  }
  return 'محفظة إلكترونية سورية';
}
