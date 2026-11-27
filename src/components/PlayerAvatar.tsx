import { SafeImage } from './SafeImage';
import { playerInitial } from '../utils/players';

export function PlayerAvatar({
  name,
  src,
  size = 34,
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`player-avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
    >
      <SafeImage
        src={src || null}
        alt=""
        loading="lazy"
        fallback={
          <span className="player-avatar__initial" aria-hidden="true">
            {playerInitial(name)}
          </span>
        }
      />
    </span>
  );
}
