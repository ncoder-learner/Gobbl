import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Image,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  Easing,
  PanResponder,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { decode } from 'base64-arraybuffer';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';
import ShareBottomSheet from '../components/ShareBottomSheet';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { isHomeMeal } from '../lib/homePrivacy';

// ─── Theme (matches HomeScreen) ───────────────────────────────────────────────
const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  green: '#00c896',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray3: '#555555',
  gray4: '#444444',
  gray5: '#333333',
  inputBg: '#161616',
};

// ─── Stages ───────────────────────────────────────────────────────────────────
// 'camera' → 'preview' → 'identifying' → 'confirm' → 'saving' → 'done'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function identifyFoodWithClaude(base64Image, mediaType = 'image/jpeg') {
  const { data, error } = await supabase.functions.invoke('identify-food', {
    body: { base64Image, mediaType },
  });

  if (error) throw error;
  return data;
}

const MAX_PHOTO_WIDTH = 1280;

async function compressImage(uri) {
  return manipulateAsync(
    uri,
    [{ resize: { width: MAX_PHOTO_WIDTH } }],
    { compress: 0.82, format: SaveFormat.JPEG, base64: true },
  );
}

// ─── Meal tag (breakfast / lunch / dinner) ─────────────────────────────────────
// Auto-guessed from time of day at log time; user can override before saving.
// Boundaries: before 11am = breakfast, 11am–4pm = lunch, after 4pm = dinner.
function guessMealTag(date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}

const TAG_OPTIONS = [
  ['breakfast', '🌅', 'Breakfast'],
  ['lunch', '☀️', 'Lunch'],
  ['dinner', '🌙', 'Dinner'],
];

function MealTagPicker({ value, onChange }) {
  return (
    <View style={styles.tagPickerWrap}>
      {TAG_OPTIONS.map(([key, emoji, label]) => (
        <TouchableOpacity
          key={key}
          style={[styles.tagPickerBtn, value === key && styles.tagPickerBtnActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
        >
          <Text style={styles.tagPickerEmoji}>{emoji}</Text>
          <Text style={[styles.tagPickerText, value === key && styles.tagPickerTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Score Slider Input — drag to rate 1.0–10.0 with decimals ─────────────────

const SCORE_MIN = 1;
const SCORE_MAX = 10;
const THUMB_SIZE = 26;

// Color + mood shift as the score climbs — instant feedback on how a rating "feels"
function scoreTone(score) {
  if (score < 3) return { label: 'Rough', color: '#e5484d' };
  if (score < 5) return { label: 'Meh', color: '#f5a524' };
  if (score < 7) return { label: 'Good', color: C.orange };
  if (score < 9) return { label: 'Great', color: C.green };
  return { label: 'Amazing', color: '#ffd166' };
}

function ScoreSlider({ value, onChange }) {
  const trackWidthRef = useRef(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  // Keep onChange in a ref so the PanResponder (created once) always calls the latest version
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  function valueToX(v, width) {
    const usable = width - THUMB_SIZE;
    return ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * usable;
  }

  // Stored in a ref so the PanResponder closure never goes stale
  const reportRef = useRef((locationX) => {
    const width = trackWidthRef.current;
    if (!width) return;
    const usable = width - THUMB_SIZE;
    const x = Math.max(0, Math.min(usable, locationX - THUMB_SIZE / 2));
    const raw = SCORE_MIN + (x / usable) * (SCORE_MAX - SCORE_MIN);
    onChangeRef.current(Math.round(raw * 2) / 2); // snap to nearest 0.5
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => reportRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => reportRef.current(e.nativeEvent.locationX),
    })
  ).current;

  useEffect(() => {
    const width = trackWidthRef.current;
    if (!width) return;
    Animated.spring(thumbX, {
      toValue: valueToX(value, width),
      useNativeDriver: false,
      speed: 22,
      bounciness: 5,
    }).start();
  }, [value]);

  const tone = scoreTone(value);

  return (
    <View>
      <View style={styles.scoreReadout}>
        <Text style={[styles.scoreReadoutNum, { color: tone.color }]}>{value.toFixed(1)}</Text>
        <Text style={[styles.scoreReadoutLabel, { color: tone.color }]}>{tone.label}</Text>
      </View>

      <View
        style={styles.sliderTrack}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          trackWidthRef.current = w;
          thumbX.setValue(valueToX(value, w));
        }}
        {...pan.panHandlers}
      >
        <Animated.View style={[styles.sliderFill, { width: thumbX, backgroundColor: tone.color }]} />
        <Animated.View
          style={[
            styles.sliderThumb,
            { backgroundColor: tone.color, transform: [{ translateX: Animated.subtract(thumbX, THUMB_SIZE / 2) }] },
          ]}
        />
      </View>

      <View style={styles.sliderScaleRow}>
        <Text style={styles.sliderScaleText}>1</Text>
        <Text style={styles.sliderScaleText}>10</Text>
      </View>
    </View>
  );
}

// ─── Business Tag (passed via route params from sponsored ad) ─────────────────

function BusinessTag({ business }) {
  if (!business) return null;
  return (
    <View style={styles.bizTag}>
      <Text style={styles.bizTagEmoji}>{business.emoji || '📍'}</Text>
      <Text style={styles.bizTagName}>{business.businessName}</Text>
      <Text style={styles.bizTagLabel}>Logging for this restaurant</Text>
    </View>
  );
}

// ─── Done celebration — emoji pop, score reveal, then hand off to the tier list ─

function DoneCelebration({ emoji, mealName, score, onFinished }) {
  const emojiScale = useRef(new Animated.Value(0)).current;
  const textIn = useRef(new Animated.Value(0)).current;
  const scoreScale = useRef(new Animated.Value(0)).current;
  const hintFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const seq = Animated.sequence([
      Animated.spring(emojiScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }),
      Animated.parallel([
        Animated.timing(textIn, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(scoreScale, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
      ]),
      Animated.timing(hintFade, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]);

    seq.start();
    const timer = setTimeout(onFinished, 1500);
    return () => {
      seq.stop();
      clearTimeout(timer);
    };
  }, []);

  const tone = scoreTone(score);

  return (
    <View style={styles.doneBox}>
      <Animated.Text style={[styles.doneEmoji, { transform: [{ scale: emojiScale }] }]}>{emoji}</Animated.Text>

      <Animated.View
        style={{
          opacity: textIn,
          transform: [{ translateY: textIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      >
        <Text style={styles.doneTitle}>Logged!</Text>
        <Text style={styles.doneSub} numberOfLines={1}>{mealName}</Text>
      </Animated.View>

      <Animated.View style={[styles.doneScoreWrap, { transform: [{ scale: scoreScale }] }]}>
        <Text style={[styles.doneScoreNum, { color: tone.color }]}>{score.toFixed(1)}</Text>
        <Text style={[styles.doneScoreLabel, { color: tone.color }]}>{tone.label}</Text>
      </Animated.View>

      <Animated.Text style={[styles.doneHint, { opacity: hintFade }]}>
        Finding its spot in your tier list…
      </Animated.Text>
    </View>
  );
}

// ─── Share prompt — a light, dismissible "Post this?" suggestion, not a
// blocking choice. Slides in a beat after the celebration settles so it reads
// as a follow-up nudge rather than a form the user must resolve. ─────────────

function SharePromptCard({ meal, posted, onShare }) {
  const [dismissed, setDismissed] = useState(false);
  const cardIn = useRef(new Animated.Value(0)).current;
  const confirmPop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.spring(cardIn, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    }, 220);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!posted) return;
    confirmPop.setValue(0.7);
    Animated.spring(confirmPop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }).start();
  }, [posted]);

  function dismiss() {
    Animated.timing(cardIn, {
      toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(() => setDismissed(true));
  }

  if (dismissed) return null;

  const translateY = cardIn.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={[styles.sharePromptCard, { opacity: cardIn, transform: [{ translateY }] }]}>
      {posted ? (
        <Animated.View style={[styles.sharePromptRow, styles.sharePromptRowCenter, { transform: [{ scale: confirmPop }] }]}>
          <Text style={styles.sharePromptCheckEmoji}>✓</Text>
          <Text style={styles.sharePromptPostedText}>Shared to your feed</Text>
        </Animated.View>
      ) : (
        <View style={styles.sharePromptRow}>
          <View style={styles.sharePromptThumb}>
            {meal.photo_url ? (
              <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Text style={styles.sharePromptThumbEmoji}>{meal.emoji}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sharePromptTitle}>Post this?</Text>
            <Text style={styles.sharePromptSub}>Share it to your friends' feed</Text>
          </View>
          <TouchableOpacity style={styles.sharePromptBtn} onPress={onShare} activeOpacity={0.85} hitSlop={6}>
            <Text style={styles.sharePromptBtnText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sharePromptDismiss} onPress={dismiss} hitSlop={10}>
            <Text style={styles.sharePromptDismissText}>×</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LogMealScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const sponsored = route.params?.sponsored ?? null; // passed from HomeScreen sponsored ad
  const forceTag = route.params?.forceTag ?? null; // passed from DayBoardScreen's empty "you" tile

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [camTooltipVisible, dismissCamTooltip] = useFirstVisit('@fw_tt_logmeal');

  const [stage, setStage] = useState('camera'); // camera | preview | identifying | confirm | saving | done
  const [imageUri, setImageUri] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMediaType, setImageMediaType] = useState('image/jpeg');
  const [identified, setIdentified] = useState(null); // Claude's response
  const [mealName, setMealName] = useState('');
  // Claude's identification is a starting point, not the final word — a
  // wrong guess on any of these three needs a correction path, so each gets
  // its own editable field (mealName already worked this way; emoji/cuisine
  // now match it) rather than saving identified.* directly.
  const [mealEmoji, setMealEmoji] = useState('');
  const [mealCuisine, setMealCuisine] = useState('');
  // Extra photos beyond the primary shot — held locally (no meal id exists
  // yet to attach meal_photos rows to) and uploaded right after the meal
  // insert succeeds in saveMeal(). Same storage bucket + meal_photos table
  // MealDetailScreen's post-hoc "add photo" already uses.
  const [extraPhotos, setExtraPhotos] = useState([]); // [{ uri, base64 }]
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [score, setScore] = useState(5.5);
  const [mealTag, setMealTag] = useState(() => forceTag || guessMealTag());

  // Consume forceTag once — otherwise it'd linger in this route's params
  // (React Navigation keeps params until overwritten) and silently force
  // the same tag on a later, unrelated visit via the bottom tab icon.
  useEffect(() => {
    if (forceTag) navigation.setParams({ forceTag: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [savedMealId, setSavedMealId] = useState(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePosted, setSharePosted] = useState(false);
  const [notes, setNotes] = useState('');
  const [facing, setFacing] = useState('back');
  const [processing, setProcessing] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'uploading' | 'inserting' | 'photos'
  const [identifyError, setIdentifyError] = useState(null); // null | 'timeout' | 'error'

  // ── Place / location state ──────────────────────────────────────────────────
  const [placeQuery, setPlaceQuery]       = useState('');
  const [suggestions, setSuggestions]     = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null); // {place_id, name, address, lat, lng}
  const [placeSearching, setPlaceSearching] = useState(false);
  const [userCoords, setUserCoords]       = useState(null); // {lat, lng} — null if permission denied
  const [homeLocation, setHomeLocation]   = useState(null); // {lat, lng, name} from profiles, or null
  const currentUserIdRef = useRef(null);
  const placeSessionRef  = useRef(null); // UUID reused across AC keystrokes + final details call
  const placeDebounceRef = useRef(null);

  // Load the user's saved home location (if any) so "This was at home" can
  // be offered as a one-tap alternative to searching.
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        currentUserIdRef.current = user.id;
        const { data, error: homeErr } = await supabase
          .from('profiles')
          .select('home_lat, home_lng, home_place_name')
          .eq('id', user.id)
          .single();
        if (homeErr) throw homeErr;
        if (data?.home_lat != null && data?.home_lng != null) {
          setHomeLocation({ lat: data.home_lat, lng: data.home_lng, name: data.home_place_name || 'Home' });
        }
      } catch (err) {
        // non-fatal — quick option just won't be offered, but log so a
        // schema-cache miss (PostgREST hasn't picked up a new column yet —
        // see migration 012's note) or RLS denial is visible instead of
        // silently leaving the chip missing with no trace.
        console.warn('[LogMeal] failed to load home location:', err?.message ?? err);
      }
    })();
  }, []);

  // "This was at home" — synthesizes a place_id from the user + coordinates
  // (not just the user) since the `places` table is an immutable INSERT-only
  // cache (no UPDATE policy — see migration 004). Keying off coordinates
  // means repeated home-tagged meals share one row while a changed home
  // address in AccountScreen naturally lands on a fresh row instead of
  // silently failing to update a stale one.
  function selectHome() {
    if (!homeLocation || !currentUserIdRef.current) return;
    const latKey = homeLocation.lat.toFixed(5);
    const lngKey = homeLocation.lng.toFixed(5);
    setSelectedPlace({
      place_id: `home:${currentUserIdRef.current}:${latKey}:${lngKey}`,
      name: homeLocation.name,
      address: null,
      lat: homeLocation.lat,
      lng: homeLocation.lng,
    });
  }

  // Request foreground location as soon as the log flow starts (mount), so coords
  // are usually ready well before the user reaches place search at the confirm stage.
  // Non-blocking: if denied or slow, autocomplete still works without distance biasing.
  useEffect(() => {
    if (userCoords) return;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // ── Camera actions ──────────────────────────────────────────────────────────

  async function takePhoto() {
    if (!cameraRef.current || processing) return;
    setProcessing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      const compressed = await compressImage(photo.uri);
      setImageUri(compressed.uri);
      setImageBase64(compressed.base64);
      setImageMediaType('image/jpeg');
      setIdentifyError(null);
      setStage('preview');
    } catch (err) {
      Alert.alert('Capture failed', 'Could not capture photo. Try again.');
    } finally {
      setProcessing(false);
    }
  }

  async function pickFromLibrary() {
    if (Platform.OS === 'android') {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain) {
          Alert.alert(
            'Permission required',
            'Open your device settings to allow FoodWrapped to access your photos.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!result.canceled) {
      setProcessing(true);
      try {
        const compressed = await compressImage(result.assets[0].uri);
        setImageUri(compressed.uri);
        setImageBase64(compressed.base64);
        setImageMediaType('image/jpeg');
        setIdentifyError(null);
        setStage('preview');
      } catch (err) {
        Alert.alert('Processing failed', 'Could not process the selected photo. Try again.');
      } finally {
        setProcessing(false);
      }
    }
  }

  // ── Extra photos (confirm stage) — camera and library both available for
  // every additional shot, same as the primary photo. ────────────────────────

  async function addExtraPhotoFromCamera() {
    if (addingPhoto) return;
    const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      if (!canAskAgain) {
        Alert.alert(
          'Permission required',
          'Open your device settings to allow FoodWrapped to access your camera.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (result.canceled) return;
    setAddingPhoto(true);
    try {
      const compressed = await compressImage(result.assets[0].uri);
      setExtraPhotos(prev => [...prev, { uri: compressed.uri, base64: compressed.base64 }]);
    } catch (err) {
      Alert.alert('Processing failed', 'Could not process the photo. Try again.');
    } finally {
      setAddingPhoto(false);
    }
  }

  async function addExtraPhotosFromLibrary() {
    if (addingPhoto) return;
    if (Platform.OS === 'android') {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain) {
          Alert.alert(
            'Permission required',
            'Open your device settings to allow FoodWrapped to access your photos.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;
    setAddingPhoto(true);
    try {
      const compressed = await Promise.all(result.assets.map(a => compressImage(a.uri)));
      setExtraPhotos(prev => [...prev, ...compressed.map(c => ({ uri: c.uri, base64: c.base64 }))]);
    } catch (err) {
      Alert.alert('Processing failed', 'Could not process the selected photo(s). Try again.');
    } finally {
      setAddingPhoto(false);
    }
  }

  function promptAddExtraPhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: addExtraPhotoFromCamera },
      { text: 'Choose from Library', onPress: addExtraPhotosFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function removeExtraPhoto(index) {
    setExtraPhotos(prev => prev.filter((_, i) => i !== index));
  }

  // ── Identify with Claude ────────────────────────────────────────────────────

  async function identify() {
    setStage('identifying');
    setIdentifyError(null);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error('timeout');
        err.isTimeout = true;
        reject(err);
      }, 12000)
    );
    try {
      const result = await Promise.race([
        identifyFoodWithClaude(imageBase64, imageMediaType),
        timeoutPromise,
      ]);

      // TEMP DIAGNOSTIC LOG — remove after confirming pizza works
      console.log('[identify-food] raw result:', JSON.stringify(result));
      console.log('[identify-food] name:', result?.name, '| is_food:', result?.is_food, '| is_appropriate:', result?.is_appropriate);

      // ── Safety gate ────────────────────────────────────────────────────────
      // Strict: reject immediately if content is inappropriate.
      if (result.is_appropriate === false) {
        Alert.alert(
          'Photo not accepted',
          "This image can't be used. Please choose a photo of your food.",
          [{ text: 'OK' }],
        );
        setStage('camera');
        return;
      }

      // Fail safe: if safety flags are missing or not proper booleans, the
      // response is unverified — don't allow saving and ask the user to retry.
      if (typeof result.is_food !== 'boolean' || typeof result.is_appropriate !== 'boolean') {
        setIdentifyError('error');
        setStage('preview');
        return;
      }

      // Lenient: only block if the model is confident there is no food at all.
      if (!result.is_food) {
        setIdentifyError('no_food');
        setStage('preview');
        return;
      }

      // Both checks passed — proceed to confirm.
      setIdentified(result);
      setMealName(result.name);
      setMealEmoji(result.emoji || '🍽️');
      setMealCuisine(result.cuisine || '');
      setStage('confirm');
    } catch (err) {
      // Network error, timeout, or unexpected failure — fail safe: stay on
      // preview so the user can retry without an unverified image being saved.
      // TEMP DIAGNOSTIC LOG — remove after confirming pizza works
      console.log('[identify-food] CATCH:', err?.isTimeout ? 'TIMEOUT' : 'ERROR', err?.message);
      setIdentifyError(err.isTimeout ? 'timeout' : 'error');
      setStage('preview');
    }
  }

  // ── Place search ───────────────────────────────────────────────────────────

  function handlePlaceQueryChange(text) {
    setPlaceQuery(text);
    setSuggestions([]);
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    if (!text.trim() || text.trim().length < 2) {
      setPlaceSearching(false);
      return;
    }
    setPlaceSearching(true);
    placeDebounceRef.current = setTimeout(() => runAutocomplete(text.trim()), 300);
  }

  async function runAutocomplete(query) {
    // Generate a session token once per search session; reuse it for every keystroke.
    if (!placeSessionRef.current) {
      placeSessionRef.current = Crypto.randomUUID();
    }
    try {
      const body = { query, sessionToken: placeSessionRef.current };
      if (userCoords) { body.lat = userCoords.lat; body.lng = userCoords.lng; }
      const { data, error } = await supabase.functions.invoke('places-search', { body });
      if (error) throw error;
      setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setPlaceSearching(false);
    }
  }

  async function handleSelectPlace(suggestion) {
    setSuggestions([]);
    setPlaceQuery(suggestion.main_text);
    setPlaceSearching(true);
    try {
      // Fetch full details with the same session token — this closes the billing session.
      const { data, error } = await supabase.functions.invoke('places-search', {
        body: { placeId: suggestion.place_id, sessionToken: placeSessionRef.current },
      });
      if (error) throw error;
      setSelectedPlace(data);
    } catch {
      // Fallback: use autocomplete data without coords
      setSelectedPlace({
        place_id: suggestion.place_id,
        name: suggestion.main_text,
        address: suggestion.secondary_text,
        lat: null,
        lng: null,
      });
    } finally {
      placeSessionRef.current = null; // session consumed; next search gets a fresh UUID
      setPlaceSearching(false);
    }
  }

  function clearPlace() {
    setSelectedPlace(null);
    setPlaceQuery('');
    setSuggestions([]);
    placeSessionRef.current = null;
  }

  // ── Save to Supabase ────────────────────────────────────────────────────────

  async function saveMeal() {
    if (!mealName.trim()) {
      Alert.alert('Name required', 'Please enter a meal name.');
      return;
    }
    setStage('saving');
    setSaveStatus('uploading');

    let uploadedFileName = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Upload image to Supabase Storage
      const fileName = `${user.id}/${Date.now()}.jpg`;
      uploadedFileName = fileName;
      const { error: uploadError } = await supabase.storage
        .from('meal-photos')
        .upload(fileName, decode(imageBase64), { contentType: imageMediaType });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('meal-photos')
        .getPublicUrl(fileName);

      // 2. Upsert place (if selected) before inserting the meal that FK-references it.
      //    ignoreDuplicates: true → ON CONFLICT DO NOTHING (no UPDATE attempted, matching RLS).
      let resolvedPlaceId = null;
      if (selectedPlace?.place_id) {
        await supabase.from('places').upsert(
          {
            place_id: selectedPlace.place_id,
            name:     selectedPlace.name,
            address:  selectedPlace.address ?? null,
            lat:      selectedPlace.lat     ?? null,
            lng:      selectedPlace.lng     ?? null,
          },
          { onConflict: 'place_id', ignoreDuplicates: true },
        );
        resolvedPlaceId = selectedPlace.place_id;
      }

      // 3. Insert meal row; if this fails, remove the orphaned photo
      setSaveStatus('inserting');
      const derivedRating = Math.max(1, Math.min(5, Math.round(score / 2)));

      const { data: inserted, error: insertError } = await supabase
        .from('meals')
        .insert({
          user_id: user.id,
          name: mealName.trim(),
          emoji: mealEmoji.trim() || '🍽️',
          description: identified?.description || '',
          cuisine: mealCuisine.trim(),
          rating: derivedRating,
          score,
          notes: notes.trim() || null,
          photo_url: publicUrl,
          business_id: sponsored?.id || null,
          ai_confidence: identified?.confidence || null,
          place_id: resolvedPlaceId,
          tag: mealTag,
        })
        .select('id')
        .single();

      if (insertError) {
        await supabase.storage.from('meal-photos').remove([uploadedFileName]);
        throw insertError;
      }

      // 4. Extra photos — non-fatal if one fails; the meal itself is already
      // saved, and the same meal_photos table is editable later from
      // MealDetailScreen, so a partial failure here isn't a lost cause.
      if (extraPhotos.length > 0) {
        setSaveStatus('photos');
        for (let i = 0; i < extraPhotos.length; i++) {
          try {
            const photo = extraPhotos[i];
            const extraFileName = `${user.id}/${Date.now()}-${i}.jpg`;
            const { error: extraUploadErr } = await supabase.storage
              .from('meal-photos')
              .upload(extraFileName, decode(photo.base64), { contentType: 'image/jpeg' });
            if (extraUploadErr) throw extraUploadErr;
            const { data: { publicUrl: extraUrl } } = supabase.storage
              .from('meal-photos')
              .getPublicUrl(extraFileName);
            await supabase.from('meal_photos').insert({ meal_id: inserted.id, photo_url: extraUrl, position: i });
          } catch (err) {
            console.warn('[LogMeal] extra photo failed, continuing:', err?.message ?? err);
          }
        }
      }

      setSavedMealId(inserted?.id ?? null);
      setSavedPhotoUrl(publicUrl);
      setSharePosted(false);
      setStage('done');
    } catch (err) {
      console.error(err);
      Alert.alert('Save failed', err.message || 'Something went wrong. Try again.');
      setStage('confirm');
      setSaveStatus('');
    }
  }

  // ── Permission guard ────────────────────────────────────────────────────────

  if (!permission) return <View style={styles.safe} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionEmoji}>📸</Text>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionSub}>FoodWrapped needs your camera to log meals.</Text>
          {permission.canAskAgain ? (
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Allow camera</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.permissionBtn} onPress={() => Linking.openSettings()}>
              <Text style={styles.permissionBtnText}>Open Settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.permissionAlt} onPress={pickFromLibrary} disabled={processing}>
            <Text style={styles.permissionAltText}>Choose from library instead</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Done screen — celebrate, then offer share or continue ──────────────────

  function handleFinish() {
    const mealId = savedMealId;
    setStage('camera');
    setImageUri(null);
    setImageBase64(null);
    setIdentified(null);
    setMealName('');
    setMealEmoji('');
    setMealCuisine('');
    setExtraPhotos([]);
    setScore(5.5);
    setNotes('');
    setSavedMealId(null);
    setSavedPhotoUrl(null);
    setShareOpen(false);
    setSharePosted(false);
    setPlaceQuery('');
    setSuggestions([]);
    setSelectedPlace(null);
    placeSessionRef.current = null;
    navigation.navigate('TierList', { newMealId: mealId });
  }

  if (stage === 'done') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <DoneCelebration
          emoji={mealEmoji || '🍽️'}
          mealName={mealName}
          score={score}
          onFinished={() => setStage('done-options')}
        />
      </SafeAreaView>
    );
  }

  if (stage === 'done-options') {
    const shareMeal = {
      id: savedMealId,
      name: mealName,
      emoji: mealEmoji || '🍽️',
      score,
      photo_url: savedPhotoUrl,
      tag: mealTag,
      created_at: new Date().toISOString(),
    };
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.doneBox}>
          <Text style={styles.doneEmoji}>{mealEmoji || '🍽️'}</Text>
          <Text style={styles.doneTitle}>Logged!</Text>
          <Text style={styles.doneSub} numberOfLines={1}>{mealName}</Text>

          <SharePromptCard
            meal={shareMeal}
            posted={sharePosted}
            onShare={() => setShareOpen(true)}
          />

          <TouchableOpacity
            style={styles.doneContinueBtn}
            onPress={handleFinish}
            activeOpacity={0.85}
          >
            <Text style={styles.doneContinueBtnText}>Continue →</Text>
          </TouchableOpacity>
        </View>

        <ShareBottomSheet
          visible={shareOpen}
          meal={shareMeal}
          onDismiss={() => setShareOpen(false)}
          onPosted={() => setSharePosted(true)}
        />
      </SafeAreaView>
    );
  }

  // ── Camera stage ────────────────────────────────────────────────────────────

  if (stage === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar barStyle="light-content" />
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing}>
          {/* Top bar */}
          <SafeAreaView edges={['top']}>
            <View style={styles.camTopBar}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.camBackBtn}>
                <Text style={styles.camBackText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.camTitle}>Log a meal</Text>
              <TouchableOpacity onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.camFlipBtn}>
                <Text style={styles.camFlipText}>⟳</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Viewfinder hint */}
          <View style={styles.camFrame}>
            <View style={styles.camCornerTL} />
            <View style={styles.camCornerTR} />
            <View style={styles.camCornerBL} />
            <View style={styles.camCornerBR} />
          </View>

          {/* Sponsored context */}
          {sponsored && (
            <View style={styles.camSponsoredBadge}>
              <Text style={styles.camSponsoredText}>📍 Logging for {sponsored.businessName}</Text>
            </View>
          )}

          {/* Bottom controls */}
          <View style={styles.camControls}>
            <TouchableOpacity style={styles.camLibBtn} onPress={pickFromLibrary} disabled={processing}>
              <Ionicons name="images-outline" size={28} color="rgba(255,255,255,0.9)" />
              <Text style={styles.camLibLabel}>Library</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.camShutter} onPress={takePhoto} disabled={processing}>
              {processing ? (
                <ActivityIndicator color={C.white} size="small" />
              ) : (
                <View style={styles.camShutterInner} />
              )}
            </TouchableOpacity>
            <View style={{ width: 64 }} />
          </View>

          {camTooltipVisible && (
            <FirstVisitTooltip
              message="Tap the shutter to snap your meal"
              onDismiss={dismissCamTooltip}
              style={{ bottom: 140, alignSelf: 'center' }}
            />
          )}
        </CameraView>
      </View>
    );
  }

  // ── Preview + Identifying ───────────────────────────────────────────────────

  if (stage === 'preview' || stage === 'identifying') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.previewBox}>
          <Image source={{ uri: imageUri }} style={styles.previewImg} resizeMode="cover" />
          {stage === 'identifying' && (
            <View style={styles.identifyingOverlay}>
              <ActivityIndicator size="large" color={C.orange} />
              <Text style={styles.identifyingText}>Identifying your meal...</Text>
            </View>
          )}
        </View>
        {stage === 'preview' && identifyError && (
          <View style={styles.previewErrBox}>
            <Text style={styles.previewErrText}>
              {identifyError === 'no_food'
                ? "We couldn't find food in this photo — try another shot."
                : identifyError === 'timeout'
                  ? 'Identification timed out. Please try again.'
                  : "Couldn't verify the photo. Please try again."}
            </Text>
          </View>
        )}
        {stage === 'preview' && (
          <View style={styles.previewActions}>
            <TouchableOpacity style={styles.previewRetake} onPress={() => setStage('camera')}>
              <Text style={styles.previewRetakeText}>
                {identifyError === 'no_food' ? 'Try another shot' : 'Retake'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.previewIdentify} onPress={identify}>
              <Text style={styles.previewIdentifyText}>
                {identifyError ? 'Try again →' : 'Identify food →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ── Confirm + Save ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.confirmHeader}>
            <TouchableOpacity
              onPress={() => { setStage('preview'); setIdentifyError(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.confirmTitle}>Log meal</Text>
            <View style={{ width: 32 }} />
          </View>

          {/* Photo — the hero of this screen, not a small side thumbnail */}
          <View style={styles.heroPhotoWrap}>
            <Image source={{ uri: imageUri }} style={styles.heroPhoto} resizeMode="cover" />
            {identified && (
              <>
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.88)']}
                  locations={[0.35, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <View style={styles.heroIdentifiedOverlay}>
                  <Text style={styles.identifiedEmoji}>{identified.emoji}</Text>
                  <View style={styles.identifiedText}>
                    <Text style={styles.identifiedName}>{identified.name}</Text>
                    {identified.cuisine ? (
                      <Text style={styles.identifiedCuisine}>{identified.cuisine}</Text>
                    ) : null}
                    {identified.confidence === 'low' && (
                      <Text style={styles.identifiedLow}>Low confidence — check the name</Text>
                    )}
                  </View>
                </View>
              </>
            )}
          </View>

          {/* More photos — a core feature that was previously only
              reachable after the fact from MealDetailScreen. Kept right
              under the hero photo so it's visible at log time, not buried.
              Both camera and library are offered for every added photo. */}
          <View style={styles.extraPhotosSection}>
            <View style={styles.extraPhotosHeaderRow}>
              <Ionicons name="images" size={16} color={C.orange} />
              <Text style={styles.extraPhotosLabel}>More photos</Text>
              <Text style={styles.optional}>(optional)</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.extraPhotosRow}
            >
              {extraPhotos.map((photo, i) => (
                <View key={i} style={styles.extraPhotoThumbWrap}>
                  <Image source={{ uri: photo.uri }} style={styles.extraPhotoThumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.extraPhotoRemoveBtn}
                    onPress={() => removeExtraPhoto(i)}
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={styles.addExtraPhotoTile}
                onPress={promptAddExtraPhoto}
                activeOpacity={0.75}
                disabled={addingPhoto}
              >
                {addingPhoto ? (
                  <ActivityIndicator color={C.orange} size="small" />
                ) : (
                  <>
                    <Ionicons name="add" size={22} color={C.orange} />
                    <Text style={styles.addExtraPhotoText}>Add</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Identify error — shown when Claude couldn't analyse the photo */}
          {identifyError && (
            <View style={styles.identifyErrBox}>
              <Text style={styles.identifyErrText}>
                {identifyError === 'timeout'
                  ? 'Identification timed out. Enter a name below or try again.'
                  : "Couldn't identify the food. Enter a name below or try again."}
              </Text>
              <TouchableOpacity
                style={styles.identifyRetryBtn}
                onPress={identify}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.identifyRetryText}>Try identifying again</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Business tag */}
          <BusinessTag business={sponsored} />

          {/* Location — a core feature alongside the photo, so it gets its
              own emphasized card right up top rather than living as just
              another buried optional field. */}
          <View style={styles.locationSection}>
            <View style={styles.locationHeaderRow}>
              <Ionicons name="location" size={18} color={C.orange} />
              <Text style={styles.locationSectionLabel}>Location</Text>
              <Text style={styles.optional}>(optional)</Text>
            </View>
            {selectedPlace ? (
              <View style={styles.placeChip}>
                <Ionicons name="location" size={16} color={C.orange} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeChipName} numberOfLines={1}>
                    {isHomeMeal(selectedPlace) ? 'Home' : selectedPlace.name}
                  </Text>
                  {(!isHomeMeal(selectedPlace) && selectedPlace.address) ? (
                    <Text style={styles.placeChipAddr} numberOfLines={1}>{selectedPlace.address}</Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={clearPlace} hitSlop={12}>
                  <Ionicons name="close-circle" size={20} color={C.gray3} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {homeLocation && (
                  <TouchableOpacity style={styles.homeChip} onPress={selectHome} activeOpacity={0.75}>
                    <Ionicons name="home" size={14} color={C.orange} />
                    <Text style={styles.homeChipText}>This was at home</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.placeInputRow}>
                  <Ionicons name="search" size={16} color={C.gray3} style={{ marginLeft: 12 }} />
                  <TextInput
                    style={styles.placeInput}
                    value={placeQuery}
                    onChangeText={handlePlaceQueryChange}
                    placeholder="Search restaurant or spot"
                    placeholderTextColor={C.gray4}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  {placeSearching && (
                    <ActivityIndicator size="small" color={C.gray3} style={{ marginRight: 12 }} />
                  )}
                </View>
                {suggestions.length > 0 && (
                  <View style={styles.suggestionsList}>
                    {suggestions.map((s, i) => (
                      <TouchableOpacity
                        key={s.place_id}
                        style={[styles.suggestionRow, i > 0 && styles.suggestionDivider]}
                        onPress={() => handleSelectPlace(s)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="location-outline" size={14} color={C.gray3} style={{ marginTop: 1 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestionMain} numberOfLines={1}>{s.main_text}</Text>
                          {s.secondary_text ? (
                            <Text style={styles.suggestionSub} numberOfLines={1}>{s.secondary_text}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>

          {/* Name + emoji — Claude's identification is a starting point,
              not the final word, so both are directly editable rather than
              locking in whatever it guessed. */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Meal name</Text>
            <View style={styles.nameRow}>
              <TextInput
                style={styles.emojiInput}
                value={mealEmoji}
                onChangeText={t => setMealEmoji(t.slice(0, 4))}
                placeholder="🍽️"
                placeholderTextColor={C.gray4}
                textAlign="center"
              />
              <TextInput
                style={[styles.textInput, styles.nameInput]}
                value={mealName}
                onChangeText={setMealName}
                placeholder="e.g. Spicy tuna roll"
                placeholderTextColor={C.gray4}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Cuisine */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Cuisine <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={styles.textInput}
              value={mealCuisine}
              onChangeText={setMealCuisine}
              placeholder="e.g. Japanese"
              placeholderTextColor={C.gray4}
              returnKeyType="done"
            />
          </View>

          {/* Rating */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Your rating</Text>
            <ScoreSlider value={score} onChange={setScore} />
          </View>

          {/* Meal tag — auto-guessed from time of day, overridable */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>When was this?</Text>
            <MealTagPicker value={mealTag} onChange={setMealTag} />
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any thoughts?"
              placeholderTextColor={C.gray4}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, stage === 'saving' && styles.saveBtnDisabled]}
            onPress={saveMeal}
            disabled={stage === 'saving'}
          >
            {stage === 'saving' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={C.white} size="small" />
                <Text style={styles.saveBtnText}>
                  {saveStatus === 'uploading' ? 'Uploading photo…' : saveStatus === 'photos' ? 'Adding extra photos…' : 'Saving…'}
                </Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>Save meal</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Permission
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permissionEmoji: { fontSize: 48, marginBottom: 16 },
  permissionTitle: { fontWeight: '700', fontSize: 22, color: C.white, marginBottom: 8, textAlign: 'center' },
  permissionSub: { fontSize: 14, color: C.gray1, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  permissionBtn: { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginBottom: 12 },
  permissionBtnText: { fontWeight: '700', fontSize: 16, color: C.white },
  permissionAlt: { paddingVertical: 8 },
  permissionAltText: { fontSize: 14, color: C.gray2 },

  // Camera
  camTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  camBackBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  camBackText: { fontSize: 16, color: C.white },
  camTitle: { fontWeight: '700', fontSize: 16, color: C.white },
  camFlipBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  camFlipText: { fontSize: 18, color: C.white },
  camFrame: { position: 'absolute', top: '25%', left: '10%', right: '10%', bottom: '25%' },
  camCornerTL: { position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderTopWidth: 2, borderLeftWidth: 2, borderColor: C.orange, borderTopLeftRadius: 4 },
  camCornerTR: { position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderTopWidth: 2, borderRightWidth: 2, borderColor: C.orange, borderTopRightRadius: 4 },
  camCornerBL: { position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: C.orange, borderBottomLeftRadius: 4 },
  camCornerBR: { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderBottomWidth: 2, borderRightWidth: 2, borderColor: C.orange, borderBottomRightRadius: 4 },
  camSponsoredBadge: { position: 'absolute', bottom: 130, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  camSponsoredText: { fontSize: 13, color: C.white, fontWeight: '500' },
  camControls: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 32 },
  camLibBtn: { alignItems: 'center', width: 64 },
  camLibText: { fontSize: 28 },
  camLibLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  camShutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  camShutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.white },

  // Preview
  previewBox: { flex: 1, position: 'relative' },
  previewImg: { width: '100%', height: 320 },
  identifyingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  identifyingText: { fontSize: 16, color: C.white, fontWeight: '500' },
  previewErrBox: { backgroundColor: '#1a0d00', borderTopWidth: 0.5, borderTopColor: '#4a2a00', paddingHorizontal: 20, paddingVertical: 14 },
  previewErrText: { fontSize: 14, color: '#ffaa44', lineHeight: 20, textAlign: 'center' },
  previewActions: { flexDirection: 'row', gap: 12, padding: 24 },
  previewRetake: { flex: 1, borderWidth: 0.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  previewRetakeText: { fontSize: 15, color: C.gray1, fontWeight: '500' },
  previewIdentify: { flex: 2, backgroundColor: C.orange, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  previewIdentifyText: { fontWeight: '700', fontSize: 15, color: C.white },

  // Confirm
  confirmHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backArrow: { fontSize: 22, color: C.gray1 },
  confirmTitle: { fontWeight: '700', fontSize: 18, color: C.white },
  // Photo — enlarged into a hero card (was a small 80x80 side thumbnail)
  // since it's a core feature of logging a meal, not incidental metadata.
  heroPhotoWrap: {
    margin: 24, marginBottom: 0, borderRadius: 20, overflow: 'hidden',
    backgroundColor: C.surface, position: 'relative',
  },
  heroPhoto: { width: '100%', height: 220 },
  heroIdentifiedOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  identifiedEmoji: { fontSize: 28 },
  identifiedText: { flex: 1 },
  identifiedName: { fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 2 },
  identifiedCuisine: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  identifiedLow: { fontSize: 11, color: C.orange, marginTop: 2 },

  // Business tag
  bizTag: { marginHorizontal: 24, marginTop: 16, backgroundColor: '#0f1a0f', borderWidth: 0.5, borderColor: '#1a4a1a', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bizTagEmoji: { fontSize: 18 },
  bizTagName: { fontSize: 14, fontWeight: '500', color: '#4caf50' },
  bizTagLabel: { fontSize: 12, color: '#2a6a2a', marginLeft: 'auto' },

  // Fields
  fieldGroup: { paddingHorizontal: 24, marginTop: 24 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  optional: { color: C.gray4, fontWeight: '400' },

  // Meal tag picker
  tagPickerWrap: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 3, gap: 3,
  },
  tagPickerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  tagPickerBtnActive: { backgroundColor: C.orange },
  tagPickerEmoji: { fontSize: 14 },
  tagPickerText: { fontWeight: '700', fontSize: 13, color: C.gray2 },
  tagPickerTextActive: { color: C.white },
  textInput: { backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.white },
  textArea: { height: 88, textAlignVertical: 'top' },
  nameRow: { flexDirection: 'row', gap: 10 },
  emojiInput: {
    width: 52, backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 12, fontSize: 22, color: C.white,
  },
  nameInput: { flex: 1 },

  // More photos — same dashed "add" tile language used elsewhere in the app
  // (DayBoardScreen's empty "you" tile) for a consistent "tap to add" cue.
  extraPhotosSection: { marginHorizontal: 24, marginTop: 20 },
  extraPhotosHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  extraPhotosLabel: { fontSize: 15, fontWeight: '700', color: C.white },
  extraPhotosRow: { gap: 10, paddingRight: 4 },
  extraPhotoThumbWrap: { width: 72, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: C.surface },
  extraPhotoThumb: { width: '100%', height: '100%' },
  extraPhotoRemoveBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  addExtraPhotoTile: {
    width: 72, height: 72, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.orange, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
    backgroundColor: 'rgba(255,107,61,0.06)',
  },
  addExtraPhotoText: { fontSize: 11, fontWeight: '700', color: C.orange },

  // Score slider
  scoreReadout: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 14 },
  scoreReadoutNum: { fontWeight: '800', fontSize: 40, letterSpacing: -0.5 },
  scoreReadoutLabel: { fontSize: 16, fontWeight: '700' },
  sliderTrack: {
    height: 40,
    justifyContent: 'center',
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: THUMB_SIZE / 2,
    overflow: 'visible',
  },
  sliderFill: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    height: 6,
    borderRadius: 3,
    opacity: 0.9,
  },
  sliderThumb: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    borderColor: C.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  sliderScaleText: { fontSize: 11, color: C.gray3, fontWeight: '600' },

  // Save
  saveBtn: { marginHorizontal: 24, marginTop: 32, backgroundColor: C.orange, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontWeight: '700', fontSize: 16, color: C.white },

  // Identify error
  identifyErrBox: {
    marginHorizontal: 24,
    marginTop: 16,
    backgroundColor: '#2a0a0a',
    borderWidth: 0.5,
    borderColor: '#5a1a1a',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  identifyErrText: { fontSize: 13, color: '#ff6b6b', lineHeight: 19 },
  identifyRetryBtn: { alignSelf: 'flex-start' },
  identifyRetryText: { fontSize: 13, color: C.orange, fontWeight: '600' },

  // Done celebration
  doneBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  doneEmoji: { fontSize: 64, marginBottom: 16 },
  doneTitle: { fontWeight: '800', fontSize: 32, color: C.white, marginBottom: 4, textAlign: 'center' },
  doneSub: { fontSize: 16, color: C.gray1, marginBottom: 8, textAlign: 'center', maxWidth: 260 },
  doneScoreWrap: { alignItems: 'center', marginTop: 22 },
  doneScoreNum: { fontWeight: '800', fontSize: 56, letterSpacing: -1 },
  doneScoreLabel: { fontWeight: '700', fontSize: 16, marginTop: 2 },
  doneHint: { fontSize: 13, color: C.gray2, marginTop: 28 },

  // Done-options stage
  doneContinueBtn: {
    width: '100%', marginTop: 16,
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  doneContinueBtnText: { fontSize: 15, fontWeight: '500', color: C.gray1 },

  // Share prompt card — a light, dismissible suggestion rather than a
  // full-weight decision the user has to make before moving on.
  sharePromptCard: {
    width: '100%', marginTop: 36,
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
  },
  sharePromptRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sharePromptRowCenter: { justifyContent: 'center' },
  sharePromptThumb: {
    width: 40, height: 40, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#111', alignItems: 'center', justifyContent: 'center',
  },
  sharePromptThumbEmoji: { fontSize: 20 },
  sharePromptTitle: { fontSize: 14, fontWeight: '700', color: C.white },
  sharePromptSub: { fontSize: 12, color: C.gray2, marginTop: 1 },
  sharePromptBtn: {
    backgroundColor: '#8855cc', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  sharePromptBtnText: { fontSize: 13, fontWeight: '700', color: C.white },
  sharePromptDismiss: { padding: 2, marginLeft: 2 },
  sharePromptDismissText: { fontSize: 18, color: C.gray4, fontWeight: '600' },
  sharePromptCheckEmoji: { fontSize: 16, color: '#00c896', fontWeight: '800' },
  sharePromptPostedText: { fontSize: 14, fontWeight: '600', color: '#00c896' },

  // Location section — a core feature, so it gets its own bordered card and
  // a bolder, icon-led label instead of the plain gray fieldLabel used by
  // secondary fields like Notes.
  locationSection: {
    marginHorizontal: 24, marginTop: 24,
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 16, padding: 14,
  },
  locationHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  locationSectionLabel: { fontSize: 15, fontWeight: '700', color: C.white },

  // Place field
  placeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.orange,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  placeChipName: { fontSize: 14, fontWeight: '500', color: C.white, marginBottom: 1 },
  homeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.orange,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10,
  },
  homeChipText: { fontSize: 13, fontWeight: '600', color: C.orange },
  placeChipAddr: { fontSize: 12, color: C.gray2 },
  placeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
  },
  placeInput: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 12,
    fontSize: 15,
    color: C.white,
  },
  suggestionsList: {
    marginTop: 4,
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionDivider: {
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  suggestionMain: { fontSize: 14, color: C.white, fontWeight: '500', marginBottom: 1 },
  suggestionSub: { fontSize: 12, color: C.gray2 },
});
