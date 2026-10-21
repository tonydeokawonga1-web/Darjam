/*
 * Runtime configuration for packaged builds.
 *
 * The hosted web app is served by the same process as the API, so the base URL
 * stays empty. The Android bundle is loaded from capacitor://localhost, so it
 * must point at the hosted API, e.g.:
 *
 *   window.DARJAM_API_BASE = 'https://api.darjam.tz';
 *
 * This file is read at startup and is safe to leave public.
 */
window.DARJAM_API_BASE = '';

/*
 * Ads are only used by the packaged Android app. Keep `enabled: false` for the
 * hosted web app; the mobile build turns this on and fills in real unit IDs.
 */
window.DARJAM_ADS = {
  enabled: false,
  testMode: true,
  bannerId: '',
  interstitialId: '',
};
