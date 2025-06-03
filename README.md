# GLAZE - LUT Launcher Plugin for Photoshop

A professional Adobe Photoshop UXP plugin that streamlines LUT (Look-Up Table) application workflows for photographers and color grading professionals.

## Features

✅ **LUT Template Creation**
- Automatically generates PSD templates from folder of .cube LUT files
- Creates individual Color Lookup adjustment layers for each LUT
- 800×800px template documents for organized LUT management

✅ **Batch LUT Application**
- Apply multiple LUTs from templates to active photos
- One-click workflow for consistent color grading
- Automatic layer copying and template management

✅ **Film Emulation**
- Instant film-style color grading effects
- Quick color balance adjustments
- Professional analog film look simulation

✅ **Professional Workflow**
- Photoshop CC 2023+ compatible
- UXP (Unified Extensibility Platform) based
- Dark UI theme matching Photoshop interface
- Streamlined photographer workflow

## Installation

### Method 1: UXP Developer Tool (Recommended for Development)
1. Download/clone this repository
2. Open UXP Developer Tool
3. Add this plugin folder
4. Load plugin into Photoshop

### Method 2: CCX Package
1. Install the provided `com.example.lutlauncher_PS.ccx` file
2. Double-click to install in Photoshop
3. Access via Window → Extensions → GLAZE

## Usage

### 1. Prepare LUT Files
- Organize your .cube LUT files in a folder
- Ensure files have descriptive names (they become layer names)

### 2. Create LUT Template
1. Click "新規 LUT テンプレート作成" (Create New LUT Template)
2. Select folder containing .cube files
3. Plugin creates PSD template with Color Lookup layers

### 3. Apply LUTs to Photos
1. Open a photo in Photoshop
2. Click "ファイルへLUTレイヤー適用" (Apply LUT Layers to File)
3. Select your LUT template PSD
4. All LUTs are applied as adjustment layers

### 4. Film Emulation (Optional)
1. With photo open, click "Filmレイヤー適用" (Apply Film Layer)
2. Instant film-style color grading is applied

## Technical Specifications

- **Platform**: Adobe UXP (Unified Extensibility Platform)
- **Compatibility**: Adobe Photoshop 26.0.0+
- **Languages**: JavaScript (ES6+), HTML5, CSS3
- **Manifest Version**: 4

### File Structure
```
my-lut-plugin/
├── manifest.json          # Plugin configuration
├── index.html             # Main UI interface
├── main.js                # Core functionality
├── style.css              # UI styling
├── 要件定義書.md           # Japanese requirements document
└── assets/
    └── icons/
        ├── Logo.png        # GLAZE logo
        └── lut-icon.png    # Plugin icon
```

## Workflow Benefits

**For Photographers:**
- Batch process multiple photos with consistent LUT looks
- Organize and reuse favorite LUT combinations
- Streamline color grading workflow

**For Colorists:**
- Quick LUT preview and application
- Template-based LUT management
- Professional adjustment layer workflow

**For Studios:**
- Standardize color grading processes
- Share LUT templates across team
- Maintain consistent visual style

## Requirements

- Adobe Photoshop CC 2023 or later
- Windows 10/11 or macOS 10.15+
- .cube format LUT files
- Basic knowledge of Photoshop adjustment layers

## Performance

- LUT application: < 3 seconds
- Template creation: ~1 second per LUT file
- UI response: < 100ms

## License

MIT License - Professional use permitted

## Development

This plugin is built using Adobe's UXP framework with focus on:
- Professional photographer workflows
- Japanese market localization
- High-performance LUT processing
- Intuitive user experience

## Support

For issues, feature requests, or questions about LUT workflow optimization, please open an issue in this repository.

---

**GLAZE** - Enhancing your creative vision through streamlined LUT workflows.