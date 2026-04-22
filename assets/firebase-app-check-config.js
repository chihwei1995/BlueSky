export const BLUE_SKY_APP_CHECK_CONFIG = {
  // Firebase 官方目前更推薦新整合使用 enterprise。
  // 若你先建立的是 reCAPTCHA v3，也可改成 "v3"。
  provider: "enterprise",

  // 到 Firebase Console > App Check 註冊 Web app 後，填入對應的 public site key。
  // 留空時，前端會自動略過 App Check 初始化，不會讓頁面壞掉。
  siteKey: "",

  isTokenAutoRefreshEnabled: true,

  // 若本機要用 debug provider，可先在 console 執行：
  // localStorage.setItem("bsr_app_check_debug_token", "YOUR_DEBUG_TOKEN")
  debugTokenStorageKey: "bsr_app_check_debug_token"
};
