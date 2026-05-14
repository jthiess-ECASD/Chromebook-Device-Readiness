# Chromebook Device Readiness PWA

A guided hardware-test PWA for Chromebook deployment, intended to live in the
login-screen waffle menu of apps. Walks a technician through:

- 🎙️ Microphone (record + playback with live waveform)
- 🔊 Speaker (left / right / both / sweep)
- 📷 Camera (live preview)
- 👆 Touchscreen (drag-fill grid, multi-touch aware)
- 🖱️ Touchpad (movement, click, right-click, two-finger scroll)
- ⌨️ Keyboard (every key lights up when pressed)
- 🔋 Battery (live charge level + charging status)
- 🎧 Headphone jack (stereo tone test)
- 🔍 Physical inspection (hinge, chassis, keycaps, etc.)

## Setup

### 1. Set the password

Open `app.js` and change the constant near the top:

```js
const DEFAULT_PASSWORD = 'deploy2026';
```

This password is required to unlock the app. It is **not security** — the file
is plain text — it just keeps students out. If you need to rotate without
redeploying, you can override on a device via DevTools console:

```js
localStorage.setItem('cdr.password', 'newpass');
```

### 2. Host the files

The whole app is static. Drop these files on any HTTPS host (Google Sites,
GitHub Pages, your district web server, an S3 bucket, etc.):

```
index.html
styles.css
app.js
manifest.webmanifest
sw.js
ECASD.png
```

PWAs require HTTPS (or `http://localhost`) for `getUserMedia`, service workers,
and the install prompt. Plain `http://` will not work.

### 3. Add to the login-screen waffle menu

In Google Admin Console:

1. Devices → Chrome → Apps & extensions → **Managed Browser** or **Kiosk &
   sign-in** scope.
2. Add by URL → paste the deployed URL of `index.html`.
3. Set "Installation policy" → **Force install** (or Allow if you want it
   installable rather than auto-pinned).
4. Under app settings, enable "Show on sign-in screen" if it appears in your
   console — this is what surfaces it in the waffle menu before login.

## Testing locally

You need a local HTTPS or localhost server. Easiest:

```sh
cd "Chromebook Device Readiness"
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Mic / camera / battery APIs all work on
localhost without a cert.

## Results

- Each test marks **Pass** / **Fail** from the top bar.
- Results are kept in `sessionStorage` so they clear when the window closes
  (one device per session). Use **Reset** or **Finish & Reset** to clear
  manually between devices.
- **View Report** shows a summary table of the current session.

## Notes / known limitations

- The Battery Status API is being phased out in some browsers; on devices
  where it's unavailable the test shows a friendly message and the technician
  can still mark pass/fail manually.
- The "two-finger scroll" detection on the touchpad fires on any wheel event,
  which is what Chrome OS reports for two-finger scrolling. Single-finger
  scroll gestures on a touchscreen would also satisfy it — that's intentional
  since the touchscreen test is separate.
- Keyboard `keydown` may be intercepted by Chrome OS for some function keys
  (brightness, volume, overview). That's expected; verify those keys' actual
  system behavior rather than relying on the green highlight.
