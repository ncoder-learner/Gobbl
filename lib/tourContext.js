import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { TOUR_STEPS } from './tourSteps';
import { navigationRef } from './navigationRef';

const TourContext = createContext(null);

// Drives the interactive, cross-screen guided tour (TourOverlay.jsx renders
// it). Targets register themselves via <TourTarget> wherever the real UI for
// a step lives — real elements, real onPress handlers, no synthetic demo
// data — so the tour is always showing the actual app, not a mockup of it.
export function TourProvider({ children }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const targets = useRef({}); // id -> { rect, action }
  const navigatedToSlotViewer = useRef(false);

  const registerTarget = useCallback((id, data) => {
    targets.current[id] = data;
  }, []);
  const unregisterTarget = useCallback((id) => {
    delete targets.current[id];
  }, []);

  function goToStep(idx) {
    if (idx >= TOUR_STEPS.length) { setActive(false); return; }
    const step = TOUR_STEPS[idx];
    if (step.requiresPriorNav && !navigatedToSlotViewer.current) {
      goToStep(idx + 1);
      return;
    }
    setStepIndex(idx);
    if (step.navigateTo && navigationRef.isReady()) {
      navigationRef.navigate('Tabs', { screen: step.navigateTo });
    }
    if (step.mode === 'auto-action') {
      if (step.action === 'back' && navigationRef.isReady() && navigationRef.canGoBack()) {
        navigationRef.goBack();
      }
      setTimeout(() => goToStep(idx + 1), 260);
    }
  }

  function startTour() {
    targets.current = {};
    navigatedToSlotViewer.current = false;
    setActive(true);
    setStepIndex(0);
    if (navigationRef.isReady()) {
      navigationRef.navigate('Tabs', { screen: 'Feed' });
    }
  }

  function stopTour() {
    setActive(false);
  }

  function advance(step) {
    if (step.advance === 'action') {
      const t = targets.current[step.targetId];
      if (t?.action) {
        t.action();
        navigatedToSlotViewer.current = true;
      }
    }
    if (step.isFinal) { setActive(false); return; }
    goToStep(stepIndex + 1);
  }

  return (
    <TourContext.Provider
      value={{
        active, stepIndex, targets,
        startTour, stopTour, advance, skipTour: stopTour,
        registerTarget, unregisterTarget,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within a TourProvider');
  return ctx;
}

// Wraps whatever real element a tour step should spotlight. Measures itself
// in window coordinates (not just local layout) since the overlay that
// reads this is a sibling of the whole navigator, not a child of this
// screen. `action` is the element's real onPress — the tour calls it
// directly for steps that actually open something, instead of scripting a
// parallel navigation with fabricated params.
export function TourTarget({ id, action, children, style }) {
  const { registerTarget, unregisterTarget } = useTour();
  const ref = useRef(null);

  useEffect(() => () => unregisterTarget(id), [id]);

  function measure() {
    if (!ref.current) return;
    ref.current.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return;
      registerTarget(id, { rect: { x, y, width, height }, action });
    });
  }

  return (
    <View ref={ref} style={style} onLayout={measure} collapsable={false}>
      {children}
    </View>
  );
}
