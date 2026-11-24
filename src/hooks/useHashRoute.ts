import { useCallback, useEffect, useState } from 'react';

function readPath(): string {
  const hash = window.location.hash;
  if (!hash.startsWith('#/')) return '/';
  return hash.slice(1) || '/';
}

export interface HashRoute {
  path: string;
  navigate: (path: string) => void;
}

/** Hash router keeps static hosting trivial while leaving section anchors untouched. */
export function useHashRoute(): HashRoute {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const onHashChange = () => setPath(readPath());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: string) => {
    const normalized = next.startsWith('/') ? next : `/${next}`;
    if (readPath() === normalized) {
      setPath(normalized);
      window.scrollTo({ top: 0 });
      return;
    }
    window.location.hash = `#${normalized}`;
    window.scrollTo({ top: 0 });
  }, []);

  return { path, navigate };
}
