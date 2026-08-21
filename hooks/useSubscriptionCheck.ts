import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

/** Show renewal warning when 5 days or fewer remain on a paid plan. */
export const RENEWAL_WARNING_DAYS = 5;

export interface SubscriptionStatus {
  isTrialExpired: boolean;
  isTrialActive: boolean;
  /** Paid subscription period ended (or status expired/suspended). */
  isSubscriptionExpired: boolean;
  /** Paid plan still active and within the warning window. */
  isRenewalWarning: boolean;
  daysRemaining: number | null;
  msRemaining: number | null;
  requiresUpgrade: boolean;
  subscriptionEndsAt: string | null;
}

function msUntil(dateValue: string | Date | null | undefined): number | null {
  if (!dateValue) return null;
  const end = new Date(dateValue);
  if (Number.isNaN(end.getTime())) return null;
  return end.getTime() - Date.now();
}

export const useSubscriptionCheck = (): SubscriptionStatus => {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>({
    isTrialExpired: false,
    isTrialActive: false,
    isSubscriptionExpired: false,
    isRenewalWarning: false,
    daysRemaining: null,
    msRemaining: null,
    requiresUpgrade: false,
    subscriptionEndsAt: null,
  });

  useEffect(() => {
    if (!user) {
      setStatus({
        isTrialExpired: false,
        isTrialActive: false,
        isSubscriptionExpired: false,
        isRenewalWarning: false,
        daysRemaining: null,
        msRemaining: null,
        requiresUpgrade: false,
        subscriptionEndsAt: null,
      });
      return;
    }

    const subscriptionPlan = user.subscriptionPlan || 'trial';
    const subscriptionStatus = user.subscriptionStatus || 'active';
    const trialEndsAt = user.trialEndsAt;
    const subscriptionEndsAt = user.subscriptionEndsAt ?? null;
    const isTrial = subscriptionPlan === 'trial';
    const statusBlocked =
      subscriptionStatus === 'expired' || subscriptionStatus === 'suspended';

    const compute = () => {
      if (isTrial && trialEndsAt) {
        const remaining = msUntil(trialEndsAt);
        const isExpired = remaining !== null && remaining <= 0;
        const daysRemaining =
          remaining === null ? null : Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)));

        setStatus({
          isTrialExpired: isExpired,
          isTrialActive: !isExpired,
          isSubscriptionExpired: isExpired || statusBlocked,
          isRenewalWarning: false,
          daysRemaining: isExpired ? 0 : daysRemaining,
          msRemaining: isExpired ? 0 : remaining,
          requiresUpgrade: isExpired || statusBlocked,
          subscriptionEndsAt: null,
        });
        return;
      }

      if (statusBlocked) {
        setStatus({
          isTrialExpired: false,
          isTrialActive: false,
          isSubscriptionExpired: true,
          isRenewalWarning: false,
          daysRemaining: 0,
          msRemaining: 0,
          requiresUpgrade: true,
          subscriptionEndsAt,
        });
        return;
      }

      // Paid plan with end date
      if (!isTrial && subscriptionEndsAt) {
        const remaining = msUntil(subscriptionEndsAt);
        const isExpired = remaining !== null && remaining <= 0;
        const daysRemaining =
          remaining === null ? null : Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)));
        const isRenewalWarning =
          !isExpired &&
          remaining !== null &&
          remaining <= RENEWAL_WARNING_DAYS * 24 * 60 * 60 * 1000;

        setStatus({
          isTrialExpired: false,
          isTrialActive: false,
          isSubscriptionExpired: isExpired,
          isRenewalWarning,
          daysRemaining: isExpired ? 0 : daysRemaining,
          msRemaining: isExpired ? 0 : remaining,
          requiresUpgrade: isExpired,
          subscriptionEndsAt,
        });
        return;
      }

      setStatus({
        isTrialExpired: false,
        isTrialActive: false,
        isSubscriptionExpired: false,
        isRenewalWarning: false,
        daysRemaining: null,
        msRemaining: null,
        requiresUpgrade: false,
        subscriptionEndsAt,
      });
    };

    compute();
    // Tick every 30s so the countdown stays accurate in the warning window
    const interval = window.setInterval(compute, 30_000);
    return () => window.clearInterval(interval);
  }, [user]);

  return status;
};
