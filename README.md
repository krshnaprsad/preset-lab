# Preset Lab

Pick a reference photo and your own photo, and get a Lightroom and Camera Raw preset (.xmp) that moves your photo toward that look.

Made by [Zero3](https://www.zero3creatives.net/).

## Why I built Preset Lab

(placeholder: Krishna's own words go here.)

## What it does

I built Cube Lab to make LUTs for video. Preset Lab is the same idea for photos. You choose a reference photo with the look you want and one of your own photos. Preset Lab works out settings that move yours toward it, shows a before and after you can drag, and gives you an .xmp preset file. It runs in your browser, nothing is uploaded, and there is no account.

Three sliders: Match brightness (the light and dark balance), Match colour (tint and richness) and Colour mixer (hue and saturation of individual colours). A switch keeps your blacks and whites clean so the match does not tint them.

## What goes into the preset

- A tone curve, built by matching the light and dark balance of the two photos.
- Red, green and blue curves, which carry the colour tint of the reference in your shadows, mids and highlights.
- Overall Saturation.
- The colour mixer: Hue and Saturation for the eight colours (red, orange, yellow, green, aqua, blue, purple, magenta).

You can also save the edited picture itself (PNG lossless, or JPG at top quality) at the native pixel size of the photo you loaded. That is the tool's own preview maths, so it may differ slightly from Lightroom. The preset file is the one to trust in Lightroom.

The page lists exactly what ended up in your preset before you download it. Settings it does not need are left out of the file, so the preset only touches what it sets.

## How to use it in Lightroom

Lightroom Classic: open Develop, click the plus (+) in the Presets panel, choose Import Presets, and pick the .xmp. Lightroom (cloud) and Camera Raw in Photoshop: open Presets, click the three dots, choose Import Presets.

Adobe says Lightroom Classic 8.2 and earlier cannot import .xmp presets.

## What it cannot do

- It cannot copy masks, local edits, crops, grain or camera profiles.
- It cannot read the real settings of the reference photo. It only sees the picture, so the preset is an estimate of the look.
- It does not set Exposure, Contrast, White Balance, sharpening or the Color Grading wheels. The curves carry the tone and tint instead, so the preset does not fight with the exposure of whatever photo you apply it to.
- If the reference has very different content from your photo (a night street against a green forest, say), colours can be pulled the wrong way. Lower the sliders and look at faces.

## How I checked it

`npm test` runs 31 checks. They cover the curve maths, writing and reading the file, a validity check on the XMP (namespaces, the id, value ranges, curve order, balanced tags), names with odd characters, and that a brighter, warmer reference moves a photo the right way. A photo matched against itself comes out unchanged.

Every time you press Download, the page also reads the file back and checks that it gives the same picture as the preview.

**I have not tested the file in real Lightroom.** The file is modelled on a real Lightroom preset and follows Adobe's published settings names and ranges, but that is not the same as opening it in Lightroom. If you try it and something is off, please tell me. The preview is my own copy of the maths, so Lightroom will look close but not identical, most of all for Saturation and the colour mixer. The curves are exact.

## Licence

I made this and it is free to use, including for paid work. What it is not free to do is be copied: please don't republish, redistribute or sell the code, or build your own version from it. The full terms are in [LICENSE](LICENSE). The Zero3 name and logo are not part of the licence.
