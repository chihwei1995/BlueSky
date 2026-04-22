import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app-check.js";
import { BLUE_SKY_APP_CHECK_CONFIG } from "./firebase-app-check-config.js";

const looksConfigured = (value) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !/YOUR_|SITE_KEY|RECAPTCHA/i.test(value);

const isLocalDebugHost = () => {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

const getProvider = (siteKey) => {
  if (BLUE_SKY_APP_CHECK_CONFIG.provider === "v3") {
    return new ReCaptchaV3Provider(siteKey);
  }
  return new ReCaptchaEnterpriseProvider(siteKey);
};

export function setupBlueSkyAppCheck(app, options = {}) {
  const label = options.pageName || "unknown-page";
  const siteKey = BLUE_SKY_APP_CHECK_CONFIG.siteKey?.trim();

  if (!looksConfigured(siteKey)) {
    console.info(
      `[App Check] Skipped on ${label}: missing site key in assets/firebase-app-check-config.js`
    );
    return null;
  }

  try {
    if (isLocalDebugHost()) {
      const debugToken = localStorage.getItem(
        BLUE_SKY_APP_CHECK_CONFIG.debugTokenStorageKey || "bsr_app_check_debug_token"
      );
      if (debugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
      }
    }

    return initializeAppCheck(app, {
      provider: getProvider(siteKey),
      isTokenAutoRefreshEnabled:
        BLUE_SKY_APP_CHECK_CONFIG.isTokenAutoRefreshEnabled !== false
    });
  } catch (error) {
    console.warn(`[App Check] Failed on ${label}:`, error);
    return null;
  }
}
