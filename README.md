# Preset Lab

Pick a reference photo and your own photo, and get a Lightroom and Camera Raw preset (.xmp) that moves your photo toward that look.

Made by [Zero3](https://www.zero3creatives.net/).

## Why I built Preset Lab

(placeholder: Krishna's own words go here.)

## What it does

I built Cube Lab to make LUTs for video. Preset Lab is the same idea for photos. You choose a reference photo with the look you want and one of your own photos. Preset Lab works out settings that move yours toward it, shows a before and after you can drag, and gives you an .xmp preset file. It runs in your browser, nothing is uploaded, and there is no account.

Three sliders: Match brightness (the light and dark balance), Match colour (tint and richness) and Colour mixer (hue and saturation of individual colours). A switch keeps your blacks and whites clean so the match does not tint them.

On top of the match there is a Fine tune section: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temperature, Tint, Vibrance and Saturation, plus a tone curve you can drag. It works without a reference photo too, so you can use it as a plain preset maker. Everything you set goes into the .xmp file and into the edited picture.

## The built-in presets

There are 340 built-in presets you can pick from instead of using a reference photo. They come from a pack I have the licence to use. I did not name them by hand: each name is worked out from the preset's own settings (warm or cool, vivid or muted, matte, punchy, split toning and so on), and there are filter buttons for those groups. Where a preset carries a credit in its file (51 from Adobe, 3 from Sergey Zhmakin, 3 from 2000px Media), that credit text is kept in the file you download.

Pick one and it is applied to your photo, then you can still change it in Fine tune. The preview draws exposure, tone, white balance, saturation, the colour mixer (hue, saturation and brightness), the tone curves, split toning, the parametric curve and vignette. Clarity, Texture, Dehaze, Grain and Calibration are written into the file but the preview does not draw them, and the page says so when a preset uses them. One preset also had a local mask in the original. Masks are not copied, so that one is the version without it.

## What goes into the preset

- A tone curve, built by matching the light and dark balance of the two photos, or one you shaped by hand.
- Your Fine tune settings: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Vibrance, and relative Temperature and Tint (the kind Lightroom uses for JPEGs and other non-raw photos).
- Red, green and blue curves, which carry the colour tint of the reference in your shadows, mids and highlights.
- Overall Saturation.
- The colour mixer: Hue and Saturation for the eight colours (red, orange, yellow, green, aqua, blue, purple, magenta). Built-in presets also use Luminance for those colours.

You can also save the edited picture itself (PNG lossless, or JPG at top quality) at the native pixel size of the photo you loaded. That is the tool's own preview maths, so it may differ slightly from Lightroom. The preset file is the one to trust in Lightroom.

The page lists exactly what ended up in your preset before you download it. Settings it does not need are left out of the file, so the preset only touches what it sets.

## How to use it in Lightroom

Lightroom Classic: open Develop, click the plus (+) in the Presets panel, choose Import Presets, and pick the .xmp. Lightroom (cloud) and Camera Raw in Photoshop: open Presets, click the three dots, choose Import Presets.

Adobe says Lightroom Classic 8.2 and earlier cannot import .xmp presets.

## What it cannot do

- From a reference photo it cannot copy masks, local edits, crops, grain or camera profiles. Built-in presets keep their grain but not masks, sharpening, noise reduction, lens or profile settings.
- It cannot read the real settings of the reference photo. It only sees the picture, so the preset is an estimate of the look.
- The match itself does not set Exposure, Contrast or White Balance. The curves carry the tone and tint instead, so the match does not fight with the exposure of whatever photo you apply it to. Those only change if you move the Fine tune sliders. Sharpening, noise, grain and the Color Grading wheels are not covered.
- The hand-drawn curve cannot go backwards (a point cannot sit lower than the point before it), so inverted curves are not possible.
- If the reference has very different content from your photo (a night street against a green forest, say), colours can be pulled the wrong way. Lower the sliders and look at faces.

## How I checked it

`npm test` runs 54 checks. They cover the 340 built-in presets (each writes a valid file, keeps its credit text, and reads back to the same picture), the curve maths, writing and reading the file, a validity check on the XMP (namespaces, the id, value ranges, curve order, balanced tags), names with odd characters, what each Fine tune slider does to dark and light areas, and that a brighter, warmer reference moves a photo the right way. A photo matched against itself comes out unchanged.

Every time you press Download, the page also reads the file back and checks that it gives the same picture as the preview.

**Tested in Lightroom.** I opened the .xmp files in Lightroom and they work. The preview is my own copy of the maths, so Lightroom will look close but not identical, most of all for Saturation and the colour mixer. The curves are exact. Exposure, Highlights, Shadows, Whites, Blacks, Contrast, Temperature, Tint and Vibrance are my own approximations of Adobe's maths, so expect them to look similar and not identical.

## Licence

I made this and it is free to use, including for paid work. What it is not free to do is be copied: please don't republish, redistribute or sell the code, or build your own version from it. The full terms are in [LICENSE](LICENSE). The Zero3 name and logo are not part of the licence.
