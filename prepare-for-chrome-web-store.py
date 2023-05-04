import json

with open('manifest.json') as f:
    manifest = json.load(f)

# Remove input_view and indicator
for component in manifest['input_components']:
    component.pop('input_view')
    component.pop('indicator')

# Remove private permissions
manifest['permissions'] = [p for p in manifest['permissions'] if not p.endswith('Private')]

# Remove key 
manifest.pop('key')

with open('manifest.json', 'w') as f:
    json.dump(manifest, f, indent=4)