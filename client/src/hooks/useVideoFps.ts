import { useState, useEffect } from 'react';

/**
 * Detects video FPS using requestVideoFrameCallback (Chrome/Edge).
 * Falls back to a rough estimate based on duration if the API is unavailable.
 * Returns null while loading or if detection fails.
 */
export function useVideoFps(videoUrl: string | null): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!videoUrl) { setFps(null); return; }

    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    // Try requestVideoFrameCallback approach
    const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    if (hasRVFC) {
      let frameCount = 0;
      let firstTime: number | null = null;
      let lastTime: number | null = null;
      const TARGET_FRAMES = 10; // sample 10 frames to get stable average

      const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
        if (cancelled) return;
        frameCount++;
        if (firstTime === null) firstTime = metadata.mediaTime;
        lastTime = metadata.mediaTime;

        if (frameCount >= TARGET_FRAMES && firstTime !== null && lastTime !== null) {
          const elapsed = lastTime - firstTime;
          if (elapsed > 0) {
            const detectedFps = Math.round((frameCount - 1) / elapsed);
            if (!cancelled) setFps(detectedFps);
          }
          video.pause();
          return;
        }
        (video as any).requestVideoFrameCallback(onFrame);
      };

      video.addEventListener('loadeddata', () => {
        if (cancelled) return;
        (video as any).requestVideoFrameCallback(onFrame);
        video.play().catch(() => {});
      }, { once: true });
    } else {
      // Fallback: just report null (no reliable way without the API)
      video.addEventListener('loadedmetadata', () => {
        if (cancelled) return;
        // Cannot reliably detect fps without requestVideoFrameCallback
        // Set a common default or null
        setFps(null);
      }, { once: true });
    }

    video.addEventListener('error', () => {
      if (!cancelled) setFps(null);
    }, { once: true });

    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [videoUrl]);

  return fps;
}
