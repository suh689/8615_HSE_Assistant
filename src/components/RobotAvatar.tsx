import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface RobotAvatarProps {
  isPlaying: boolean;
  analyser: AnalyserNode | null;
}

export function RobotAvatar({ isPlaying, analyser }: RobotAvatarProps) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!isPlaying) {
      // Reset heights when stopped
      barRefs.current.forEach(bar => {
        if (bar) bar.style.height = '4px';
      });
      return;
    }

    let animationFrame: number;
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const updateVolume = () => {
      let hasAudioData = false;
      let volumes = [0, 0, 0, 0, 0];

      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        
        // Check if there is actual audio data flowing
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }

        if (sum > 0) {
          hasAudioData = true;
          // Sample 5 different frequency bands for the 5 mouth bars
          const v1 = (dataArray[2] + dataArray[3]) / 2 / 255;
          const v2 = (dataArray[5] + dataArray[6]) / 2 / 255;
          const v3 = (dataArray[9] + dataArray[10]) / 2 / 255;
          const v4 = (dataArray[14] + dataArray[15]) / 2 / 255;
          const v5 = (dataArray[20] + dataArray[21]) / 2 / 255;
          
          volumes = [v1, v2, v3, v4, v5];
        }
      }

      if (hasAudioData) {
        barRefs.current.forEach((bar, i) => {
          if (bar) {
            // Amplify the volume for better visual effect, cap at 24px
            const height = Math.min(24, Math.max(4, volumes[i] * 48));
            bar.style.height = `${height}px`;
          }
        });
      } else {
        // Fallback random animation if no analyser is connected or no audio data (e.g. local TTS)
        barRefs.current.forEach(bar => {
          if (bar) {
            // Smooth random movement
            const currentHeight = parseFloat(bar.style.height) || 4;
            const targetHeight = Math.max(4, Math.random() * 20 + 4);
            // Simple easing
            const newHeight = currentHeight + (targetHeight - currentHeight) * 0.25;
            bar.style.height = `${newHeight}px`;
          }
        });
      }
      
      animationFrame = requestAnimationFrame(updateVolume);
    };

    updateVolume();

    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, analyser]);

  return (
    <AnimatePresence>
      {isPlaying && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          className="absolute top-20 right-6 z-40 pointer-events-none"
        >
          {/* Robot Head Container */}
          <div className="relative w-40 h-40 bg-gradient-to-b from-[#21262d] to-[#161b22] rounded-[2rem] border-2 border-[#30363d] shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex flex-col items-center justify-center">
            
            {/* Antenna */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-2 h-6 bg-[#30363d]">
              <motion.div 
                animate={{ backgroundColor: ['#1f6feb', '#58a6ff', '#1f6feb'] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute -top-2 -left-1 w-4 h-4 rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]"
              />
            </div>

            {/* Ears */}
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-10 bg-[#30363d] rounded-l-md" />
            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-2 h-10 bg-[#30363d] rounded-r-md" />

            {/* Face Screen */}
            <div className="w-32 h-24 bg-[#010409] rounded-xl border border-[#1f6feb]/20 relative flex flex-col items-center justify-center overflow-hidden shadow-inner">
              
              {/* Scanline effect */}
              <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] pointer-events-none" />
              
              {/* Eyes */}
              <div className="flex gap-8 mb-3">
                <motion.div 
                  animate={{ scaleY: [1, 0.1, 1] }}
                  transition={{ duration: 0.15, repeat: Infinity, repeatDelay: 3.5 }}
                  className="w-6 h-6 bg-[#58a6ff] rounded-full shadow-[0_0_12px_rgba(88,166,255,0.8)]" 
                />
                <motion.div 
                  animate={{ scaleY: [1, 0.1, 1] }}
                  transition={{ duration: 0.15, repeat: Infinity, repeatDelay: 3.5 }}
                  className="w-6 h-6 bg-[#58a6ff] rounded-full shadow-[0_0_12px_rgba(88,166,255,0.8)]" 
                />
              </div>

              {/* Mouth (Audio visualizer) */}
              <div className="flex gap-1.5 items-center justify-center h-6">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    ref={el => barRefs.current[i] = el}
                    className="w-2 bg-[#58a6ff] rounded-full shadow-[0_0_8px_rgba(88,166,255,0.6)] transition-[height] duration-75 ease-out"
                    style={{ height: '4px' }}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
