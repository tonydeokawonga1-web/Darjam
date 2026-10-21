# DarJam — Google Play store listing copy

Everything here is ready to paste into Play Console. The operator identity is
**Tony Deogratias** &lt;tonydeogratiaskawonga1@gmail.com&gt;.

## Identity

| Field | Value |
| --- | --- |
| App name (max 30) | `DarJam — Dar traffic` |
| Package name | `tz.darjam.app` |
| Category | Maps & Navigation |
| Tags | Traffic, Navigation, Commute |
| Default language | English (United Kingdom) |
| Contact email | `tonydeogratiaskawonga1@gmail.com` |
| Website | `https://<your-domain>/` |
| Privacy policy | `https://<your-domain>/privacy.html` |

**Developer page name:** `Tony Deogratias` (set in Play Console when you register).

## Short description (max 80 characters)

```
Live traffic-jam levels for Dar es Salaam, road by road and hour by hour.
```

## Full description (max 4000 characters)

```
DarJam shows how jammed Dar es Salaam is right now — road by road — and how bad it will be later today.

Built for commuters, boda riders, taxi and delivery drivers who need to decide one thing fast: leave now, leave later, or take a different road.

LIVE JAM LEVELS
• Every major corridor scored from Free to Gridlock, updated continuously
• Colour-coded map so you can see the whole city at a glance
• Delay in minutes and average speed for each road, in both directions

KNOW BEFORE YOU GO
• 24-hour forecast per road so you can pick a better departure time
• "Leave later" planner that finds the quickest window in the next few hours
• Rain-aware: Dar traffic gets worse in the rain, and DarJam knows when it rains

COMMUNITY REPORTS
• See accidents, police checks, flooding, roadworks and closures reported by other drivers
• Add a report in a few seconds — no account, no sign-up
• Reports fade automatically so old information does not mislead you

NEAR YOU
• One tap finds the closest corridor and shows how it is moving

GOOD TO KNOW
• Works with a slow connection and keeps the last update on screen
• Small, fast, dark-themed and battery friendly
• Free, supported by ads

ABOUT THE DATA
DarJam estimates congestion using a time-of-day demand model, live weather for Dar es Salaam, and reports from the community. It is not official traffic data from any authority and it cannot see every street. Use it as guidance, keep your eyes on the road, and always follow police directions and road signs.

Msongamano · Dar es Salaam
```

## Swahili full description (draft, for a later locale)

```
DarJam inakuonyesha msongamano wa Dar es Salaam sasa hivi — barabara kwa barabara — na jinsi hali itakavyokuwa baadaye leo.

Imeundwa kwa ajili ya waendeshaji, bodaboda, teksi na madereva wa usafirishaji wanaohitaji jibu moja haraka: ondoka sasa, ondoka baadaye, au chukua barabara nyingine.

• Viwango vya msongamano kwa kila barabara kuu, kutoka Huru hadi Msongamano mkubwa
• Ramani ya rangi ili kuona hali ya jiji zima kwa mtazamo mmoja
• Ucheleweshaji kwa dakika na mwendo wa wastani kwa kila barabara
• Utabiri wa saa 24 kwa kila barabara
• Mpangilio wa kuondoka ambao unatafuta muda mzuri zaidi
• Taarifa za jamii: ajali, ukaguzi wa polisi, mafuriko, ujenzi na barabara zilizofungwa

DarJam inakadiria msongamano kwa kutumia mfumo wa muda wa siku, hali ya hewa ya Dar es Salaam na taarifa za jamii. Hii si taarifa rasmi ya mamlaka yoyote. Tumia kama mwongozo, na fuata maagizo ya polisi na alama za barabara.
```

## Graphics

| Asset | Spec | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG, 32-bit, no transparency | `docs/store/icon-512.png` |
| Feature graphic | 1024 × 500 PNG/JPG | `docs/store/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, min 320 px, max 3840 px | `docs/store/screenshots/01-live.png` … `05-road-detail.png` |
| Tablet screenshots | optional | — |

Regenerate screenshots after UI changes (the app must be running):

```powershell
npm run store:shots -- --url http://localhost:3100 --seed
```

For rush-hour imagery, run a second server with a frozen clock and screenshot it
(the browser clock is frozen too, so report ages and the header clock match):

```powershell
$env:DARJAM_NOW="2026-10-20T14:45:00Z"   # 17:45 EAT
$env:PORT=3102; node server/index.js
npm run store:shots -- --url http://localhost:3102 --fake-date 2026-10-20T14:45:00Z --seed
```

`DARJAM_NOW` and `--fake-date` are development hooks only and must never be set in
production. Delete `server/data/reports.json` afterwards to clear demo reports.

## Categorisation questionnaire answers

- **Ads:** Yes, the app contains ads.
- **In-app purchases:** No (ads-only build).
- **App access:** All functionality is available without login or special access.
- **Target audience:** 13–15, 16–17 and 18+ (not designed for children; do not opt into the Families programme).
- **News app:** No. **COVID-19 contact tracing:** No. **Government app:** No.
- **Content rating questionnaire:** no violence, no sexuality, no profanity, no drugs, no gambling; user-generated content (community reports) is moderated by expiry and manual removal; shares location only on user request.
- **Data safety:** see `docs/PLAY_LAUNCH.md` for the draft answers.
