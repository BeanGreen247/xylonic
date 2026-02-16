#!/usr/bin/env node

/**
 * Pre-build cleanup script for developer machine only
 * 1. Cleans project build artifacts (build/, dist/)
 * 2. Cleans AppData/Roaming/xylonic directory
 * Preserves in AppData: color_settings folder and permanent_cache folder
 * Removes: everything else (settings.cfg, app.log, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Get project root directory
const projectRoot = path.resolve(__dirname, '..');

// Get the xylonic AppData directory
function getAppDataPath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'xylonic');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'xylonic');
  } else {
    return path.join(homeDir, '.config', 'xylonic');
  }
}

// Folders to preserve during cleanup
const PRESERVE_FOLDERS = ['color_settings', 'permanent_cache'];

// Clean project build directories
function cleanProjectDirs() {
  console.log('\n========================================');
  console.log('CLEANING PROJECT BUILD ARTIFACTS');
  console.log('========================================');
  
  const dirsToClean = [
    path.join(projectRoot, 'build'),
    path.join(projectRoot, 'dist')
  ];
  
  let removedCount = 0;
  
  dirsToClean.forEach(dir => {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`✓ Removed: ${path.basename(dir)}/`);
        removedCount++;
      } catch (error) {
        console.warn(`! Warning: Could not remove ${path.basename(dir)}: ${error.message}`);
      }
    } else {
      console.log(`✓ Not found: ${path.basename(dir)}/ (already clean)`);
    }
  });
  
  console.log(`\nRemoved ${removedCount} project build directory(ies)`);
  console.log('========================================\n');
}

// Clean the AppData directory
function cleanAppData() {
  const appDataPath = getAppDataPath();
  
  console.log('========================================');
  console.log('CLEANING APPDATA DIRECTORY');
  console.log('========================================');
  console.log(`Target directory: ${appDataPath}`);
  
  // Check if directory exists
  if (!fs.existsSync(appDataPath)) {
    console.log('✓ AppData directory does not exist, nothing to clean');
    console.log('========================================\n');
    return;
  }
  
  console.log('\nPreserving folders:');
  PRESERVE_FOLDERS.forEach(folder => console.log(`  - ${folder}`));
  console.log('\nCleaning...');
  
  let removedCount = 0;
  let preservedCount = 0;
  
  try {
    // Read all items in the directory
    const items = fs.readdirSync(appDataPath);
    
    items.forEach(item => {
      const itemPath = path.join(appDataPath, item);
      const stats = fs.statSync(itemPath);
      
      // Check if this item should be preserved
      if (PRESERVE_FOLDERS.includes(item)) {
        console.log(`  ✓ Preserved: ${item}`);
        preservedCount++;
        return;
      }
      
      // Remove the item
      try {
        if (stats.isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
          console.log(`  ✗ Removed folder: ${item}`);
        } else {
          fs.unlinkSync(itemPath);
          console.log(`  ✗ Removed file: ${item}`);
        }
        removedCount++;
      } catch (error) {
        console.warn(`  ! Warning: Could not remove ${item}: ${error.message}`);
      }
    });
    
    console.log('\n----------------------------------------');
    console.log(`Removed: ${removedCount} item(s)`);
    console.log(`Preserved: ${preservedCount} folder(s)`);
    console.log('----------------------------------------');
    console.log('✓ AppData cleanup completed successfully');
    console.log('========================================\n');
    
  } catch (error) {
    console.error(`✗ Error during AppData cleanup: ${error.message}`);
    console.log('========================================\n');
    process.exit(1);
  }
}

// Run cleanup
console.log('\n╔════════════════════════════════════════╗');
console.log('║     PRE-BUILD CLEANUP SCRIPT           ║');
console.log('╚════════════════════════════════════════╝');

cleanProjectDirs();
cleanAppData();

console.log('╔════════════════════════════════════════╗');
console.log('║   ALL CLEANUP TASKS COMPLETED          ║');
console.log('╚════════════════════════════════════════╝\n');
