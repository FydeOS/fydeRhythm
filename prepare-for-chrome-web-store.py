#!/usr/bin/env python3
"""
Prepare the extension manifest for Chrome Web Store submission.

This script modifies the manifest.json to be compatible with Chrome Web Store:
1. Removes input_view and indicator from input_components (not supported)
2. Removes private permissions (virtualKeyboardPrivate, inputMethodPrivate)
3. Removes key and update_url (not allowed in Web Store)
"""
import json
import sys
from pathlib import Path

def prepare_manifest_for_webstore(manifest_path: Path):
    """Modify manifest.json for Chrome Web Store compatibility."""

    # Read manifest
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    # Remove input_view and indicator from input_components
    # Chrome Web Store doesn't support custom virtual keyboards
    if 'input_components' in manifest:
        for component in manifest['input_components']:
            component.pop('input_view', None)
            component.pop('indicator', None)

    # Remove private permissions
    # virtualKeyboardPrivate and inputMethodPrivate are not available on Web Store
    if 'permissions' in manifest:
        manifest['permissions'] = [
            p for p in manifest['permissions']
            if not p.endswith('Private')
        ]

    # Remove key (used for unpacked extensions, not for Web Store)
    manifest.pop('key', None)

    # Remove update_url (managed by Chrome Web Store)
    manifest.pop('update_url', None)

    # Write modified manifest
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Add trailing newline

    print(f"✓ Prepared manifest at {manifest_path} for Chrome Web Store")
    print("  - Removed input_view and indicator from input_components")
    print("  - Removed private permissions")
    print("  - Removed key and update_url fields")

if __name__ == '__main__':
    manifest_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('manifest.json')

    if not manifest_file.exists():
        print(f"Error: {manifest_file} not found", file=sys.stderr)
        sys.exit(1)

    prepare_manifest_for_webstore(manifest_file)
