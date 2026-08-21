const sharp = require('sharp');
const path = require('path');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

async function createIcon(size, filename) {
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${size}" height="${size}" fill="#1a1a2e" rx="${Math.floor(size * 0.15)}"/>
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" 
              font-family="monospace" font-size="${Math.floor(size * 0.35)}" font-weight="bold" 
              fill="#ff6600">&gt;_</text>
    </svg>`;
    
    await sharp(Buffer.from(svg)).png().toFile(path.join(iconsDir, filename));
    console.log('Created:', filename);
}

async function main() {
    await createIcon(32, '32x32.png');
    await createIcon(128, '128x128.png');
    await createIcon(256, '128x128@2x.png');
    
    // ICO: just copy the 32x32 as placeholder (Tauri needs it but won't fail without proper ICO)
    await sharp(Buffer.from(`<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" fill="#1a1a2e" rx="5"/>
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" 
              font-family="monospace" font-size="11" font-weight="bold" 
              fill="#ff6600">&gt;_</text>
    </svg>`)).png().toFile(path.join(iconsDir, 'icon.ico'));
    console.log('Created: icon.ico');
    
    // ICNS: same as 128x128
    await sharp(Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
        <rect width="128" height="128" fill="#1a1a2e" rx="19"/>
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" 
              font-family="monospace" font-size="45" font-weight="bold" 
              fill="#ff6600">&gt;_</text>
    </svg>`)).png().toFile(path.join(iconsDir, 'icon.icns'));
    console.log('Created: icon.icns');
}

main().catch(console.error);
