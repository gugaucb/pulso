import { useEffect, useRef, useState } from 'react';
import {
  Check,
  LayoutGrid,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import type { CallLayout } from '../../domain/types';
import { useI18n } from '../../i18n';
import { getInitials } from '../../utils/formatters';
import { MediaVideoElement } from './MediaVideoElement';

interface VideoCallStageProps {
  layout: CallLayout;
  localName: string;
  remoteName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  remoteInCall: boolean;
  remoteMicMuted: boolean;
  remoteCameraOff: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onEndCall: () => void;
  onChangeLayout: (layout: CallLayout) => void;
}

export function VideoCallStage({
  layout,
  localName,
  remoteName,
  localStream,
  remoteStream,
  micEnabled,
  cameraEnabled,
  screenSharing,
  remoteInCall,
  remoteMicMuted,
  remoteCameraOff,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onEndCall,
  onChangeLayout,
}: VideoCallStageProps) {
  const { t } = useI18n();
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!layoutMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        layoutMenuRef.current &&
        !layoutMenuRef.current.contains(event.target as Node)
      ) {
        setLayoutMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLayoutMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [layoutMenuOpen]);

  const isPip = layout === 'pip';
  const isFocus = layout === 'focus';

  const containerClass = isPip
    ? 'fixed bottom-20 right-4 z-30 w-64 sm:w-80 aspect-video rounded-2xl overflow-hidden bg-[#141522] border border-slate-700/80 shadow-2xl'
    : isFocus
      ? 'relative flex-1 min-h-0 min-w-0 rounded-2xl overflow-hidden bg-[#141522] border border-slate-800/80 shadow-lg m-3 sm:m-4'
      : 'relative shrink-0 h-[44%] min-h-[230px] max-h-[420px] rounded-2xl overflow-hidden bg-[#141522] border border-slate-800/80 shadow-md mx-3 sm:mx-5 mt-3';

  const layoutOptions: { id: CallLayout; label: string }[] = [
    { id: 'hybrid', label: t.videoCall.layoutHybrid },
    { id: 'pip', label: t.videoCall.layoutPip },
    { id: 'focus', label: t.videoCall.layoutFocus },
  ];

  const showRemoteVideo = remoteInCall && !remoteCameraOff && Boolean(remoteStream);

  return (
    <section
      aria-label={t.videoCall.startCall}
      data-call-layout={layout}
      className={containerClass}
    >
      {/* Remote video feed */}
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#161828] via-[#1C2035] to-[#121420]">
        {showRemoteVideo ? (
          <MediaVideoElement
            stream={remoteStream}
            label={remoteName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
            <span
              className={`inline-flex items-center justify-center rounded-full bg-[#6344F5] font-bold text-white shadow-md ${
                isPip ? 'h-10 w-10 text-xs' : 'h-16 w-16 text-lg'
              }`}
              aria-hidden="true"
            >
              {getInitials(remoteName)}
            </span>
            <p className={`font-semibold text-white ${isPip ? 'text-xs' : 'text-sm'}`}>
              {remoteName}
            </p>
            {!isPip && (
              <p className="text-xs text-slate-300">
                {remoteInCall
                  ? remoteCameraOff
                    ? t.videoCall.remoteCameraOffLabel
                    : t.videoCall.youWithCameraOn
                  : t.videoCall.waitingRemoteVideo}
              </p>
            )}
            {remoteInCall && remoteMicMuted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                <MicOff className="h-3 w-3" aria-hidden="true" />
                <span>{t.videoCall.remoteMutedBadge}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top-left local camera/screen pill */}
      {!isPip && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          {screenSharing ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-950/75 backdrop-blur-md border border-indigo-400/40 px-3 py-1.5 text-xs font-medium text-indigo-200">
              <span className="h-2 w-2 rounded-full bg-indigo-400" aria-hidden="true" />
              <span>{t.videoCall.screenSharingBadge}</span>
            </span>
          ) : cameraEnabled ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-950/75 backdrop-blur-md border border-emerald-400/30 px-3 py-1.5 text-xs font-medium text-white">
              <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
              <span>{t.videoCall.youWithCameraOn}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-950/75 backdrop-blur-md border border-slate-600/50 px-3 py-1.5 text-xs font-medium text-slate-300">
              <VideoOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>{t.videoCall.youWithCameraOff}</span>
            </span>
          )}
        </div>
      )}

      {/* Top-right local preview mini-PiP */}
      <div
        className={`absolute top-2.5 right-2.5 z-10 overflow-hidden rounded-xl border border-white/20 bg-[#1B1D2C] shadow-lg flex items-center justify-center ${
          isPip ? 'w-16 h-11' : 'w-28 sm:w-36 aspect-video'
        }`}
      >
        {cameraEnabled || screenSharing ? (
          <>
            <MediaVideoElement
              stream={localStream}
              muted
              label={localName}
              className="h-full w-full object-cover"
            />
            {!localStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#282B42] to-[#1A1C2A]">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#3B82F6] text-[11px] font-bold text-white">
                  {getInitials(localName)}
                </span>
              </div>
            )}
          </>
        ) : (
          <VideoOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
        )}
      </div>

      {/* Bottom-center 5 floating controls */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center rounded-full bg-slate-950/80 backdrop-blur-md border border-white/10 shadow-xl ${
          isPip ? 'bottom-2 gap-1.5 px-2.5 py-1.5' : 'bottom-3 gap-2.5 px-3.5 py-2'
        }`}
      >
        <button
          type="button"
          onClick={onToggleMic}
          aria-label={micEnabled ? t.videoCall.muteMic : t.videoCall.unmuteMic}
          aria-pressed={!micEnabled}
          className={`inline-flex items-center justify-center rounded-full text-white transition cursor-pointer ${
            isPip ? 'h-7 w-7' : 'h-9 w-9'
          } ${
            micEnabled
              ? 'bg-slate-700/80 hover:bg-slate-600'
              : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {micEnabled ? (
            <Mic className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          ) : (
            <MicOff className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCamera}
          aria-label={cameraEnabled ? t.videoCall.disableCamera : t.videoCall.enableCamera}
          aria-pressed={!cameraEnabled}
          className={`inline-flex items-center justify-center rounded-full text-white transition cursor-pointer ${
            isPip ? 'h-7 w-7' : 'h-9 w-9'
          } ${
            cameraEnabled
              ? 'bg-slate-700/80 hover:bg-slate-600'
              : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {cameraEnabled ? (
            <Video className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          ) : (
            <VideoOff className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleScreenShare}
          aria-label={screenSharing ? t.videoCall.stopScreenShare : t.videoCall.shareScreen}
          aria-pressed={screenSharing}
          className={`inline-flex items-center justify-center rounded-full text-white transition cursor-pointer ${
            isPip ? 'h-7 w-7' : 'h-9 w-9'
          } ${
            screenSharing
              ? 'bg-[#5B3DF5] hover:bg-[#4E32D9]'
              : 'bg-slate-700/80 hover:bg-slate-600'
          }`}
        >
          <MonitorUp className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onEndCall}
          aria-label={t.videoCall.endCall}
          className={`inline-flex items-center justify-center rounded-full bg-[#EF4444] hover:bg-red-600 text-white transition cursor-pointer ${
            isPip ? 'h-7 w-7' : 'h-9 w-9'
          }`}
        >
          <PhoneOff className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
        </button>

        <div className="relative" ref={layoutMenuRef}>
          <button
            type="button"
            onClick={() => setLayoutMenuOpen((prev) => !prev)}
            aria-label={t.videoCall.switchLayout}
            aria-haspopup="menu"
            aria-expanded={layoutMenuOpen}
            className={`inline-flex items-center justify-center rounded-full bg-slate-700/80 hover:bg-slate-600 text-white transition cursor-pointer ${
              isPip ? 'h-7 w-7' : 'h-9 w-9'
            }`}
          >
            <LayoutGrid className={isPip ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          </button>

          {layoutMenuOpen && (
            <div
              role="menu"
              aria-label={t.videoCall.switchLayout}
              className="absolute bottom-full right-0 mb-2 w-48 rounded-xl border border-slate-700 bg-[#1B1D2C] shadow-2xl py-1.5 z-30"
            >
              {layoutOptions.map((option) => {
                const selected = layout === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      onChangeLayout(option.id);
                      setLayoutMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-[#2B2F45] transition cursor-pointer text-left"
                  >
                    <span>{option.label}</span>
                    {selected && (
                      <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
