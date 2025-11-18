# Image Compression App

A simple image compression tool built using React Native & Expo.  
Images can be uploaded in **any format**, but the **output is always JPEG**.

## Features
- Upload images in any format
- Output compressed image only in JPEG
- Quality Percentage slider
- Target Width Option

## Live Demo
You can try the deployed version here:  
**https://compress-image-lyart.vercel.app/**

## Code Changes
All major changes and compression logic are implemented in:

      app/(tabs)/index.tsx

## How to Run
      npm install
      npx expo start

## Note
- Input formats supported: PNG, JPG, JPEG, HEIC, WebP, BMP, TIFF
- Output format: JPEG only
