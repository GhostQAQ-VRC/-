import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Empty/undefined values render the fallback immediately. */
  src?: string | null;
  /** Custom fallback node; pass null to render nothing. */
  fallback?: ReactNode;
  fallbackClassName?: string;
  fallbackLabel?: string;
}

/**
 * <img> with a visible fallback for broken remote links and library files that
 * were moved or deleted outside the app. Images fade in once decoded, which
 * prevents a flash while scrolling through a large timeline.
 */
export function SafeImage({
  src,
  alt,
  fallback,
  fallbackClassName,
  fallbackLabel = '图片不可用',
  className,
  onLoad,
  onError,
  ...rest
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    const image = imgRef.current;
    if (image && image.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  if (!src || failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <span
        className={`media-fallback${fallbackClassName ? ` ${fallbackClassName}` : ''}`}
        role="img"
        aria-label={alt || fallbackLabel}
      >
        <ImageOff size={22} aria-hidden="true" />
      </span>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      {...rest}
      decoding={rest.decoding ?? 'async'}
      className={`safe-image${loaded ? ' is-loaded' : ''}${className ? ` ${className}` : ''}`}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
