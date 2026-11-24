import type { ReactNode } from 'react';
import { AlertTriangle, Database, HardDrive, ShieldCheck, Sparkles } from 'lucide-react';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatAdminDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatAdminRelative(iso: string): string {
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return iso;
  const diff = Date.now() - date;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(date));
}

type Tone = 'sakura' | 'lilac' | 'gold' | 'aqua' | 'muted' | 'danger';

export function AdminTag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`admin-tag admin-tag--${tone}`}>{children}</span>;
}

export function AdminPageHead({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="admin-page-head">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h2>{title}</h2>
        {description ? <p className="admin-page-head__desc">{description}</p> : null}
      </div>
      {actions ? <div className="admin-page-head__actions">{actions}</div> : null}
    </div>
  );
}

export function AdminPanel({
  kicker,
  title,
  actions,
  children,
  className = '',
}: {
  kicker?: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      {title || actions ? (
        <header className="admin-panel__head">
          <div>
            {kicker ? <p className="section-kicker">{kicker}</p> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {actions ? <div className="admin-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function AdminStat({
  icon,
  label,
  value,
  unit,
  hint,
  tone = 'sakura',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className={`admin-stat admin-stat--${tone}`}>
      <span className="admin-stat__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="admin-stat__body">
        <p className="admin-stat__label">{label}</p>
        <p className="admin-stat__value">
          {value}
          {unit ? <span>{unit}</span> : null}
        </p>
        {hint ? <p className="admin-stat__hint">{hint}</p> : null}
      </div>
    </div>
  );
}

export function AdminEmpty({
  icon = <Sparkles size={24} strokeWidth={1.4} />,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-empty">
      <span className="admin-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="admin-empty__title">{title}</p>
      {text ? <p className="admin-empty__text">{text}</p> : null}
      {action ? <div className="admin-empty__action">{action}</div> : null}
    </div>
  );
}

export function StorageMeter({ bytes, limit = 5 * 1024 * 1024 }: { bytes: number; limit?: number }) {
  const percent = Math.min(100, Math.round((bytes / limit) * 100));
  return (
    <div className="storage-meter">
      <div className="storage-meter__top">
        <span>
          <HardDrive size={13} aria-hidden="true" />
          本地存储
        </span>
        <span>
          {formatBytes(bytes)} / 约 {formatBytes(limit)}
        </span>
      </div>
      <div className="storage-meter__track" aria-hidden="true">
        <span
          className={`storage-meter__fill${percent > 80 ? ' is-high' : ''}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <p className="storage-meter__hint">
        {percent > 80 ? (
          <>
            <AlertTriangle size={12} aria-hidden="true" /> 空间接近上限，请导出备份并清理照片。
          </>
        ) : (
          <>
            <ShieldCheck size={12} aria-hidden="true" /> 数据只存在当前浏览器，请定期导出备份。
          </>
        )}
      </p>
    </div>
  );
}

export function DataMini({ photos, worlds }: { photos: number; worlds: number }) {
  return (
    <p className="admin-data-mini">
      <Database size={13} aria-hidden="true" />
      {photos} 张照片 · {worlds} 条世界资料
    </p>
  );
}
