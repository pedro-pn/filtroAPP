import { useEffect, useState } from 'react';
import type { UploadedFile } from '../../api/uploads';
import { loadUploadAssetUrl } from '../../utils/uploadAssetUrl';

export function GeneralUploadThumb({ file }: { file: UploadedFile }) {
  const [href, setHref] = useState('');
  const displayName = file.fileName || file.label || 'Abrir foto';

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    loadUploadAssetUrl(file.url)
      .then(nextHref => {
        if (cancelled) {
          if (nextHref.startsWith('blob:')) URL.revokeObjectURL(nextHref);
          return;
        }
        objectUrl = nextHref.startsWith('blob:') ? nextHref : '';
        setHref(nextHref);
      })
      .catch(() => {
        if (!cancelled) setHref('');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url]);

  if (!href) return null;

  return (
    <a
      className="report-upload-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Abrir ${displayName}`}
      title={displayName}
    >
      <img src={href} alt="" className="upload-thumb" />
      <span className="report-upload-name">{displayName}</span>
    </a>
  );
}

