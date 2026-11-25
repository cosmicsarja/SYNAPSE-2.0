# FormLens Android APK via Trusted Web Activity (TWA)

This directory documents how to build a native Android APK that wraps the FormLens PWA
using a Trusted Web Activity (TWA). The APK can be distributed via GitHub Releases or
sideloaded; it does not require Play Store approval for internal use.

---

## Prerequisites

- Node.js 18+ and npm
- Java JDK 17+ (for `keytool` and Android build)
- Android SDK (or use the cloud build alternative below)
- Your FormLens Vercel URL (e.g. `https://formlens.vercel.app`)

---

## Option A — Bubblewrap CLI (local build)

### 1. Install Bubblewrap

```bash
npm install -g @bubblewrap/cli
```

### 2. Initialise the project

```bash
mkdir formlens-twa && cd formlens-twa
bubblewrap init --manifest=https://<your-vercel-domain>/manifest.webmanifest
```

Bubblewrap will read the web manifest and prompt you for:

| Prompt | Recommended value |
|---|---|
| Application ID | `dev.formlens.app` |
| App version | `1` |
| Display mode | `standalone` |
| Start URL | `/` |

### 3. Generate a signing keystore (first time only)

```bash
keytool -genkeypair \
  -v \
  -keystore formlens-release.keystore \
  -alias formlens \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass <KEYSTORE_PASSWORD> \
  -keypass <KEY_PASSWORD> \
  -dname "CN=FormLens, OU=SML Labs, O=SML Labs, L=Bangalore, S=Karnataka, C=IN"
```

> [!CAUTION]
> **Never commit the `.keystore` file or passwords to git.**
> Add `*.keystore` to `.gitignore`.
> Back up the keystore in a secure location (password manager, encrypted drive).
> You cannot re-sign an app with a different key — losing it means losing the ability to push updates.

### 4. Get the SHA-256 fingerprint

```bash
keytool -list -v -keystore formlens-release.keystore -alias formlens \
  | grep "SHA256:"
```

Copy the colon-separated fingerprint (e.g. `AB:CD:EF:...`) and paste it into
`public/.well-known/assetlinks.json` replacing the TODO placeholder. Then redeploy to Vercel so
the file is live at `https://<your-vercel-domain>/.well-known/assetlinks.json`.

### 5. Build the APK

```bash
bubblewrap build
```

The signed APK will be at `./app-release-signed.apk`.

### 6. Test on a device

```bash
adb install app-release-signed.apk
```

Open the app. If assetlinks.json is correct and deployed, the browser chrome will be hidden
(full TWA mode). If not, it will show as a Chrome Custom Tab with the URL bar visible.

---

## Option B — PWABuilder (no local Android SDK required)

1. Go to <https://www.pwabuilder.com/>
2. Enter your Vercel URL
3. Click **Package for Stores → Android**
4. Download the APK and the `assetlinks.json` snippet
5. Update `public/.well-known/assetlinks.json` with the generated fingerprint
6. Redeploy to Vercel

---

## Distributing the APK

Host the APK on GitHub Releases (not in the git repo — binary files should not be committed):

```bash
gh release create v1.0.0 app-release-signed.apk \
  --title "FormLens v1.0.0" \
  --notes "Initial Android APK release"
```

The `/download` route in FormLens links to this release URL. Update `src/routes/install.tsx`
with the actual GitHub Releases URL after uploading.

---

## Files to add to `.gitignore`

```
*.keystore
*.jks
twa/formlens-twa/
```

---

## Verifying the Digital Asset Link

After deploying, check that the link is accessible and correct:

```bash
curl https://<your-vercel-domain>/.well-known/assetlinks.json
```

Google's validator: <https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<your-vercel-domain>&relation=delegate_permission/common.handle_all_urls>

