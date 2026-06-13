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
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { decode } from 'base64-arraybuffer';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';
import ShareBottomSheet from '../components/ShareBottomSheet';

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
    return ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * width;
  }

  // Stored in a ref so the PanResponder closure never goes stale
  const reportRef = useRef((x) => {
    const width = trackWidthRef.current;
    if (!width) return;
    const clamped = Math.max(0, Math.min(width, x));
    const raw = SCORE_MIN + (clamped / width) * (SCORE_MAX - SCORE_MIN);
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LogMealScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const sponsored = route.params?.sponsored ?? null; // passed from HomeScreen sponsored ad

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [camTooltipVisible, dismissCamTooltip] = useFirstVisit('@fw_tt_logmeal');

  const [stage, setStage] = useState('camera'); // camera | preview | identifying | confirm | saving | done
  const [imageUri, setImageUri] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMediaType, setImageMediaType] = useState('image/jpeg');
  const [identified, setIdentified] = useState(null); // Claude's response
  const [mealName, setMealName] = useState('');
  const [score, setScore] = useState(5.5);
  const [savedMealId, setSavedMealId] = useState(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePosted, setSharePosted] = useState(false);
  const [notes, setNotes] = useState('');
  const [facing, setFacing] = useState('back');
  const [processing, setProcessing] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'uploading' | 'inserting'
  const [identifyError, setIdentifyError] = useState(null); // null | 'timeout' | 'error'

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

      // 2. Insert meal row; if this fails, remove the orphaned photo
      setSaveStatus('inserting');
      const derivedRating = Math.max(1, Math.min(5, Math.round(score / 2)));

      const { data: inserted, error: insertError } = await supabase
        .from('meals')
        .insert({
          user_id: user.id,
          name: mealName.trim(),
          emoji: identified?.emoji || '🍽️',
          description: identified?.description || '',
          cuisine: identified?.cuisine || '',
          rating: derivedRating,
          score,
          notes: notes.trim() || null,
          photo_url: publicUrl,
          business_id: sponsored?.id || null,
          ai_confidence: identified?.confidence || null,
        })
        .select('id')
        .single();

      if (insertError) {
        await supabase.storage.from('meal-photos').remove([uploadedFileName]);
        throw insertError;
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
    setScore(5.5);
    setNotes('');
    setSavedMealId(null);
    setSavedPhotoUrl(null);
    setShareOpen(false);
    setSharePosted(false);
    navigation.navigate('TierList', { newMealId: mealId });
  }

  if (stage === 'done') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <DoneCelebration
          emoji={identified?.emoji || '🍽️'}
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
      emoji: identified?.emoji || '🍽️',
      score,
      photo_url: savedPhotoUrl,
    };
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.doneBox}>
          <Text style={styles.doneEmoji}>{identified?.emoji || '🍽️'}</Text>
          <Text style={styles.doneTitle}>Logged!</Text>
          <Text style={styles.doneSub} numberOfLines={1}>{mealName}</Text>

          <View style={styles.doneOptionsRow}>
            {sharePosted ? (
              <View style={styles.doneSharedBadge}>
                <Text style={styles.doneSharedText}>✓ Shared to feed</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.doneShareBtn}
                onPress={() => setShareOpen(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.doneShareBtnText}>Share to feed →</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.doneContinueBtn}
              onPress={handleFinish}
              activeOpacity={0.85}
            >
              <Text style={styles.doneContinueBtnText}>
                {sharePosted ? 'Continue →' : 'Skip · Go to tier list'}
              </Text>
            </TouchableOpacity>
          </View>
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

          {/* Photo thumbnail */}
          <View style={styles.thumbRow}>
            <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
            {identified && (
              <View style={styles.identifiedBadge}>
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
            )}
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

          {/* Name input */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Meal name</Text>
            <TextInput
              style={styles.textInput}
              value={mealName}
              onChangeText={setMealName}
              placeholder="e.g. Spicy tuna roll"
              placeholderTextColor={C.gray4}
              returnKeyType="done"
            />
          </View>

          {/* Rating */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Your rating</Text>
            <ScoreSlider value={score} onChange={setScore} />
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Where'd you eat it? Any thoughts?"
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
                  {saveStatus === 'uploading' ? 'Uploading photo…' : 'Saving…'}
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
  thumbRow: { margin: 24, marginBottom: 0, flexDirection: 'row', gap: 14, alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 14, backgroundColor: C.surface },
  identifiedBadge: { flex: 1, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  identifiedEmoji: { fontSize: 28 },
  identifiedText: { flex: 1 },
  identifiedName: { fontSize: 14, fontWeight: '500', color: C.white, marginBottom: 2 },
  identifiedCuisine: { fontSize: 12, color: C.gray2 },
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
  textInput: { backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.white },
  textArea: { height: 88, textAlignVertical: 'top' },

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
  doneOptionsRow: { width: '100%', marginTop: 36, gap: 12 },
  doneShareBtn: {
    backgroundColor: '#8855cc', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
  },
  doneShareBtnText: { fontSize: 16, fontWeight: '700', color: C.white },
  doneContinueBtn: {
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  doneContinueBtnText: { fontSize: 15, fontWeight: '500', color: C.gray1 },
  doneSharedBadge: {
    backgroundColor: '#1a2a1a', borderWidth: 0.5, borderColor: '#2a5a2a',
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  doneSharedText: { fontSize: 15, fontWeight: '600', color: '#00c896' },
});
