import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export function useAppForeground(onForeground) {
  const callbackRef = useRef(onForeground);
  callbackRef.current = onForeground;

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      const resumed = (previousState === 'background' || previousState === 'inactive') && nextState === 'active';
      previousState = nextState;
      if (resumed) callbackRef.current?.();
    });

    return () => subscription.remove();
  }, []);
}
