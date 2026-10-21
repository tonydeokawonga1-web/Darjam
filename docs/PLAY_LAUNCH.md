# DarJam — Google Play launch checklist

This is the end-to-end path from this repository to a live, ad-supported Android
app on Google Play under your name. Steps marked **YOU** can only be done by you
(accounts, payments, identity); everything else is already wired up in the repo.

---

## 0. What is already done

- Android project generated with Capacitor 8 (`android/`), app id `tz.darjam.app`.
- `compileSdk`/`targetSdk` = **36** (Android 16) — meets Play's requirement for new
  apps since 31 Aug 2026.
- Adaptive launcher icon, legacy icons, round icon and splash screens generated
  from the DarJam brand mark (`docs/brand/`).
- Release signing reads env vars, so the keystore is never committed.
- AdMob integration: consent (UMP) → adaptive banner → interstitial every third
  launch (from launch 4), all behind `client/config.js`. Web build stays ad-free.
- Native geolocation and Android hardware back button handling.
- Privacy policy and terms pages served by the app itself (`/privacy.html`,
  `/terms.html`) and linked from the Reports tab.
- GitHub Actions workflow that builds a **signed AAB** (`.github/workflows/android.yml`).
- Server is commercial-ready: tile provider and weather provider are configurable
  by env vars, with production warnings if the non-commercial defaults are used.
- Dockerfile + `render.yaml` for hosting the API.

---

## 1. Decide the developer account type

| | Personal account | Organisation account |
| --- | --- | --- |
| Cost | US$25 one-time | US$25 one-time |
| Verification | Government ID + address | Business registration + D-U-N-S number |
| Extra requirement | **Closed test with 12 testers opted in for 14 continuous days** before you can apply for production | none |
| Payout | Works | Works |

The 12-tester rule applies to personal accounts created after 13 Nov 2023. It is
the longest part of the timeline (about 3 weeks end to end). If you already run a
registered business, an organisation account avoids it.

**Identity for this launch:** developer name **Tony Deogratias**, contact
**tonydeogratiaskawonga1@gmail.com** — use the same details in Play Console, the
privacy policy and the AdMob payments profile so everything matches.

**YOU:** register at <https://play.google.com/console/signup>, pay US$25, complete
identity verification, and set the developer name that will be shown publicly
(your own name, or a trading name).

---

## 2. Accounts to create

| Service | Why | Cost |
| --- | --- | --- |
| Google Play Console | Publish the app | US$25 once |
| Google AdMob | Ads + payments | free |
| MapTiler (or ArcGIS, Stadia Maps…) | Commercial map tiles | free tier: 100k tiles/month |
| Open-Meteo | Live weather | free tier is non-commercial; commercial plan needed (~€29/mo) |
| Render / Fly.io / a VPS | Host the API | ~US$7/month |
| Domain (optional but recommended) | Privacy policy URL, nicer API host | ~US$12/year |

**YOU:** create the AdMob account, add an Android app (you can do this before the
app is published), and create two ad units:

- **Banner** → `DARJAM_ADMOB_BANNER`
- **Interstitial** → `DARJAM_ADMOB_INTERSTITIAL`

Copy the AdMob **App ID** (`ca-app-pub-…~…`) into
`android/app/src/main/res/values/strings.xml` (`admob_app_id`) — the repository
ships with Google's test ID, which must not be used in production.

---

## 3. Make the server commercial-compliant

Map tiles and weather are the two licences that must change before you charge money
or show ads.

**Map tiles (required).** MapTiler free tier:

```powershell
$env:DARJAM_TILE_URL = "https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.jpg?key=YOUR_KEY"
$env:DARJAM_TILE_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors"
$env:DARJAM_TILE_MAX_ZOOM = "20"
```

Setting `DARJAM_TILE_URL` also disables the keyless Esri labels layer.

**Weather (choose one).**

- Subscribe to Open-Meteo and set `OPEN_METEO_API_KEY=…`, or
- set `DARJAM_WEATHER=off` to run on the dry baseline (the model still works; rain
  is just not factored in).

**Deploy.** With a Render account, point a Blueprint at this repo — `render.yaml`
provisions the service, health check, env vars and a 1 GB disk for reports. Then
set `DARJAM_ALLOWED_ORIGINS=capacitor://localhost,https://localhost` so the Android
app can call the API.

> Reports live in a JSON file. On Render's free instance the disk is ephemeral and
> the service sleeps; use the Starter plan or a small VPS for a real launch.

---

## 4. Create the upload keystore (**YOU**, keep it safe)

Any machine with a JDK (Android Studio or Temurin 21):

```powershell
keytool -genkeypair -v -keystore darjam-upload.jks -alias darjam `
  -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS
```

- Store the file and both passwords somewhere you will not lose them (password
  manager + offline copy). If you enable Play App Signing (default), Google holds
  the app signing key and you can request an upload-key reset, but losing the
  keystore still costs you time.
- **Never commit it.** `.gitignore` already excludes `*.jks` and `*.keystore`.

Base64 for CI:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("darjam-upload.jks")) | Set-Clipboard
```

---

## 5. Configure the build

> The project folder is not a git repository yet. The workflow below needs one on
> GitHub:
>
> ```bash
> git init
> git add .
> git commit -m "DarJam 1.0"
> git branch -M main
> git remote add origin https://github.com/<you>/darjam.git
> git push -u origin main
> ```
>
> `.gitignore` already excludes `node_modules`, reports and keystores. Check
> `git status` before the first commit so no `.jks` file is included.

Repository **variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Example |
| --- | --- |
| `DARJAM_API_BASE` | `https://darjam-api.onrender.com` |
| `DARJAM_ADMOB_BANNER` | `ca-app-pub-…/…` |
| `DARJAM_ADMOB_INTERSTITIAL` | `ca-app-pub-…/…` |
| `DARJAM_ADMOB_TEST` | `0` (production) |
| `DARJAM_VERSION_NAME` | `1.0.0` |

Repository **secrets**:

| Secret | Value |
| --- | --- |
| `DARJAM_KEYSTORE_BASE64` | base64 of `darjam-upload.jks` |
| `DARJAM_KEYSTORE_PASSWORD` | keystore password |
| `DARJAM_KEY_ALIAS` | `darjam` |
| `DARJAM_KEY_PASSWORD` | key password |

Then either push a tag (`git tag v1.0.0 && git push --tags`) or run the
**Android release** workflow manually. The signed bundle appears as the
`darjam-release-aab` artifact.

Local alternative (needs JDK + Android SDK):

```powershell
npm run build:mobile -- --api-base https://darjam-api.onrender.com --ads
cd android
$env:DARJAM_KEYSTORE="C:\path\darjam-upload.jks"; $env:DARJAM_KEY_ALIAS="darjam"
$env:DARJAM_KEYSTORE_PASSWORD="…"; $env:DARJAM_KEY_PASSWORD="…"
./gradlew bundleRelease
```

Version code comes from `DARJAM_VERSION_CODE` (CI uses the run number); bump it for
every upload. Play rejects a bundle with a version code it has already seen.

---

## 6. Play Console forms

**Data safety — draft answers.** Verify against Google's current AdMob disclosure
guidance before submitting; this reflects what the app and AdMob actually do.

| Question | Answer |
| --- | --- |
| Does your app collect or share any required user data types? | Yes |
| Location → Approximate location | Collected by the ads SDK, shared, for Advertising or marketing |
| Device or other IDs | Collected, shared, for Advertising or marketing |
| App activity → Other actions (community reports) | Collected, not shared, for App functionality |
| Personal info (name, email, phone) | Not collected |
| Precise location | Not collected — location is used on-device only |
| Messages, photos, files, contacts, health, financial | Not collected |
| Is data encrypted in transit? | Yes (HTTPS) |
| Can users request deletion? | Yes — email `[YOUR EMAIL]`; reports expire automatically |

**Other declarations.** Contains ads: **yes**. App access: fully usable without
login. Content rating: complete the questionnaire (no violence, drugs, gambling,
sexual content; user-generated content with expiry + manual removal).

**Privacy policy URL:** the pages are already filled in with the operator identity
above; just publish them and confirm the URL loads without login.

---

## 7. Testing tracks and release

1. **Internal testing** — upload the AAB, add your own Google account as a tester,
   install via the opt-in link, and check: map loads, locate works, a report can be
   submitted, the back button behaves, ads show as test ads.
2. **Closed testing** (personal accounts only) — add at least **12 testers** who
   stay opted in for **14 continuous days**. Keep them engaged; the clock only runs
   while they are opted in. Invite friends, family, colleagues, or a tester
   community if needed.
3. **Apply for production** — after 14 days Play reviews your account and app
   (typically a few days, sometimes longer for a new developer).
4. **Staged rollout** — start at 20%, watch crashes and reviews, then go to 100%.

Release checklist for every update:

- [ ] `npm test` passes and `npm run check` is clean
- [ ] `DARJAM_VERSION_CODE` increased
- [ ] `DARJAM_API_BASE` points at the production API
- [ ] `DARJAM_ADMOB_TEST=0` and real ad unit IDs set
- [ ] `admob_app_id` in `strings.xml` is your real AdMob App ID
- [ ] Release notes written (English; Swahili if you add the locale)

---

## 8. Getting paid

- AdMob pays by **wire transfer**, which is available for Tanzania. Add your bank
  details in AdMob → Payments; a USD account (NMB, CRDB, NBC) is the smoothest
  route, and Payoneer is a common alternative. The account holder name must match
  the developer name, **Tony Deogratias**.
- Payment threshold is **US$100**; verified accounts are paid monthly, around the
  21st, for the previous month's balance.
- Complete the **tax info** form (W-8BEN for an individual) or Google withholds
  part of your earnings.
- Ads are the only revenue stream in this build. Selling a subscription would need
  a Play merchant/payments profile with a supported payout route — start with ads.
- Keep an eye on Play policy: no ads on top of the map controls, no ads that look
  like UI buttons, and no incentivised clicks.

### Realistic numbers

Tanzania banner eCPM is roughly **US$0.3–1.5**. With ~1,000 daily users and 2–3
impressions each, that is about **US$2–4/day ≈ US$60–120/month**. With a few
hundred users expect single-digit dollars. Monthly costs are ~US$7 hosting +
~US$1 domain + tiles free at low volume + Open-Meteo if you keep live rain. Ads
cover the basics once you have a real user base; growth matters more than the ad
format.

---

## 9. Review risks and how this build handles them

| Risk | Mitigation in this build |
| --- | --- |
| "Thin webview / minimum functionality" rejection | The UI is bundled, there is no browser chrome, and the app adds native geolocation, hardware back handling and native ads. Content (jam levels, weather, reports) changes continuously and is not a copy of a public website. |
| Ads policy violation | Ads are native AdMob placements, never disguised as buttons, and test IDs are used until you set real ones. Declare "contains ads" in the listing. |
| Location permission misuse | Location is requested only when the user taps the locate button, is used on-device, and is never uploaded. No background location. |
| Data safety mismatch | The draft form in section 6 matches the code. Update it if you add analytics, push notifications or accounts. |
| Privacy policy placeholders | Replace `[YOUR FULL NAME / BUSINESS NAME]` and `[YOUR EMAIL]` and confirm the URL loads without login. |
| Broken store build | The AAB is built from CI with the production API base, real ad IDs and a keystore; smoke-test the internal track before promoting. |

## 10. Tanzanian context and growth

- Store listing in English first; add the Swahili locale from
  `docs/store/listing.md` once the English release is live.
- Distribution is mostly word of mouth, WhatsApp groups, boda/taxi driver
  communities, and local radio or X/Twitter during heavy rain.
- Peak usage is morning (06:00–09:00) and evening (16:00–20:00) — plan server
  capacity and any announcements around those windows.
- Trademark: check that "DarJam" is not already registered in Tanzania before you
  print it on anything.

---

## 11. Costs at a glance

| Item | Cost |
| --- | --- |
| Play Console | US$25 once |
| Keystore / CI | free (GitHub Actions) |
| Hosting | ~US$7/month |
| Domain | ~US$12/year |
| MapTiler | free to 100k tiles/month |
| Open-Meteo commercial | ~€29/month (optional) |
| **Total to launch** | **≈US$40** |
| **Monthly after launch** | **≈US$8–40** |

The one thing money cannot buy is the 14-day, 12-tester window on a personal
account — start that as early as possible.
