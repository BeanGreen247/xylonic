const { execSync } = require('child_process');
const path = require('path');

// Requires: npm install -g sharp-cli
// Usage: node scripts/generate-icons.js

const assetsDir = path.join(__dirname, '..', 'assets');
const svgSource = path.join(assetsDir, 'icon-source.svg');

console.log('Generating app icons from SVG...');

try {
  // Generate PNG (512x512 for Linux)
  execSync(`npx sharp -i "${svgSource}" -o "${path.join(assetsDir, 'icon.png')}" resize 512 512`);
  console.log('Generated icon.png (512x512)');
  
  // Generate smaller PNG for ICO conversion (256x256 for Windows)
  execSync(`npx sharp -i "${svgSource}" -o "${path.join(assetsDir, 'icon-256.png')}" resize 256 256`);
  console.log('Generated icon-256.png (for .ico conversion)');
  
  console.log('\n📝 Next steps:');
  console.log('1. For Windows: Convert icon-256.png to icon.ico using https://convertio.co/png-ico/');
  console.log('2. For macOS: Convert icon.png to icon.icns using https://cloudconvert.com/png-to-icns');
  console.log('3. Place icon.ico, icon.png, and icon.icns in the assets/ folder');
  
} catch (error) {
  console.error('ERROR: Error generating icons:', error.message);
  console.log('\nINFO: Install sharp-cli: npm install -g sharp-cli');
}
