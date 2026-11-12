<div align="center">

# Ghostencode · `utils.alpha-encoder`

**Drag-and-drop desktop app that turns one transparent video into web-ready files for Safari *and* Chrome.**

Drop a ProRes 4444 (or any alpha-channel) video on the window and get an HEVC-with-alpha `.mp4` for Apple devices and a VP9-with-alpha `.webm` for everything else. FFmpeg ships inside the app, so there's no command line.

▶️ **[Watch the demo](demo/demo.mp4)**

</div>

---

## Contents

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [Using the outputs on the web](#using-the-outputs-on-the-web)
- [Quick start (development)](#quick-start-development)
- [Bundling FFmpeg](#bundling-ffmpeg)
- [Building installers](#building-installers)
- [How it works](#how-it-works)
- [Encoding settings](#encoding-settings)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Credits](#credits)

---

## The problem

Transparent video on the web (animated stickers, product spins, UI overlays, mascots) has no single format that works in every browser:

| Browser | Transparent video it plays |
| --- | --- |
| Safari (macOS / iOS / iPadOS) | **HEVC (H.265) with alpha** in `.mp4` / `.mov`, tagged `hvc1` |
| Chrome, Edge, Firefox, Android | **VP9 with alpha** in `.webm` |

Designers usually export **ProRes 4444** from After Effects, Premiere, Final Cut or Rive. Getting from there to both web formats means two long FFmpeg commands with flags most people don't remember. Ghostencode turns that into dropping a file on a window.

## What it does

1. You drop a video on the window.
2. The app runs the bundled FFmpeg **twice**, one encode after the other:
   - `<name>-safari.mp4`: HEVC with an alpha layer (`libx265`, `yuva420p`, `alpha=1`, tag `hvc1`)
   - `<name>-chrome.webm`: VP9 at 1 Mbps with Opus audio (`libvpx-vp9`, `libopus`). Alpha carries over automatically when the source has one.
3. Both files are written **next to the original**.
4. While it works you get a pixel-shimmer background, a loading animation and rotating messages like *"Negotiating peace talks between competing codecs…"*. A check mark shows when both files are done, then the window resets for the next drop.

Everything runs locally. Nothing is uploaded.

## Using the outputs on the web

List the HEVC source **first**. Safari picks it, and other browsers skip it (they can't play `hvc1` with alpha) and fall back to the WebM:

```html
<video autoplay loop muted playsinline>
  <source src="/media/mascot-safari.mp4" type='video/mp4; codecs="hvc1"' />
  <source src="/media/mascot-chrome.webm" type="video/webm" />
</video>
```

React / Next.js:

```tsx
export function AlphaVideo({ name }: { name: string }) {
  return (
    <video autoPlay loop muted playsInline>
      <source src={`/media/${name}-safari.mp4`} type='video/mp4; codecs="hvc1"' />
      <source src={`/media/${name}-chrome.webm`} type="video/webm" />
    </video>
  );
}
```

> `muted` + `playsinline` are required for autoplay on iOS.

## Quick start (development)

### Prerequisites

- **Node.js 18+** and npm
- **Rust** (stable), installed with [rustup](https://rustup.rs)
- The **Tauri 2 platform prerequisites** for your OS: Xcode Command Line Tools on macOS, WebView2 + MSVC Build Tools on Windows, `webkit2gtk` and related libraries on Linux. See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).
- An **FFmpeg binary for your platform** in `src-tauri/binaries/` (see [Bundling FFmpeg](#bundling-ffmpeg)). The repo ships only the Windows x64 build.

### Run

```bash
git clone https://github.com/inkincaps/utils.alpha-encoder.git
cd utils.alpha-encoder
npm install
npm run tauri dev
```

This starts Vite on `http://localhost:1420` and opens the native window with hot reload. `npm run dev` on its own serves just the web UI in a browser, but file drops and encoding only work inside the Tauri window.

## Bundling FFmpeg

FFmpeg is a [Tauri sidecar](https://v2.tauri.app/develop/sidecar/). `tauri.conf.json` declares:

```json
"bundle": { "externalBin": ["binaries/ffmpeg"] }
```

At build time Tauri looks for `src-tauri/binaries/ffmpeg-<target-triple>[.exe]`. Find your target triple with:

```bash
rustc -vV | grep host
```

| Platform | Expected file name |
| --- | --- |
| Windows x64 | `ffmpeg-x86_64-pc-windows-msvc.exe` *(included)* |
| macOS Apple Silicon | `ffmpeg-aarch64-apple-darwin` |
| macOS Intel | `ffmpeg-x86_64-apple-darwin` |
| Linux x64 | `ffmpeg-x86_64-unknown-linux-gnu` |

Example for an Apple Silicon Mac, using a static build or Homebrew's binary:

```bash
cp "$(which ffmpeg)" src-tauri/binaries/ffmpeg-aarch64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

**Your FFmpeg must include:**

- `libx265` built from **x265 4.0 or newer**. Alpha-channel HEVC (`-x265-params alpha=1`) arrived in x265 4.0 and FFmpeg 7.1. Older builds fail on the Safari encode.
- `libvpx` (VP9) and `libopus`.

Check with `ffmpeg -hide_banner -encoders | grep -E "libx265|libvpx-vp9|libopus"`.

> **Licensing note:** `libx265` is GPL. If you distribute installers that bundle a GPL build of FFmpeg, you take on GPL obligations for that binary.

The sidecar is allow-listed in `src-tauri/capabilities/default.json` (`shell:allow-execute` with `sidecar: true`), so the webview can run **only** this one bundled binary, not arbitrary commands.

## Building installers

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/`: `.dmg` / `.app` on macOS, `.msi` / `.exe` (NSIS) on Windows, `.deb` / `.AppImage` / `.rpm` on Linux. The Windows installer downloads the WebView2 bootstrapper if it's missing (`webviewInstallMode: downloadBootstrapper`).

Builds only target the OS you build on, and the matching FFmpeg sidecar must be present. Use CI (e.g. [`tauri-action`](https://github.com/tauri-apps/tauri-action)) to produce all three.

## How it works

```
┌─────────────────────────── React (webview) ───────────────────────────┐
│ onDragDropEvent ─► invoke("process_ffmpeg", {inputPath, args: HEVC})  │
│ listen("ffmpeg-terminated") ─► processed++                            │
│   processed == 1 ─► invoke("process_ffmpeg", {…, args: VP9})          │
│   processed == 2 ─► show ✓, reset after 3 s                           │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ Tauri IPC
┌──────────────────────────────────▼────────────── Rust (src-tauri) ────┐
│ #[tauri::command] process_ffmpeg                                      │
│   shell().sidecar("ffmpeg").args(["-i", input, …args]).spawn()        │
│   async task streams CommandEvent:                                    │
│     Stdout     ─► emit("ffmpeg-output")                               │
│     Stderr     ─► emit("ffmpeg-error")     (FFmpeg logs to stderr)    │
│     Error      ─► emit("ffmpeg-process-error")                        │
│     Terminated ─► emit("ffmpeg-terminated", exit code)                │
└───────────────────────────────────────────────────────────────────────┘
```

- **Drag and drop** uses Tauri's native `getCurrentWebview().onDragDropEvent`, which gives real filesystem paths (an HTML drop event can't).
- **`process_ffmpeg`** (in `src-tauri/src/lib.rs`) puts `-i <input>` in front of the args it receives, starts the sidecar, and returns straight away. Progress comes back as events, so the UI never blocks.
- The frontend runs the **two encodes in sequence** by counting `ffmpeg-terminated` events.

## Encoding settings

The exact arguments passed to FFmpeg (after `-i <input>`):

**Safari (HEVC + alpha) → `<name>-safari.mp4`**

```
-c:v libx265 -pix_fmt yuva420p -x265-params alpha=1 -tag:v hvc1 <name>-safari.mp4
```

| Flag | Why |
| --- | --- |
| `-c:v libx265` | H.265 / HEVC encoder |
| `-pix_fmt yuva420p` | 4:2:0 chroma **plus an alpha plane** |
| `-x265-params alpha=1` | Encode the alpha plane as an HEVC auxiliary layer |
| `-tag:v hvc1` | Apple players require the `hvc1` tag (not `hev1`) |

**Chrome / Firefox / Android (VP9) → `<name>-chrome.webm`**

```
-c:v libvpx-vp9 -b:v 1M -c:a libopus <name>-chrome.webm
```

| Flag | Why |
| --- | --- |
| `-c:v libvpx-vp9` | VP9 encoder. Picks `yuva420p` automatically when the source has alpha. |
| `-b:v 1M` | Target 1 Mbps. Good for UI-sized clips; raise it for full-screen footage. |
| `-c:a libopus` | WebM-compatible audio |

To change quality, edit the `args` arrays in `src/App.tsx`. For example, use `-crf 30 -b:v 0` for constant-quality VP9.

## Project structure

```
utils.alpha-encoder/
├── demo/demo.mp4                 # screen recording of the app
├── index.html
├── src/                          # React frontend
│   ├── App.tsx                   # drop handling, encode pipeline, UI states
│   ├── App.css / index.css       # Tailwind v4 entry + styles
│   ├── assets/loading.json       # Lottie loading animation
│   ├── components/
│   │   ├── PixelCard/            # animated pixel shimmer background
│   │   ├── SplashCursor/         # WebGL fluid cursor effect on the idle screen
│   │   ├── MagnetLines/, ASCIIText/  # extra effects (currently unused)
│   │   └── success.tsx           # animated check mark
│   └── utils/
│       ├── index.ts              # delay()
│       └── progress-copy.ts      # rotating loading messages
├── src-tauri/                    # Rust / Tauri backend
│   ├── src/lib.rs                # process_ffmpeg command + event streaming
│   ├── src/main.rs               # entry point
│   ├── binaries/                 # FFmpeg sidecars (ffmpeg-<target-triple>)
│   ├── capabilities/default.json # permissions: sidecar-only shell access
│   ├── icons/                    # app icons for every platform
│   ├── Cargo.toml
│   └── tauri.conf.json           # window (500×380, fixed size), bundle, sidecar config
└── vite.config.ts                # fixed port 1420 for Tauri
```

## Tech stack

- **Tauri 2** (Rust) with `tauri-plugin-shell` (sidecar) and `tauri-plugin-opener`
- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- **three.js** / WebGL for the cursor and ASCII effects, **lottie-react** for the loader, **lucide-react** icons
- **FFmpeg** with `libx265`, `libvpx-vp9`, `libopus`

## Known limitations

This is an early utility (v0.1.0). Things to know before relying on it:

- **One file per drop.** Only the first dropped file is encoded. Others are listed but ignored.
- **Output names assume a 4-character extension** such as `.mov` or `.mp4`. `clip.mov` becomes `clip-safari.mp4`, but `clip.webm` would become `clip.-safari.mp4`.
- **Existing outputs aren't overwritten.** FFmpeg runs without `-y`, so if `<name>-safari.mp4` already exists it waits for a confirmation that never comes and the app stays on "Processing". Delete or rename old outputs first.
- **Errors aren't shown in the UI.** FFmpeg output is only logged to the devtools console. A failed encode still counts as "finished".
- **No progress percentage**: just the animation and messages.
- **Only the Windows FFmpeg binary is committed.** macOS and Linux need you to add one.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `tauri dev` fails with *"resource path `binaries/ffmpeg-<triple>` doesn't exist"* | Add the FFmpeg sidecar for your platform (see [Bundling FFmpeg](#bundling-ffmpeg)). |
| Stuck on "Processing Media" forever | An output file already exists (see limitations), or FFmpeg failed. Open devtools (right-click → Inspect in dev builds) and check the `ffmpeg-error` logs. |
| Safari output has a black background | FFmpeg/x265 is too old for `alpha=1` (needs x265 ≥ 4.0), or the source has no alpha channel. Check with `ffprobe` that the input `pix_fmt` contains an `a`, e.g. `yuva444p12le`. |
| WebM isn't transparent | The source has no alpha, or your FFmpeg's libvpx was built without alpha support. |
| macOS: "ffmpeg can't be opened because Apple cannot check it" | Clear quarantine: `xattr -d com.apple.quarantine src-tauri/binaries/ffmpeg-*`. |
| Port 1420 already in use | Another Vite/Tauri dev server is running. Stop it, or change the port in both `vite.config.ts` and `tauri.conf.json`. |

## Roadmap

- Batch queue for multiple files, with per-file status
- Real progress bar (parse FFmpeg `time=` / use `-progress pipe:1`)
- Surface FFmpeg errors and non-zero exit codes in the UI
- Quality presets (Small / Balanced / High) and an optional output folder
- Overwrite prompt (`-y` / `-n`) and safe output naming for any extension
- Signed macOS / Windows release builds through GitHub Actions

## Contributing

1. Fork, then `git checkout -b feat/my-change`
2. `npm install && npm run tauri dev`
3. Keep the Rust side building (`cargo check` in `src-tauri/`) and the TypeScript side compiling (`npm run build`).
4. Test with a real alpha-channel clip, and confirm transparency in both Safari and Chrome.
5. Open a PR with a short description, and a screen recording for UI changes.

## Credits

- Built by [Inkincaps](https://github.com/inkincaps).
- Visual effects (PixelCard, SplashCursor, MagnetLines, ASCIIText) are adapted from community React effect components. SplashCursor is based on WebGL fluid simulation techniques.
- Powered by [FFmpeg](https://ffmpeg.org), [x265](https://www.videolan.org/developers/x265.html) and [libvpx](https://chromium.googlesource.com/webm/libvpx).
