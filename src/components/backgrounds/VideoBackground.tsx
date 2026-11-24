import { useEffect, useState } from 'react';
import type { AlbumSettings } from '../../types';
import { getDesktopBridge } from '../../platform';
import { mediaUrl } from '../../platform/media';
import { getBackgroundVideo } from '../../services/backgroundVideoStore';

interface VideoBackgroundProps {
  settings: AlbumSettings;
}

/**
 * Looping video backdrop. Desktop reads the clip from the library cache through
 * the media protocol; the browser edition resolves it from IndexedDB into a
 * blob URL. The poster frame paints instantly and remains visible when the
 * video cannot be decoded or motion is reduced.
 */
export function VideoBackground({ settings }: VideoBackgroundProps) {
  const key = settings.customVideoKey;
  const bridge = getDesktopBridge();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  useEffect(() => {
    if (reducedMotion || !key) {
      setSrc(null);
      setFailed(false);
      return undefined;
    }
    setFailed(false);
    if (bridge) {
      setSrc(mediaUrl('background', key));
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    getBackgroundVideo(key)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, bridge, reducedMotion]);

  return (
    <div
      className="bg-video"
      style={
        settings.customVideoPoster
          ? { backgroundImage: `url("${settings.customVideoPoster}")` }
          : undefined
      }
      aria-hidden="true"
    >
      {src && !failed ? (
        <video
          key={src}
          className="bg-video__media"
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="bg-video__shade" />
    </div>
  );
}
