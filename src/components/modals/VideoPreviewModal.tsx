import { useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { MediaDeviceOption } from '../../media/MediaPort';
import { getInitials } from '../../utils/formatters';
import { MediaVideoElement } from '../video/MediaVideoElement';

interface VideoPreviewModalProps {
  open: boolean;
  localName: string;
  localStream: MediaStream | null;
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  selectedCameraId: string | null;
  selectedMicrophoneId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  audioLevel: number;
  onSelectCamera: (deviceId: string) => void;
  onSelectMicrophone: (deviceId: string) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function VideoPreviewModal({
  open,
  localName,
  localStream,
  cameras,
  microphones,
  selectedCameraId,
  selectedMicrophoneId,
  micEnabled,
  cameraEnabled,
  audioLevel,
  onSelectCamera,
  onSelectMicrophone,
  onToggleMic,
  onToggleCamera,
  onConfirm,
  onCancel,
}: VideoPreviewModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const normalizedLevel = micEnabled ? Math.max(0, Math.min(100, audioLevel)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-preview-modal-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1E2133] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#2E3248]">
          <h2
            id="video-preview-modal-title"
            className="text-base font-semibold text-[#111827] dark:text-slate-100"
          >
            {t.videoCall.previewTitle}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t.e2ee.close}
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#2A2E45] transition cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#141522] flex items-center justify-center">
            {cameraEnabled ? (
              <>
                <MediaVideoElement
                  stream={localStream}
                  muted
                  label={t.videoCall.youWithCameraOn}
                  className="h-full w-full object-cover"
                />
                {!localStream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1B1D2C] to-[#282B42]">
                    <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#5B3DF5] text-lg font-bold text-white">
                      {getInitials(localName)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-3 py-1 text-xs font-medium text-emerald-300">
                      <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
                      <span>{t.videoCall.youWithCameraOn}</span>
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-slate-300">
                <VideoOff className="h-8 w-8 text-slate-400" aria-hidden="true" />
                <span className="text-xs font-medium">{t.videoCall.youWithCameraOff}</span>
              </div>
            )}

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleMic}
                aria-label={micEnabled ? t.videoCall.muteMic : t.videoCall.unmuteMic}
                aria-pressed={!micEnabled}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition cursor-pointer ${
                  micEnabled
                    ? 'bg-slate-900/75 hover:bg-slate-900'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {micEnabled ? (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <MicOff className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={onToggleCamera}
                aria-label={cameraEnabled ? t.videoCall.disableCamera : t.videoCall.enableCamera}
                aria-pressed={!cameraEnabled}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition cursor-pointer ${
                  cameraEnabled
                    ? 'bg-slate-900/75 hover:bg-slate-900'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {cameraEnabled ? (
                  <Video className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <VideoOff className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>{t.videoCall.audioLevelLabel}</span>
              <span>{normalizedLevel}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={t.videoCall.audioLevelLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={normalizedLevel}
              className="h-2 w-full rounded-full bg-slate-200 dark:bg-[#2B2F45] overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-[#22C55E] transition-all duration-150"
                style={{ width: `${normalizedLevel}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="preview-camera-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                {t.videoCall.cameraSelectLabel}
              </label>
              <select
                id="preview-camera-select"
                value={selectedCameraId ?? ''}
                onChange={(e) => onSelectCamera(e.target.value)}
                disabled={cameras.length === 0}
                className="w-full rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] px-3 py-2 text-xs text-[#111827] dark:text-slate-100 focus:border-[#5B3DF5] focus:outline-none"
              >
                {cameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="preview-mic-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                {t.videoCall.microphoneSelectLabel}
              </label>
              <select
                id="preview-mic-select"
                value={selectedMicrophoneId ?? ''}
                onChange={(e) => onSelectMicrophone(e.target.value)}
                disabled={microphones.length === 0}
                className="w-full rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] px-3 py-2 text-xs text-[#111827] dark:text-slate-100 focus:border-[#5B3DF5] focus:outline-none"
              >
                {microphones.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#181B2A]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-100 dark:hover:bg-[#2B2F45] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            {t.videoCall.previewCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] px-4 py-2 text-xs font-semibold text-white transition cursor-pointer"
          >
            {t.videoCall.previewConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
