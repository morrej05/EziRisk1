import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const MINUTE_MS = 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;
const TIMER_TICK_MS = 1000;

const readDurationFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const INACTIVITY_WARNING_AFTER_MS = readDurationFromEnv(
  import.meta.env.VITE_INACTIVITY_WARNING_AFTER_MS,
  25 * MINUTE_MS
);
export const INACTIVITY_IDLE_TIMEOUT_MS = readDurationFromEnv(
  import.meta.env.VITE_INACTIVITY_IDLE_TIMEOUT_MS,
  30 * MINUTE_MS
);
export const INACTIVITY_COUNTDOWN_MS = Math.max(
  INACTIVITY_IDLE_TIMEOUT_MS - INACTIVITY_WARNING_AFTER_MS,
  TIMER_TICK_MS
);

const LAST_ACTIVITY_STORAGE_KEY = 'ezirisk:last-activity-at';
const INACTIVITY_LOGOUT_STORAGE_KEY = 'ezirisk:inactivity-logout';
const INACTIVITY_MESSAGE = 'You were signed out due to inactivity.';
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

const getStoredLastActivity = () => {
  const storedValue = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
  const storedTimestamp = storedValue ? Number(storedValue) : Number.NaN;
  return Number.isFinite(storedTimestamp) && storedTimestamp > 0 ? storedTimestamp : Date.now();
};

type PerformLogoutOptions = {
  broadcast?: boolean;
};

export function useInactivityLogout(enabled = true) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const logoutInProgressRef = useRef(false);
  const lastActivityWriteRef = useRef(0);
  const warningVisibleRef = useRef(false);
  const [isWarningVisible, setIsWarningVisible] = useState(false);
  const [remainingMs, setRemainingMs] = useState(INACTIVITY_COUNTDOWN_MS);

  const setWarningVisible = useCallback((visible: boolean) => {
    warningVisibleRef.current = visible;
    setIsWarningVisible(visible);
  }, []);

  const markActivity = useCallback((options: { force?: boolean } = {}) => {
    if (!enabled || logoutInProgressRef.current) {
      return;
    }

    // Once the warning is visible, require an explicit "Stay signed in" action
    // rather than silently extending the session on incidental mouse/scroll events.
    if (warningVisibleRef.current && !options.force) {
      return;
    }

    const now = Date.now();
    if (!options.force && now - lastActivityWriteRef.current < ACTIVITY_THROTTLE_MS) {
      return;
    }

    lastActivityWriteRef.current = now;
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
    setWarningVisible(false);
    setRemainingMs(INACTIVITY_COUNTDOWN_MS);
  }, [enabled, setWarningVisible]);

  const handleActivityEvent = useCallback(() => {
    markActivity();
  }, [markActivity]);

  const performLogout = useCallback(
    async ({ broadcast = true }: PerformLogoutOptions = {}) => {
      if (logoutInProgressRef.current) {
        return;
      }

      logoutInProgressRef.current = true;
      setWarningVisible(false);

      if (broadcast) {
        window.localStorage.setItem(
          INACTIVITY_LOGOUT_STORAGE_KEY,
          JSON.stringify({ at: Date.now(), reason: 'inactivity' })
        );
      }

      await signOut();
      navigate('/signin', {
        replace: true,
        state: { inactivityMessage: INACTIVITY_MESSAGE },
      });
    },
    [navigate, setWarningVisible, signOut]
  );

  const staySignedIn = useCallback(() => {
    markActivity({ force: true });
  }, [markActivity]);

  const logOutNow = useCallback(() => {
    void performLogout();
  }, [performLogout]);

  useEffect(() => {
    if (!enabled) {
      setWarningVisible(false);
      return;
    }

    markActivity();

    const checkInactivity = () => {
      const inactiveMs = Date.now() - getStoredLastActivity();
      const nextRemainingMs = Math.max(INACTIVITY_IDLE_TIMEOUT_MS - inactiveMs, 0);

      if (inactiveMs >= INACTIVITY_IDLE_TIMEOUT_MS) {
        void performLogout();
        return;
      }

      if (inactiveMs >= INACTIVITY_WARNING_AFTER_MS) {
        setWarningVisible(true);
        setRemainingMs(nextRemainingMs);
        return;
      }

      setWarningVisible(false);
      setRemainingMs(INACTIVITY_COUNTDOWN_MS);
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivityEvent, { passive: true });
    });

    const intervalId = window.setInterval(checkInactivity, TIMER_TICK_MS);
    checkInactivity();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_STORAGE_KEY) {
        checkInactivity();
        return;
      }

      if (event.key === INACTIVITY_LOGOUT_STORAGE_KEY && event.newValue) {
        void performLogout({ broadcast: false });
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivityEvent);
      });
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(intervalId);
    };
  }, [enabled, handleActivityEvent, markActivity, performLogout, setWarningVisible]);

  return {
    isWarningVisible,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    staySignedIn,
    logOutNow,
    timeoutValues: {
      warningAfterMs: INACTIVITY_WARNING_AFTER_MS,
      idleTimeoutMs: INACTIVITY_IDLE_TIMEOUT_MS,
      countdownMs: INACTIVITY_COUNTDOWN_MS,
    },
  };
}
