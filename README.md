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

1. You drop one or more videos on the window.
2. Each file is queued, and the bundled FFmpeg encodes it **twice**, one encode after the other:
   - `<name>-safari.mp4`: HEVC with an alpha layer, tagged `hvc1` (Apple VideoToolbox on macOS, `libx265` elsewhere)
   - `<name>-chrome.webm`: VP9 with alpha (`yuva420p`) at 1 Mbps, with Opus audio
3. Both files are written **next to the original**, overwriting outputs from an earlier run.
4. Each file shows a live progress bar, and you get the pixel-shimmer background plus rotating messages like *"Negotiating peace talks between competing codecs…"*.
5. When the batch is done you see how many files succeeded, FFmpeg's error for any that failed, and a folder button that reveals the outputs in Finder / Explorer. Drop more files to start again.

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

- **macOS:** `hevc_videotoolbox` (every macOS FFmpeg build has it, Homebrew's included).
- **Windows / Linux:** `libx265` from **x265 4.0 or newer, built with alpha support** (`ENABLE_ALPHA`), with FFmpeg 7.1+. Many distro builds lack this and fail with *"Loaded libx265 does not support alpha layer encoding"*.
- **Everywhere:** `libvpx` (VP9) and `libopus`.

Check with `ffmpeg -hide_banner -encoders | grep -E "hevc_videotoolbox|libx265|libvpx-vp9|libopus"`.

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
│ onDragDropEvent(drop) ─► queue = all dropped paths                    │
│ for file in queue:                                                    │
│   for preset in ["safari", "chrome"]:                                 │
│     await invoke("encode", {inputPath, preset}) ─► output path / error│
│ listen("encode-progress") ─► per-file progress bar                    │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ Tauri IPC
┌──────────────────────────────────▼────────────── Rust (src-tauri) ────┐
│ #[tauri::command] async encode(input_path, preset)                    │
│   output = <dir>/<stem>-safari.mp4 | <stem>-chrome.webm               │
│   sidecar("ffmpeg") -nostdin -y -progress pipe:1 -i input …preset     │
│   stderr "Duration: …"      ─► total length                           │
│   stdout "out_time_us=…"    ─► emit("encode-progress", percent)       │
│   Terminated(0)             ─► Ok(output)                             │
│   Terminated(≠0)            ─► delete partial file, Err(last log lines)│
└───────────────────────────────────────────────────────────────────────┘
```

- **Drag and drop** uses Tauri's native `getCurrentWebview().onDragDropEvent`, which gives real filesystem paths (an HTML drop event can't).
- **`encode`** (in `src-tauri/src/lib.rs`) is an async command that resolves only when FFmpeg exits. The webview can only pick a **preset** name; the actual FFmpeg arguments are fixed in Rust, so the UI can't be made to run arbitrary FFmpeg options.
- The frontend simply `await`s each encode in turn, so files and presets run strictly one at a time.

## Encoding settings

Every run starts with `-hide_banner -nostdin -y -nostats -progress pipe:1 -i <input>`, followed by the preset:

**Safari (HEVC + alpha) → `<name>-safari.mp4`**

macOS (Apple VideoToolbox, hardware-accelerated):

```
-c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 -pix_fmt bgra -b:v 2M -tag:v hvc1 -c:a aac
```

Windows / Linux (libx265):

```
-c:v libx265 -pix_fmt yuva420p -x265-params alpha=1 -tag:v hvc1 -c:a aac
```

| Flag | Why |
| --- | --- |
| `hevc_videotoolbox` + `-alpha_quality` | Apple's encoder writes HEVC-with-alpha natively. `allow_sw` falls back to software on Macs without an HEVC hardware encoder. |
| `-pix_fmt yuva420p` / `bgra` | Keep an **alpha plane** going into the encoder |
| `-x265-params alpha=1` | Encode alpha as an HEVC auxiliary layer (x265 ≥ 4.0 with alpha support) |
| `-tag:v hvc1` | Apple players require the `hvc1` tag (not `hev1`) |

**Chrome / Firefox / Android (VP9 + alpha) → `<name>-chrome.webm`**

```
-c:v libvpx-vp9 -pix_fmt yuva420p -b:v 1M -c:a libopus
```

| Flag | Why |
| --- | --- |
| `-pix_fmt yuva420p` | **Required for ProRes 4444.** It decodes to `yuva444p12le`, which libvpx refuses, and the encode fails. |
| `-b:v 1M` | Target 1 Mbps. Good for UI-sized clips; raise it for full-screen footage. |
| `-c:a libopus` | WebM-compatible audio |

To change quality, edit `Preset::codec_args` in `src-tauri/src/lib.rs`.

### Tests

```bash
cd src-tauri
cargo test                 # unit tests: output naming, timestamp parsing
cargo test -- --ignored    # end-to-end: real FFmpeg on PATH encodes a generated
                           # ProRes 4444 clip twice with the app's exact arguments
                           # and checks the alpha plane survives in both outputs
```

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
│   ├── src/lib.rs                # encode command, presets, progress parsing, tests
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

- **Sequential encoding.** Files are encoded one at a time (FFmpeg already uses all cores per encode).
- **Fixed quality.** There are no quality presets in the UI yet; edit `Preset::codec_args` to change them.
- **Only the Windows FFmpeg binary is committed.** macOS and Linux need you to add one (see [Bundling FFmpeg](#bundling-ffmpeg)).

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `tauri dev` fails with *"resource path `binaries/ffmpeg-<triple>` doesn't exist"* | Add the FFmpeg sidecar for your platform (see [Bundling FFmpeg](#bundling-ffmpeg)). |
| A file shows **Failed** | Hover it for FFmpeg's full message. Common causes: the input isn't a video, or the encoder is missing from your FFmpeg build. |
| *"Loaded libx265 does not support alpha layer encoding"* (Windows/Linux) | Your x265 was built without alpha. Use an FFmpeg build with x265 ≥ 4.0 and `ENABLE_ALPHA`. |
| Safari output has a black background | The source has no alpha channel. Check with `ffprobe` that the input `pix_fmt` contains an `a`, e.g. `yuva444p12le`. |
| WebM isn't transparent | The source has no alpha, or your FFmpeg's libvpx was built without alpha support. |
| macOS: "ffmpeg can't be opened because Apple cannot check it" | Clear quarantine: `xattr -d com.apple.quarantine src-tauri/binaries/ffmpeg-*`. |
| Port 1420 already in use | Another Vite/Tauri dev server is running. Stop it, or change the port in both `vite.config.ts` and `tauri.conf.json`. |

## Roadmap

- Quality presets (Small / Balanced / High) and an optional output folder
- Cancel button for a running batch
- Signed macOS / Windows release builds through GitHub Actions

## Contributing

1. Fork, then `git checkout -b feat/my-change`
2. `npm install && npm run tauri dev`
3. Keep `cargo test` (and `cargo test -- --ignored` if you touch presets) passing in `src-tauri/`, and `npm run build` compiling.
4. Test with a real alpha-channel clip, and confirm transparency in both Safari and Chrome.
5. Open a PR with a short description, and a screen recording for UI changes.

## Credits

- Built by [Inkincaps](https://github.com/inkincaps).
- Visual effects (PixelCard, SplashCursor, MagnetLines, ASCIIText) are adapted from community React effect components. SplashCursor is based on WebGL fluid simulation techniques.
- Powered by [FFmpeg](https://ffmpeg.org), [x265](https://www.videolan.org/developers/x265.html) and [libvpx](https://chromium.googlesource.com/webm/libvpx).
