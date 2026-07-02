# Admin Panel - Modular File Structure

This document explains the modular structure created for better maintainability.

## File Organization

### Main Files
- **index-modular.html** - Main entry point combining all panes and scripts
- **styles.css** - All CSS styling for the admin panel

### HTML Panes (in `/panes/`)
Each pane is a separate HTML fragment for easier editing and maintenance:
- **login.html** - Login form with GitHub token input
- **topbar.html** - Top navigation bar (Upload & Save buttons)
- **left-pane.html** - Left sidebar showing slide thumbnails
- **center-pane.html** - Center preview area (TV screen display)
- **right-pane.html** - Right sidebar showing slide properties/metadata
- **upload-preview.html** - Upload preview area

### JavaScript Modules (in `/js/`)
Functionality is organized into focused modules:
- **app.js** - Main application initialization and login
- **github.js** - GitHub API interactions (fetch, base64 conversion)
- **config.js** - Configuration loading and saving
- **upload.js** - File upload handling
- **ui.js** - UI rendering and user interactions (select, delete, reorder)

## Load Order
Scripts are loaded in this dependency order:
1. github.js - GitHub utilities
2. config.js - Config utilities
3. ui.js - UI utilities
4. upload.js - Upload utilities
5. app.js - Main app entry point

## Maintenance Tips

### Adding a New Feature
1. Identify which pane it belongs to (edit corresponding HTML in `/panes/`)
2. Add styling to `styles.css` if needed
3. Add logic to the appropriate JS module:
   - API calls → github.js
   - Config changes → config.js
   - UI updates → ui.js
   - Upload logic → upload.js
   - App flow → app.js

### Modifying Pane Layout
Edit the corresponding HTML file in `/panes/` without touching other files.

### Updating Styles
All styling is centralized in `styles.css` for easy modification.

### Testing
`index-modular.html` is the live admin console.
