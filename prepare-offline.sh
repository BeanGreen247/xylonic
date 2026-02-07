#!/bin/bash

# This script prepares the project for offline installation
echo "Preparing Xylonic for offline installation..."

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build dist node_modules package-lock.json

# Install dependencies
echo "Installing dependencies..."
npm install

# Create offline cache
echo "Creating npm cache..."
npm cache verify

# Build the application
echo "Building application..."
npm run build

# Build Electron app
echo "Building Electron installer..."
npm run electron:build:win

echo "Build complete! Installer available in dist/ folder"
