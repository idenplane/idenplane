# Palette's Journal

## 2026-03-05 - Keyboard Accessibility on Password Toggles
**Learning:** Excluding password visibility toggle buttons from keyboard navigation (using `tabIndex={-1}`) is a major accessibility barrier. Keyboard-only users are unable to reveal or hide their password inputs to verify them. Removing `tabIndex={-1}` and adding proper `focus-visible` styling allows all users to interact with these elements seamlessly.
**Action:** Always ensure interactive elements (including eye/toggle buttons) are fully focusable with visible indicators, without using `-1` tabIndex unless there's an alternative keyboard command.
