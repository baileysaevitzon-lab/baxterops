# Zen Hollywood field-tour photo directory

This directory is referenced by the `PhotoEvidenceRecord` metadata seeded into BaxterOps for
the **Zen Hollywood Field Tour — 2026-05-26** collection (42 photos).

## To make thumbnails render

The originals at `/Users/shane/Desktop/The Zen/` are `.heic` files. Browsers can't render
HEIC natively. Convert them to JPEG and drop the result here, keeping the original filenames:

```bash
cd "/Users/shane/Desktop/The Zen"
mkdir -p converted
sips -s format jpeg --setProperty formatOptions 85 *.heic --out converted/

# Then copy into the app:
cp converted/*.jpg "<path to baxter-ops>/public/zen-tour/"
```

Or use Preview > File > Export… > JPEG, one at a time.

After files are in place, edit each `PhotoEvidenceRecord` in localStorage (or call
`attachStoredImage(collectionId, photoOrder, "/zen-tour/IMG_2251.jpg", "/zen-tour/IMG_2251.jpg")`
from `lib/services/photoEvidence.ts`) to populate `publicUrl`.

A v2 sprint should auto-detect files in this folder by filename match and populate
`publicUrl` for each record at load time.

## Source files

```
IMG_2251.heic … IMG_2290.heic  (40 files)
IMG_2293.heic, IMG_2294.heic   (2 files — IMG_2291 and IMG_2292 absent from camera roll)
```
