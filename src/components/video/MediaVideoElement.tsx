import { useEffect, useRef } from 'react';

interface MediaVideoElementProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  label: string;
}

export function MediaVideoElement({
  stream,
  muted = false,
  className = '',
  label,
}: MediaVideoElementProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if ('srcObject' in el) {
      el.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      aria-label={label}
      className={className}
    />
  );
}
