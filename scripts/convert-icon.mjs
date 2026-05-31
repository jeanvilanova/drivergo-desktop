import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src  = path.join(__dirname, '../../../Users/jeanr/Downloads/ICONE.png');
const dest = path.join(__dirname, '../assets');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function run() {
  console.log('Gerando tamanhos para .ico…');

  const pngBuffers = await Promise.all(
    SIZES.map((s) =>
      sharp(src)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(dest, 'icon.ico'), icoBuffer);
  console.log('✓ assets/icon.ico gerado');

  // Also copy a 512x512 PNG as logo-icon.png
  await sharp(src)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(dest, 'logo-icon.png'));
  console.log('✓ assets/logo-icon.png gerado');
}

run().catch((e) => { console.error(e); process.exit(1); });
