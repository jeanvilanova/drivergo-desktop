import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface DriveConfig {
  letter: string;   // single uppercase letter, e.g. "G"
  enabled: boolean;
}

function configPath() {
  return path.join(app.getPath('userData'), 'drive-config.json');
}

export function getDriveConfig(): DriveConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw) as DriveConfig;
  } catch {
    return { letter: 'G', enabled: false };
  }
}

export function saveDriveConfig(cfg: DriveConfig) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export function getDriveRoot(): string {
  return path.join(app.getPath('userData'), 'drivego-drive');
}
