import path from 'node:path';
import os from 'node:os';

// Temporary per-test userData directory so tests never write to real userData
const TEST_USER_DATA = path.join(os.tmpdir(), 'drivego-test-userdata');

export const app = {
  getPath: (name: string): string => {
    const map: Record<string, string> = {
      userData: TEST_USER_DATA,
      documents: path.join(os.homedir(), 'Documents'),
      pictures: path.join(os.homedir(), 'Pictures'),
      desktop: path.join(os.homedir(), 'Desktop'),
      downloads: path.join(os.homedir(), 'Downloads'),
      videos: path.join(os.homedir(), 'Videos'),
      music: path.join(os.homedir(), 'Music'),
    };
    return map[name] ?? TEST_USER_DATA;
  },
  getVersion: () => '1.3.8',
  isPackaged: false,
};
