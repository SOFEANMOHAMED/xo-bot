import { useEffect, useRef } from 'react';
import apiService from '../services/api';

/**
 * Sets default phone dial code from visitor geo (IP / CDN headers).
 * Skips if the user manually picked a country code.
 */
export function useVisitorCountryDialCode(
  onDialCode: (dialCode: string) => void,
  enabled = true
) {
  const userPickedRef = useRef(false);
  const appliedRef = useRef(false);
  const onDialCodeRef = useRef(onDialCode);
  onDialCodeRef.current = onDialCode;

  useEffect(() => {
    if (!enabled || userPickedRef.current || appliedRef.current) return;

    let cancelled = false;
    void apiService.getVisitorCountryDialCode().then((data) => {
      if (cancelled || userPickedRef.current || appliedRef.current) return;
      if (data.dialCode) {
        appliedRef.current = true;
        onDialCodeRef.current(data.dialCode);
      }
    }).catch(() => {
      /* keep default */
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const markUserPicked = () => {
    userPickedRef.current = true;
  };

  return { markUserPicked };
}
