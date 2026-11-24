import type { AlbumSettings } from '../../types';
import { themeTone } from '../../data/appearance';
import { Starfield } from '../Starfield';
import { BlackHoleEffect } from './BlackHoleEffect';
import { FirefliesEffect } from './FirefliesEffect';
import { RainEffect } from './RainEffect';
import { SakuraEffect } from './SakuraEffect';
import { VideoBackground } from './VideoBackground';

export function BackgroundStage({ settings }: { settings: AlbumSettings }) {
  const effect = settings.backgroundEffect || 'stars';
  const tone = themeTone(settings.theme);
  const nightStars = tone === 'dark' ? <Starfield /> : null;

  if (effect === 'video' && settings.customVideoKey) {
    return <VideoBackground settings={settings} />;
  }

  if (effect === 'custom' && settings.customBackgroundSrc) {
    return (
      <div
        className="bg-custom"
        style={{ backgroundImage: `url("${settings.customBackgroundSrc}")` }}
        aria-hidden="true"
      />
    );
  }

  if (effect === 'blackhole') return <BlackHoleEffect />;
  if (effect === 'rain') {
    return (
      <>
        {nightStars}
        <RainEffect tone={tone} />
      </>
    );
  }
  if (effect === 'sakura') {
    return (
      <>
        {nightStars}
        <SakuraEffect />
      </>
    );
  }
  if (effect === 'fireflies') {
    return (
      <>
        {nightStars}
        <FirefliesEffect />
      </>
    );
  }
  if (effect === 'acrylic') {
    return (
      <div className="bg-acrylic" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (effect === 'aurora') {
    return (
      <>
        {nightStars}
        <div className="bg-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </>
    );
  }

  return <Starfield />;
}
