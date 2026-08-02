import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface SubscriptionStatus {
  isTrialExpired: boolean;
  isTrialActive: boolean;
  daysRemaining: number | null;
  requiresUpgrade: boolean;
}

export const useSubscriptionCheck = (): SubscriptionStatus => {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>({
    isTrialExpired: false,
    isTrialActive: false,
    daysRemaining: null,
    requiresUpgrade: false,
  });

  useEffect(() => {
    if (!user) {
      setStatus({
        isTrialExpired: false,
        isTrialActive: false,
        daysRemaining: null,
        requiresUpgrade: false,
      });
      return;
    }

    const subscriptionPlan = user.subscriptionPlan || 'trial';
    const subscriptionStatus = user.subscriptionStatus || 'active';
    const trialEndsAt = user.trialEndsAt;

    // Check if user is on trial plan
    const isTrial = subscriptionPlan === 'trial';

    if (isTrial && trialEndsAt) {
      const now = new Date();
      const trialEndDate = new Date(trialEndsAt);
      const diffTime = trialEndDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isExpired = now > trialEndDate;

      setStatus({
        isTrialExpired: isExpired,
        isTrialActive: !isExpired,
        daysRemaining: isExpired ? 0 : daysRemaining,
        requiresUpgrade: isExpired || subscriptionStatus === 'expired' || subscriptionStatus === 'suspended',
      });
    } else if (subscriptionStatus === 'expired' || subscriptionStatus === 'suspended') {
      setStatus({
        isTrialExpired: true,
        isTrialActive: false,
        daysRemaining: 0,
        requiresUpgrade: true,
      });
    } else {
      setStatus({
        isTrialExpired: false,
        isTrialActive: false,
        daysRemaining: null,
        requiresUpgrade: false,
      });
    }
  }, [user]);

  return status;
};

