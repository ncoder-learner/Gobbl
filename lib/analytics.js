/**
 * Analytics utility module for Firebase Analytics integration.
 * Provides a centralized, safe wrapper for logging screen views and custom events.
 */

import analytics from '@react-native-firebase/analytics';

/**
 * Log a screen view event.
 * Automatically called by the navigation listener; can also be called manually
 * for edge cases where route tracking doesn't capture everything.
 * @param {string} screenName - The name of the screen being viewed
 * @param {object} params - Optional parameters to include with the event
 */
export async function logScreenView(screenName, params = {}) {
  try {
    await analytics().logScreenView({
      screen_name: screenName,
      screen_class: screenName,
      ...params,
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log screen view:', error?.message ?? error);
  }
}

/**
 * Log a custom event for meal logging.
 * @param {object} params - Event parameters
 */
export async function logMealEvent(params = {}) {
  try {
    await analytics().logEvent('log_meal', {
      meal_name: params.mealName || '',
      meal_tag: params.mealTag || '', // breakfast, lunch, dinner, snack
      has_photo: params.hasPhoto ?? false,
      has_place: params.hasPlace ?? false,
      place_name: params.placeName || '',
      score: params.score || 0,
      has_notes: params.hasNotes ?? false,
      extra_photos_count: params.extraPhotosCount || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log meal event:', error?.message ?? error);
  }
}

/**
 * Log photo capture event.
 * @param {object} params - Event parameters
 */
export async function logMealPhotoEvent(params = {}) {
  try {
    await analytics().logEvent('snap_meal_photo', {
      source: params.source || 'camera', // 'camera' or 'library'
      stage: params.stage || 'primary', // 'primary' or 'extra'
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log photo event:', error?.message ?? error);
  }
}

/**
 * Log place/location tagging event.
 * @param {object} params - Event parameters
 */
export async function logLocationEvent(params = {}) {
  try {
    await analytics().logEvent('tag_location', {
      restaurant_name: params.restaurantName || '',
      is_home: params.isHome ?? false,
      address: params.address || '',
      has_coordinates: params.hasCoordinates ?? false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log location event:', error?.message ?? error);
  }
}

/**
 * Log meal sharing event.
 * @param {object} params - Event parameters
 */
export async function logShareEvent(params = {}) {
  try {
    await analytics().logEvent('share_meal', {
      meal_name: params.mealName || '',
      share_type: params.shareType || 'share_list', // 'share_list', 'social', etc.
      content_type: params.contentType || 'meal',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log share event:', error?.message ?? error);
  }
}

/**
 * Log a meal editing event.
 * @param {object} params - Event parameters
 */
export async function logEditMealEvent(params = {}) {
  try {
    await analytics().logEvent('edit_meal', {
      meal_id: params.mealId || '',
      fields_edited: params.fieldsEdited || '', // comma-separated: 'name', 'score', 'notes', etc.
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log edit meal event:', error?.message ?? error);
  }
}

/**
 * Log authentication event.
 * @param {object} params - Event parameters
 */
export async function logAuthEvent(params = {}) {
  try {
    await analytics().logEvent('user_auth', {
      auth_type: params.authType || 'email', // 'email', 'apple', 'google', etc.
      action: params.action || 'login', // 'login', 'signup', 'logout'
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log auth event:', error?.message ?? error);
  }
}

/**
 * Log profile update event.
 * @param {object} params - Event parameters
 */
export async function logProfileEvent(params = {}) {
  try {
    await analytics().logEvent('profile_update', {
      update_type: params.updateType || 'info', // 'info', 'preferences', 'avatar', etc.
      field_name: params.fieldName || '',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log profile event:', error?.message ?? error);
  }
}

/**
 * Log user interaction/engagement events.
 * @param {object} params - Event parameters
 */
export async function logEngagementEvent(params = {}) {
  try {
    await analytics().logEvent('user_engagement', {
      action: params.action || '',
      screen: params.screen || '',
      content_type: params.contentType || '',
      content_id: params.contentId || '',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log engagement event:', error?.message ?? error);
  }
}

/**
 * Log error/exception event.
 * @param {object} params - Event parameters
 */
export async function logErrorEvent(params = {}) {
  try {
    await analytics().logEvent('app_error', {
      error_type: params.errorType || 'unknown',
      error_message: params.errorMessage || '',
      context: params.context || '',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[Analytics] Failed to log error event:', error?.message ?? error);
  }
}
