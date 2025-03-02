import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "./App.css";
import loading from "./assets/loading.json";
import { listen } from '@tauri-apps/api/event';
import PixelCard from "./components/PixelCard/PixelCard";
import { FileDown } from "lucide-react";
import SplashCursor from "./components/SplashCursor/SplashCursor";

import { invoke } from '@tauri-apps/api/core';
import { generalLoadingMessages } from "./utils/progress-copy";
import Lottie from "lottie-react";
import SuccessAnimation from "./components/success";

interface DroppedFile {
  name: string;
  path: string;
}

function App() {
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [processing, setProcessing] = useState<"unprocessed" | "processing" | "processed">('unprocessed');
  let randomIndex = Math.floor(Math.random() * generalLoadingMessages.length);
  const [processingCopy, setProcessingCopy] = useState(generalLoadingMessages[randomIndex]);

  useEffect(() => {
    if (processing == "processing") {
      const interval = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * generalLoadingMessages.length);
        setProcessingCopy(generalLoadingMessages[randomIndex]);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [processing])

  listen('ffmpeg-output', (event: any) => {
    console.log('FFmpeg output:', event.payload.line);
  });

  listen('ffmpeg-error', (event: any) => {
    console.log('FFmpeg output:', event.payload.line);
  });

  listen('ffmpeg-terminated', (event: any) => {
    console.log('Processing completed with code:', event);
    setProcessing("processed");
  });

  useEffect(() => {
    (async () => {
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
        } else if (event.payload.type === 'drop') {
          setProcessing("processing");
          const tauriFiles = event.payload.paths.map((file) => ({
            name: file.split(/[/\\]/).pop() || 'unnamed file',
            path: file
          }));
          setFiles(tauriFiles);
          // invoke('process_ffmpeg', { inputPath: tauriFiles[0].path, args: ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus', tauriFiles[0].path.substring(0, tauriFiles[0].path.length - 4) + "-chrome.webm"] });
          invoke('process_ffmpeg', { inputPath: tauriFiles[0].path, args: ['-c:v', 'libx265', '-pix_fmt', 'yuva420p', '-x265-params', 'alpha=1', '-tag:v', 'hvc1', tauriFiles[0].path.substring(0, tauriFiles[0].path.length - 4) + "-safari.mp4"] });
          console.log('User dropped', event.payload.paths);
        } else {
          console.log('File drop cancelled');
        }
      });
      return () => unlisten();
    })()
  }, [])


  return (
    <main className="min-h-screen   text-white p-0">
      {files.length == 0 && <SplashCursor />}
      <PixelCard
        variant="pink"
        // speed={1000}
        gap={70}
        className="w-screen rounded-none h-screen "
        active={processing == "processing"}
      >
        <div className="absolute inset-0 flex flex-col  items-center justify-center gap-4">
          {processing == "processing" &&
            <Lottie id="loading-anim" animationData={loading} color="#ffffff" width={60} height={60} />
          }
          {processing == "processed" && <SuccessAnimation />}
          {processing == "unprocessed" && <FileDown className="w-12 h-12" />}
          <p className="text-lg">
            {processing === "unprocessed" && "Drop your files here"}
            {processing === "processing" && (
              <div className="flex gap-2">
                {/* <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25" />
                  <path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" className="spinner_ajPY" fill="#ffffff" />
                </svg> */}
                Processing Media
              </div>
            )}
            {processing === "processed" && "Processing Complete"}
          </p>


          {/* {files.length} file(s) */}
          {processing == "processing" && files.length > 0 && (
            <div className="mt-4 text-sm opacity-75 max-h-60 overflow-auto mx-auto w-[90%]">
              {files.map(file => (
                <div title={file.name} className="max-w-2/3 text-center mx-auto overflow-ellipsis whitespace-nowrap overflow-hidden" key={file.path}>{file.name}</div>
              ))}
            </div>
          )}
          {processing == "processing" && <p className="text-sm text-center opacity-75 text-yellow-500">{processingCopy}</p>}
        </div>
      </PixelCard>
    </main>
  );
}

export default App;
