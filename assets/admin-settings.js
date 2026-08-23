// Stryker Trading Academy — Admin Settings (settings-admin.html)
// Depends on: assets/auth.js

function showAdminSettingsMsg(elId, message){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;

  guardAdminPage((user) => {
    currentUser = user;
    document.getElementById('settings-name').value = user.displayName || '';
    document.getElementById('settings-email').value = user.email || '';
  });

  document.getElementById('settings-save-name').addEventListener('click', () => {
    if (!currentUser) return;
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) { showAdminSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }
    currentUser.updateProfile({ displayName: newName })
      .then(() => showAdminSettingsMsg('settings-success', 'Saved.'))
      .catch((err) => showAdminSettingsMsg('settings-error', err.message || 'Could not save changes.'));
  });

  document.getElementById('settings-reset-password').addEventListener('click', () => {
    if (!currentUser || !currentUser.email) return;
    auth.sendPasswordResetEmail(currentUser.email)
      .then(() => showAdminSettingsMsg('settings-success', 'Password reset email sent — check your inbox.'))
      .catch((err) => showAdminSettingsMsg('settings-error', err.message || 'Could not send reset email.'));
  });
});
