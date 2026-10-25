/*
 * AdMob for the packaged Android app.
 *
 * Runs only inside the Capacitor WebView and only when client/config.js enables
 * it. On the hosted web app this file is a no-op, which keeps the site
 * ad-free and avoids loading ad scripts in a normal browser.
 *
 * Revenue model: one adaptive banner at the bottom, plus an interstitial on
 * every third launch from the fourth launch onwards.
 */
(() => {
  const config = window.DARJAM_ADS || {};
  const capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform?.() || !config.enabled) return;

  const AdMob = capacitor.Plugins?.AdMob;
  if (!AdMob) {
    console.warn('[darjam] AdMob plugin is not available in this build');
    return;
  }

  // Google's official Android test units. Used until real IDs are configured.
  const TEST_BANNER = 'ca-app-pub-3940256099942544/6300978111';
  const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/1033173712';
  const testMode = config.testMode !== false;
  const bannerId = testMode || !config.bannerId ? TEST_BANNER : config.bannerId;
  const interstitialId = testMode || !config.interstitialId ? TEST_INTERSTITIAL : config.interstitialId;
  const LAUNCH_KEY = 'darjam:launches';

  async function askConsent() {
    try {
      let info = await AdMob.requestConsentInfo();
      if (info?.isConsentFormAvailable && info?.status === 'REQUIRED') {
        info = await AdMob.showConsentForm();
      }
      return info;
    } catch (err) {
      console.warn('[darjam] consent check skipped', err);
      return null;
    }
  }

  async function showBanner() {
    try {
      await AdMob.showBanner({
        adId: bannerId,
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        margin: 0,
        isTesting: testMode,
      });
      document.documentElement.classList.add('has-ad-banner');
    } catch (err) {
      console.warn('[darjam] banner unavailable', err);
    }
  }

  async function maybeInterstitial() {
    let launches = 0;
    try {
      launches = Number(localStorage.getItem(LAUNCH_KEY) || 0) + 1;
      localStorage.setItem(LAUNCH_KEY, String(launches));
    } catch {
      return;
    }
    // Keep the first sessions clean, then show one every third launch.
    if (launches < 4 || launches % 3 !== 0) return;

    setTimeout(async () => {
      try {
        await AdMob.prepareInterstitial({ adId: interstitialId, isTesting: testMode });
        await AdMob.showInterstitial();
      } catch (err) {
        console.warn('[darjam] interstitial unavailable', err);
      }
    }, 2500);
  }

  (async () => {
    try {
      if (capacitor?.getPlatform?.() === 'ios') {
        try { await AdMob.requestTrackingAuthorization(); } catch (err) { console.warn('[darjam] ATT request skipped', err); }
      }
      await AdMob.initialize({ initializeForTesting: testMode });
      const consent = await askConsent();
      if (consent && consent.canRequestAds === false) {
        console.warn('[darjam] ads disabled: consent not granted');
        return;
      }
      await showBanner();
      await maybeInterstitial();
    } catch (err) {
      console.warn('[darjam] ads failed to start', err);
    }
  })();
})();
