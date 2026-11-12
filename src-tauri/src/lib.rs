use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Output targets. The FFmpeg arguments live here rather than in the webview,
/// so the frontend can only ask for one of these presets, never run arbitrary
/// FFmpeg arguments.
#[derive(Clone, Copy, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Preset {
    /// HEVC + alpha in MP4, tagged hvc1, for Safari / iOS.
    Safari,
    /// VP9 (+ alpha when the source has it) in WebM, for Chrome / Firefox / Android.
    Chrome,
}

impl Preset {
    fn suffix(self) -> &'static str {
        match self {
            Preset::Safari => "-safari.mp4",
            Preset::Chrome => "-chrome.webm",
        }
    }

    fn codec_args(self) -> &'static [&'static str] {
        match self {
            // macOS: Apple's VideoToolbox encoder writes HEVC-with-alpha natively
            // (hardware-accelerated, falls back to software with allow_sw). It's
            // also the exact flavour Safari is built to play.
            #[cfg(target_os = "macos")]
            Preset::Safari => &[
                "-c:v", "hevc_videotoolbox",
                "-allow_sw", "1",
                "-alpha_quality", "0.75",
                "-pix_fmt", "bgra",
                "-b:v", "2M",
                "-tag:v", "hvc1",
                "-c:a", "aac",
            ],
            // Windows / Linux: libx265. Needs x265 >= 4.0 built with alpha support.
            #[cfg(not(target_os = "macos"))]
            Preset::Safari => &[
                "-c:v", "libx265",
                "-pix_fmt", "yuva420p",
                "-x265-params", "alpha=1",
                "-tag:v", "hvc1",
                "-c:a", "aac",
            ],
            Preset::Chrome => &[
                "-c:v", "libvpx-vp9",
                // Required: ProRes 4444 decodes to yuva444p12le, which libvpx
                // rejects ("not widely supported") and the encode fails.
                "-pix_fmt", "yuva420p",
                "-b:v", "1M",
                "-c:a", "libopus",
            ],
        }
    }
}

/// Full FFmpeg argument list for one encode.
fn build_args(input: &Path, output: &Path, preset: Preset) -> Vec<String> {
    let mut args: Vec<String> = [
        "-hide_banner",
        "-nostdin", // never wait on an interactive prompt
        "-y",       // overwrite outputs from a previous run
        "-nostats",
        "-progress", "pipe:1", // machine-readable progress on stdout
        "-i",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(input.to_string_lossy().into_owned());
    args.extend(preset.codec_args().iter().map(|s| s.to_string()));
    args.push(output.to_string_lossy().into_owned());
    args
}

/// `/a/b/clip.final.mov` + Safari → `/a/b/clip.final-safari.mp4`.
/// Uses the real file stem, so any extension length works (or none at all).
fn output_path(input: &Path, preset: Preset) -> Result<PathBuf, String> {
    let stem = input
        .file_stem()
        .ok_or_else(|| "Input has no file name".to_string())?
        .to_string_lossy();
    // The suffix is always appended to the stem, so this can never equal the input.
    Ok(input.with_file_name(format!("{stem}{}", preset.suffix())))
}

/// Parses `HH:MM:SS.xx` into seconds.
fn parse_timestamp(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    input_path: String,
    preset: Preset,
    /// 0–100, or `None` when the duration is unknown.
    percent: Option<f64>,
}

/// Encodes `input_path` with `preset`, emitting `encode-progress` events while
/// it runs. Resolves with the output path once FFmpeg exits successfully, or
/// rejects with the tail of FFmpeg's log if it fails.
#[tauri::command]
async fn encode(app: AppHandle, input_path: String, preset: Preset) -> Result<String, String> {
    let input = PathBuf::from(&input_path);
    if !input.is_file() {
        return Err(format!("Not a file: {input_path}"));
    }
    let output = output_path(&input, preset)?;

    let args = build_args(&input, &output, preset);

    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar not found: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {e}"))?;

    let mut duration: Option<f64> = None;
    let mut log_tail: VecDeque<String> = VecDeque::with_capacity(12);
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            // `-progress pipe:1` writes key=value lines, e.g. `out_time_us=1234567`.
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(us) = line.trim().strip_prefix("out_time_us=") {
                    if let (Ok(us), Some(total)) = (us.parse::<f64>(), duration) {
                        let percent = (us / 1_000_000.0 / total * 100.0).clamp(0.0, 100.0);
                        let _ = app.emit(
                            "encode-progress",
                            ProgressPayload { input_path: input_path.clone(), preset, percent: Some(percent) },
                        );
                    }
                }
            }
            // The log goes to stderr. Grab the input duration and keep the
            // last lines so a failure can say why.
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                if duration.is_none() {
                    if let Some(rest) = line.trim_start().strip_prefix("Duration: ") {
                        duration = rest.split(',').next().and_then(parse_timestamp).filter(|d| *d > 0.0);
                    }
                }
                if !line.is_empty() {
                    if log_tail.len() == log_tail.capacity() {
                        log_tail.pop_front();
                    }
                    log_tail.push_back(line);
                }
            }
            CommandEvent::Error(err) => log_tail.push_back(err),
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    match exit_code {
        Some(0) => {
            let _ = app.emit(
                "encode-progress",
                ProgressPayload { input_path, preset, percent: Some(100.0) },
            );
            Ok(output.to_string_lossy().into_owned())
        }
        code => {
            // A failed run can leave a truncated file behind.
            let _ = std::fs::remove_file(&output);
            let tail: Vec<String> = log_tail.into_iter().collect();
            Err(format!(
                "FFmpeg exited with {}:\n{}",
                code.map_or("a signal".to_string(), |c| format!("code {c}")),
                tail.join("\n")
            ))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![encode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_names_use_real_stem() {
        let p = |s: &str, pr| output_path(Path::new(s), pr).unwrap().to_string_lossy().into_owned();
        assert_eq!(p("/v/clip.mov", Preset::Safari), "/v/clip-safari.mp4");
        assert_eq!(p("/v/clip.webm", Preset::Chrome), "/v/clip-chrome.webm");
        assert_eq!(p("/v/my.final.cut.mov", Preset::Safari), "/v/my.final.cut-safari.mp4");
        assert_eq!(p("/v/noext", Preset::Chrome), "/v/noext-chrome.webm");
    }

    #[test]
    fn never_targets_the_input_itself() {
        let p = Path::new("/v/x-chrome.webm");
        assert_ne!(output_path(p, Preset::Chrome).unwrap(), p);
    }

    /// Runs the real FFmpeg on PATH with the exact arguments the app uses,
    /// twice (the second run must overwrite, not hang), and checks both outputs.
    /// `cargo test -- --ignored` (needs ffmpeg + ffprobe installed).
    #[test]
    #[ignore]
    fn encodes_alpha_clip_end_to_end() {
        use std::process::Command;
        let dir = std::env::temp_dir().join("ghostencode-e2e");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("clip with spaces.v2.mov");
        let ok = Command::new("ffmpeg")
            .args(["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
                "color=c=black@0:s=160x120:d=1:r=25,format=rgba,geq=r=255:g=60:b=160:a='if(between(X,40,100)*between(Y,30,90),255,0)'",
                "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(ok.success(), "could not create ProRes 4444 source");

        for _pass in 0..2 {
            for preset in [Preset::Safari, Preset::Chrome] {
                let out = output_path(&src, preset).unwrap();
                let st = Command::new("ffmpeg")
                    .args(build_args(&src, &out, preset))
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .unwrap();
                assert!(st.success(), "{} failed", out.display());
                assert!(std::fs::metadata(&out).unwrap().len() > 0);
            }
        }
        // Decoding the alpha plane must show transparent *and* opaque pixels.
        for preset in [Preset::Safari, Preset::Chrome] {
            let out = output_path(&src, preset).unwrap();
            let mut cmd = Command::new("ffmpeg");
            cmd.args(["-v", "error", "-nostdin"]);
            if matches!(preset, Preset::Chrome) {
                cmd.args(["-c:v", "libvpx-vp9"]); // the native vp9 decoder drops alpha
            }
            let raw = cmd
                .arg("-i").arg(&out)
                .args(["-vf", "format=yuva420p,alphaextract", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
                .output()
                .unwrap()
                .stdout;
            assert!(!raw.is_empty(), "no frame decoded from {}", out.display());
            let opaque = raw.iter().filter(|&&p| p > 200).count() as f64 / raw.len() as f64;
            assert!((0.1..0.3).contains(&opaque), "{}: opaque share {opaque}", out.display());
        }
    }

    #[test]
    fn parses_ffmpeg_timestamps() {
        assert_eq!(parse_timestamp("00:01:02.50"), Some(62.5));
        assert_eq!(parse_timestamp("N/A"), None);
    }
}
