import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Returns [visible, dismiss]. Reads AsyncStorage on mount; auto-dismisses after
// `autoDismissMs` (default 5 s). Sets the key so it never shows again.
export function useFirstVisit(key, autoDismissMs = 5000) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem(key).then((val) => {
      if (val === null) setVisible(true);
    });
  }, [key]);

  useEffect(() => {
    if (!visible) return;
    timerRef.current = setTimeout(() => dismiss(), autoDismissMs);
    return () => clearTimeout(timerRef.current);
  }, [visible]);

  function dismiss() {
    clearTimeout(timerRef.current);
    AsyncStorage.setItem(key, '1');
    setVisible(false);
  }

  return [visible, dismiss];
}

// A floating tooltip bubble. Place it absolutely inside a SafeAreaView.
// `style` controls positioning (e.g. { bottom: 100, alignSelf: 'center' }).
export function FirstVisitTooltip({ message, onDismiss, style }) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 340,
      useNativeDriver: true,
    }).start();
  }, []);

  function handleDismiss() {
    Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDismiss);
  }

  return (
    <Animated.View style={[tt.wrap, style, { opacity: fade }]} pointerEvents="box-none">
      <View style={tt.bubble}>
        <Text style={tt.msg}>{message}</Text>
        <Pressable onPress={handleDismiss} style={tt.close} hitSlop={12}>
          <Text style={tt.closeText}>✕</Text>
        </Pressable>
      </View>
      <View style={tt.arrow} />
    </Animated.View>
  );
}

const tt = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 999,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a1040',
    borderWidth: 1,
    borderColor: '#5a2a8a',
    borderRadius: 14,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 8,
    gap: 8,
    maxWidth: 260,
    shadowColor: '#8855cc',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  msg: { flex: 1, fontSize: 13, color: '#e8d0ff', lineHeight: 18, fontWeight: '500' },
  close: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 11, color: '#9966cc' },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#5a2a8a',
    marginTop: -1,
  },
});
