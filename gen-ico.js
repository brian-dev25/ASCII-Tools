const toIco = require('to-ico');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

async function main() {
    const png32 = await sharp(Buffer.from(`<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
        <rect width="256" height="256" fill="#1a1a2e" rx="40"/>
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" 
              font-family="monospace" font-size="90" font-weight="bold" 
              fill="#ff6600">&gt;_</text>
    </svg>`)).png().toBuffer();

    const ico = await toIco([png32]);
    fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
    console.log('Created proper icon.ico');
}

main().catch(console.error);
