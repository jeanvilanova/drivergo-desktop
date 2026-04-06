import React from 'react';

const svg = (d: string, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const svgPaths = (paths: string[], size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
);

export const IconFolder = ({ size = 16 }) => svgPaths([
  'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
], size);

export const IconFiles = ({ size = 16 }) => svgPaths([
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
  'M14 2v6h6',
], size);

export const IconSync = ({ size = 16 }) => svgPaths([
  'M21 2v6h-6',
  'M3 12a9 9 0 0 1 15-6.7L21 8',
  'M3 22v-6h6',
  'M21 12a9 9 0 0 1-15 6.7L3 16',
], size);

export const IconStorage = ({ size = 16 }) => svgPaths([
  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'M12 2v3M12 19v3M2 12h3M19 12h3',
], size);

export const IconSearch = ({ size = 16 }) => svgPaths([
  'M21 21l-4.35-4.35',
  'M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
], size);

export const IconUpload = ({ size = 16 }) => svgPaths([
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
  'M17 8l-5-5-5 5',
  'M12 3v12',
], size);

export const IconRefresh = ({ size = 16 }) => svgPaths([
  'M1 4v6h6',
  'M23 20v-6h-6',
  'M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15',
], size);

export const IconLogout = ({ size = 16 }) => svgPaths([
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
  'M16 17l5-5-5-5',
  'M21 12H9',
], size);

export const IconTrash = ({ size = 16 }) => svgPaths([
  'M3 6h18',
  'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
], size);

export const IconDownload = ({ size = 16 }) => svgPaths([
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
  'M7 10l5 5 5-5',
  'M12 15V3',
], size);

export const IconChevronRight = ({ size = 16 }) => svg('M9 18l6-6-6-6', size);

export const IconCheck = ({ size = 16 }) => svg('M20 6L9 17l-5-5', size);

export const IconPlus = ({ size = 16 }) => svg('M12 5v14M5 12h14', size);

export const IconAlert = ({ size = 16 }) => svgPaths([
  'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  'M12 9v4M12 17h.01',
], size);

export const IconActivity = ({ size = 16 }) => svgPaths([
  'M22 12h-4l-3 9L9 3l-3 9H2',
], size);

export const IconBackup = ({ size = 16 }) => svgPaths([
  'M21 8v13H3V8',
  'M1 3h22v5H1z',
  'M10 12h4',
], size);

export const IconDrive = ({ size = 16 }) => svgPaths([
  'M22 17H2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1z',
  'M6 17v3M18 17v3',
  'M2 11l4-7h12l4 7',
  'M18 14.5h.01',
], size);

export const IconPause = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const IconPlay = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

export const IconInfo = ({ size = 16 }) => svgPaths([
  'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z',
  'M12 16v-4M12 8h.01',
], size);

// File type icon — colored badge
interface FileIconProps { name: string; isFolder?: boolean; size?: number }

const FILE_TYPES: Record<string, { label: string; color: string; bg: string }> = {
  pdf:  { label: 'PDF', color: '#ff6b6b', bg: 'rgba(255,107,107,.12)' },
  doc:  { label: 'DOC', color: '#5caeff', bg: 'rgba(92,174,255,.12)' },
  docx: { label: 'DOC', color: '#5caeff', bg: 'rgba(92,174,255,.12)' },
  txt:  { label: 'TXT', color: '#8899b4', bg: 'rgba(136,153,180,.1)' },
  md:   { label: 'MD',  color: '#8899b4', bg: 'rgba(136,153,180,.1)' },
  xls:  { label: 'XLS', color: '#10d9a0', bg: 'rgba(16,217,160,.1)' },
  xlsx: { label: 'XLS', color: '#10d9a0', bg: 'rgba(16,217,160,.1)' },
  csv:  { label: 'CSV', color: '#10d9a0', bg: 'rgba(16,217,160,.1)' },
  ppt:  { label: 'PPT', color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  pptx: { label: 'PPT', color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  jpg:  { label: 'IMG', color: '#c67af5', bg: 'rgba(198,122,245,.1)' },
  jpeg: { label: 'IMG', color: '#c67af5', bg: 'rgba(198,122,245,.1)' },
  png:  { label: 'IMG', color: '#c67af5', bg: 'rgba(198,122,245,.1)' },
  gif:  { label: 'GIF', color: '#c67af5', bg: 'rgba(198,122,245,.1)' },
  webp: { label: 'IMG', color: '#c67af5', bg: 'rgba(198,122,245,.1)' },
  svg:  { label: 'SVG', color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  mp4:  { label: 'VID', color: '#f25757', bg: 'rgba(242,87,87,.1)' },
  mov:  { label: 'VID', color: '#f25757', bg: 'rgba(242,87,87,.1)' },
  avi:  { label: 'VID', color: '#f25757', bg: 'rgba(242,87,87,.1)' },
  mkv:  { label: 'VID', color: '#f25757', bg: 'rgba(242,87,87,.1)' },
  mp3:  { label: 'AUD', color: '#5caeff', bg: 'rgba(92,174,255,.12)' },
  wav:  { label: 'AUD', color: '#5caeff', bg: 'rgba(92,174,255,.12)' },
  flac: { label: 'AUD', color: '#5caeff', bg: 'rgba(92,174,255,.12)' },
  zip:  { label: 'ZIP', color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  rar:  { label: 'RAR', color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  '7z': { label: '7Z',  color: '#f5a623', bg: 'rgba(245,166,35,.1)' },
  js:   { label: 'JS',  color: '#f5e642', bg: 'rgba(245,230,66,.1)' },
  ts:   { label: 'TS',  color: '#4d7cf4', bg: 'rgba(77,124,244,.12)' },
  json: { label: 'JSON',color: '#f5e642', bg: 'rgba(245,230,66,.1)' },
  py:   { label: 'PY',  color: '#10d9a0', bg: 'rgba(16,217,160,.1)' },
  sql:  { label: 'SQL', color: '#10d9a0', bg: 'rgba(16,217,160,.1)' },
};

export function FileTypeIcon({ name, isFolder = false, size = 36 }: FileIconProps) {
  if (isFolder) {
    return (
      <div className="file-icon-wrap file-icon-folder" style={{ width: size, height: size }}>
        <IconFolder size={Math.round(size * 0.5)} />
      </div>
    );
  }
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const t = FILE_TYPES[ext];
  const label = t?.label ?? (ext.toUpperCase().slice(0, 3) || 'FILE');
  const color = t?.color ?? '#8899b4';
  const bg    = t?.bg    ?? 'rgba(136,153,180,.1)';
  return (
    <div className="file-icon-wrap" style={{
      width: size, height: size, background: bg,
      border: `1px solid ${color}30`, color,
      fontSize: label.length > 3 ? 8 : 10,
    }}>
      {label}
    </div>
  );
}
