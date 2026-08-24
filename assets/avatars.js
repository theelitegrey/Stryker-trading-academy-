// Stryker Trading Academy — Avatars module
// Depends on: nothing (pure functions), but callers typically already have
// `initials()` from community.js loaded for the fallback path.
//
// Priority for a user's displayed avatar:
//   1. A custom photo they uploaded themselves (students/{uid}.customPhotoURL,
//      a resized base64 data URL, same pattern as other image uploads on this site)
//   2. Their Google account photo, if they signed up/in with Google
//      (students/{uid}.photoURL, captured once at student-doc creation)
//   3. A deterministic, free, keyless generated avatar (DiceBear, "personas"
//      style — illustrated human faces) seeded by their uid — same user
//      always gets the same auto-avatar unless they upload their own, so
//      it isn't randomly different on every reload.
//   4. If even the generated avatar image fails to load (offline, blocked),
//      callers fall back to the colored-initials circle that was already
//      used everywhere before this feature existed.

const DICEBEAR_STYLE = 'personas'; // illustrated half-body human avatars — clean, professional, not cartoonish. CC BY 4.0 (Personas by Draftbit), served via DiceBear's hosted API.

function dicebearAvatarUrl(seed){
  return 'https://api.dicebear.com/10.x/' + DICEBEAR_STYLE + '/svg?seed=' + encodeURIComponent(seed || 'trader') + '&backgroundType=gradientLinear';
}

function randomAvatarSeed(){
  return 'seed-' + Math.random().toString(36).slice(2, 10);
}

// studentData: the student's Firestore doc data (may be null/undefined).
// uid: required — used as the deterministic seed fallback if no avatarSeed
// has been explicitly rolled.
function resolveAvatarUrl(uid, studentData){
  const d = studentData || {};
  if (d.customPhotoURL) return d.customPhotoURL;
  if (d.photoURL) return d.photoURL;
  return dicebearAvatarUrl(d.avatarSeed || uid);
}

// Returns a ready-to-insert <img> (or initials-div fallback) HTML string.
// sizePx controls both dimensions; the initials fallback reuses the existing
// .floor-avatar-style circle look so it matches whatever surface it's on.
function avatarImgHtml(uid, name, studentData, sizePx){
  const size = sizePx || 36;
  const url = resolveAvatarUrl(uid, studentData);
  const escapedName = escapeAvatarText(name || 'Trader');
  const initialsFallback = (typeof initials === 'function') ? initials(name) : escapedName.slice(0, 2).toUpperCase();
  // onerror swaps a broken/blocked image for the same colored-initials
  // circle used site-wide before this feature, so a network hiccup never
  // shows a broken-image icon.
  return (
    '<img src="' + url + '" alt="' + escapedName + '" loading="lazy" ' +
    'style="width:' + size + 'px; height:' + size + 'px; border-radius:50%; flex-shrink:0; object-fit:cover; background:var(--bg-3,#1b1f26);" ' +
    'onerror="this.outerHTML=\'<div class=&quot;floor-avatar&quot; style=&quot;width:' + size + 'px; height:' + size + 'px; font-size:' + Math.round(size * 0.36) + 'px;&quot;>' + initialsFallback + '</div>\'">'
  );
}

function escapeAvatarText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Used by the Settings "Upload photo" control — same resize-to-data-URL
// pattern already used for chapter/model editor image inserts.
function resizeAvatarToDataUrl(file, maxDim){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        let { width, height } = img;
        const dim = maxDim || 240;
        if (width > dim || height > dim) {
          const scale = dim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
