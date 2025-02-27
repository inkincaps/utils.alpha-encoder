import { useEffect, useState } from "react";
import { Command } from '@tauri-apps/plugin-shell';
import "./App.css";
import PixelCard from "./components/PixelCard/PixelCard";
import { FileDown } from "lucide-react";
import SplashCursor from "./components/SplashCursor/SplashCursor";
interface DroppedFile {
  name: string;
  path: string;
}

function App() {
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  useEffect( () => {
    ( async () => {
      setTimeout(async() => {
        const command = Command.sidecar('binaries/ffmpeg', ["-version"]);
  const output = await command.execute();
  console.log("ro",output);
      }, 1000);
      
  
   // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
  //  unlisten();
 } )()
  
 }, [])
 
  const handleFilesDrop = async (droppedFiles: File[]) => {
    // Convert dropped files to our internal format with paths
    const tauriFiles = droppedFiles.map(file => ({
      name: file.name,
      path: (file as any).path // Tauri adds the path property to the File object
    }));
    console.log(droppedFiles)
    setFiles(tauriFiles);
    
    try {
      setProcessing(true);
      
      // // We'll need to implement this Rust command in src-tauri/src/main.rs
      // await invoke("process_video", {
      //   filePaths: tauriFiles.map(f => f.path)
      // });
      
      setProcessing(false);
    } catch (error) {
      console.error("Error processing files:", error);
      setProcessing(false);
    }
  };
  return (
    <main className="min-h-screen bg-[#09090b] text-white p-0">
     {files.length ==0  &&  <SplashCursor/>}
      <PixelCard
        variant="pink"
        // speed={1000}
        gap={80}
        className="w-screen rounded-none h-screen "
        onFilesDrop={handleFilesDrop}
      >
        <div className="absolute inset-0 flex flex-col  items-center justify-center gap-4">
          <FileDown className="w-12 h-12" />
          <p className="text-lg">
            {processing
              ? "Processing..."
              : files.length > 0
              ? <div className="flex gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"> <path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25"/><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" className="spinner_ajPY" fill="#ffffff"/></svg>
              Processing Media
              </div >
              : "Drop your files here"}
          </p>
          {/* {files.length} file(s) */}
          {files.length > 0 && (
            <div className="mt-4 text-sm opacity-75 max-h-60 overflow-auto">
              {files.map(file => (
                <div key={file.path}>{file.name}</div>
              ))}
            </div>
          )}
        </div>
      </PixelCard>
    </main>
  );
}

export default App;
