# DarJam — Apple App Store launch checklist

This is the path from this repository to a live, ad-supported iOS app on the
App Store under your name. Steps marked **YOU** can only be done by you. The
Android/Play checklist is in `docs/PLAY_LAUNCH.md`.

---

## 0. What is already done

- iOS platform generated with Capacitor 8 (`ios/`), bundle id `tz.darjam.app`.
- `Info.plist` declares location usage (on-device only) and the tracking usage
  string required by AdMob.
- `ITSAppUsesNonExemptEncryption` is set to `false` (no export-compliance
  questionnaire).
- App icon is the 1024×1024 DarJam mark.
- AdMob integration requests App Tracking Transparency on iOS before
  initialising the SDK.
- Native geolocation, hardware back handling, native Share sheet.
- GitHub Actions workflow `.github/workflows/ios.yml` builds an IPA on
  `macos-latest`.
- Privacy policy and terms pages are bundled in the app.

---

## 1. Requirements

| | |
| --- | --- |
| Apple Developer Program | US$99/year, requires 2FA on your Apple ID |
| Mac | Needed to run Xcode locally. Without one, use the GitHub Actions workflow. |
| Bundle id | `tz.darjam.app` (cannot change after the first upload) |
| Minimum iOS | 16 (Capacitor 8 default; check `IPHONEOS_DEPLOYMENT_TARGET` in Xcode) |

**YOU:** enrol at <https://developer.apple.com/programs/>, create an App ID with
bundle id `tz.darjam.app`, and create an app in App Store Connect.

---

## 2. Accounts and ad units

- Reuse the same AdMob account, but create **iOS** ad units (AdMob units are
  platform-specific): one banner, one interstitial. Set them via
  `DARJAM_ADMOB_BANNER_IOS` / `DARJAM_ADMOB_INTERSTITIAL_IOS` (or reuse the
  generic ones if you only created one set).
- Complete App Store Connect tax and banking forms (paid apps / ads revenue).
  Apple pays **30 days after the end of each month**.
- The Apple Developer account name should match the operator name on the
  privacy policy: **Tony Deogratias**.

---

## 3. Code signing (CI or local)

You need a Distribution certificate and an App Store provisioning profile.

**YOU:** in the Apple Developer portal:

1. Create a **Distribution** certificate (iOS App Store), download it.
2. Create an **App Store** provisioning profile for `tz.darjam.app`, download it.
3. Export the certificate as a `.p12` with a password.

Add to GitHub secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE_BASE64` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_PROVISIONING_PROFILE_BASE64` | base64 of the `.mobileprovision` |
| `APPLE_PROVISIONING_PROFILE_NAME` | profile name as shown in Xcode |
| `APPLE_TEAM_ID` | your 10-character team id |

Then run the **iOS release** workflow (manual or on a `v*` tag). The signed IPA
appears as the `darjam-release-ipa` artifact.

Local alternative (on a Mac):

```bash
npm run build:mobile -- --api-base https://api.example.com --ads --platform ios
cd ios/App
open App.xcworkspace   # Archive → Distribute App → App Store Connect
```

---

## 4. App Store Connect metadata

| Field | Value |
| --- | --- |
| Name | DarJam |
| Subtitle (30 chars) | Dar es Salaam traffic, live |
| Bundle ID | tz.darjam.app |
| Primary category | Navigation |
| Secondary category | (optional) Travel |
| Privacy policy URL | `https://<your-host>/privacy.html` |
| Support URL | `https://<your-host>/` |
| Marketing URL | (optional) |
| Age rating | 12+ (ads; not directed at children) |
| Price | Free |

**Description** — reuse the full description from `docs/store/listing.md`.

**Keywords (100 chars, comma-separated):**
```
dar es salaam traffic,jam,commute,road,forecast,reports,tanzania,boda,driver
```

**App Privacy (Data Safety equivalent).** AdMob collects device/advertising ID,
IP address, approximate location and usage data for advertising. The app itself
collects no personal data: location is used on-device only, and community
reports contain no identity. Declare accordingly and link the privacy policy.

---

## 5. Screenshots and graphics

Required sizes (at least one per device class you support):

- 6.9" (iPhone 16 Pro Max) — 1320 × 2868
- 6.7" (iPhone 15 Pro Max) — 1290 × 2796
- 6.5" (iPhone 11 Pro Max) — 1242 × 2688
- 5.5" (iPhone 8 Plus) — 1242 × 2208
- iPad (if universal) — 2048 × 2732

Regenerate from a running server (the same script as Android, at 390×844 CSS):

```powershell
npm run store:shots -- --url http://localhost:3100 --seed
```

Then upscale or re-capture at the required pixel sizes. App icon: 1024 × 1024,
no transparency, no rounded corners (Apple applies the mask).

---

## 6. Privacy manifest

Capacitor and the AdMob SDK ship their own `PrivacyInfo.xcprivacy`. If Xcode
warns about missing required-reason APIs, add one to the app target:

1. In Xcode, File → New → File → App Privacy.
2. Save as `PrivacyInfo.xcprivacy` in `ios/App/App/`.
3. Add it to the app target's "Copy Bundle Resources" build phase.
4. Declare any APIs your own code uses (this app uses none directly).

---

## 7. Testing and submission

1. **TestFlight internal testing** — upload the IPA via Xcode or
   `xcrun altool --upload-app`. Add up to 100 internal testers.
2. **TestFlight external testing** (optional) — requires a short beta review.
3. **Submit for review** — attach the screenshots, metadata, privacy URL and
   review notes.

Review notes to include:

> DarJam estimates traffic levels from a time-of-day model, weather and
> community reports. There are no accounts. Location is used only when the user
> taps the locate button and is processed on the device; it is never uploaded.
> Ads are served by Google AdMob with a consent message. Traffic figures are
> estimates, not official data.

Review typically takes 24–48 hours for a new app; plan for a week.

---

## 8. Review risks

| Risk | Mitigation |
| --- | --- |
| Minimum functionality / web-wrapper rejection | Native geolocation, back handling, Share sheet, ATT and native ads. No browser chrome. |
| ATT not implemented | `requestTrackingAuthorization()` is called before the SDK initialises. |
| Location permission misuse | Foreground only, on tap, on-device. Declared in `Info.plist`. |
| Privacy manifest mismatch | SDKs ship their own; app target adds one only if needed. |
| Ads policy | Native AdMob placements, declared in the listing, test IDs removed for release. |

---

## 9. Costs

| Item | Cost |
| --- | --- |
| Apple Developer Program | US$99/year |
| Mac (if you don't own one) | buy or use the GitHub Actions runner (free for public repos) |
| Hosting, tiles, weather | same as the Android build (~US$8–40/month) |

Apple pays out monthly, 30 days after the month ends, into the bank account on
file. Set up tax forms (W-8BEN for an individual) before the first payment.
