use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::Emitter;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .invoke_handler(tauri::generate_handler![process_ffmpeg])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
#[tauri::command]
async fn process_ffmpeg(app_handle: tauri::AppHandle, input_path: String,   args: Vec<String>)->Result<(), String>   {
  println!("Processing file: {}", input_path);
  let mut sidecar_command = app_handle.shell().sidecar("ffmpeg").unwrap();
  
    let mut command_args = Vec::new();
    command_args.push("-i".to_string());
    command_args.push(input_path.clone());   
    command_args.extend(args.clone());  
    
  sidecar_command = sidecar_command.args(command_args);
  
  let (mut rx,  _child) = match sidecar_command.spawn() {
      Ok((rx, child)) => (rx, child),
      Err(e) => return Err(format!("Failed to spawn FFmpeg: {}", e)),
  };
  
  println!("FFmpeg process started");
  tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
          match event {
              CommandEvent::Stdout(line_bytes) => {
                  let line = String::from_utf8_lossy(&line_bytes);
                  println!("FFmpeg stdout: {}", line);
                  
                  // Emit event to frontend if needed
                  app_handle
                      .emit("ffmpeg-output", line.to_string())
                      .expect("Failed to emit event");
              },
              CommandEvent::Stderr(line_bytes) => {
                  let line = String::from_utf8_lossy(&line_bytes);
                  println!("FFmpeg stderr: {}", line);
                  
                  // Emit error to frontend if needed
                  app_handle
                      .emit("ffmpeg-error", line.to_string())
                      .expect("Failed to emit event");
              },
              CommandEvent::Error(err) => {
                  println!("FFmpeg process error: {}", err);
                  app_handle
                      .emit("ffmpeg-process-error", err)
                      .expect("Failed to emit event");
              },
              CommandEvent::Terminated(exit_code) => {
                  // println!("FFmpeg process terminated with code: {}", exit_code);
                  app_handle
                      .emit("ffmpeg-terminated", exit_code)
                      .expect("Failed to emit event");
              },
              _ => {}
          }
      }
      
      println!("FFmpeg process and event handling completed");
  });
  
  Ok(())
}


 

 


