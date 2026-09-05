#!/usr/bin/env python3
import zipfile
import os

# Create the XPI file
with zipfile.ZipFile('channel-collections-firefox.xpi', 'w') as zf:
    # Add root level files
    for file in ['manifest.json', 'dashboard.html', 'dashboard.css']:
        if os.path.exists(file):
            zf.write(file)
    
    # Add icons directory
    if os.path.exists('icons'):
        for root, dirs, files in os.walk('icons'):
            for file in files:
                if file.endswith('.png'):
                    file_path = os.path.join(root, file)
                    arcname = os.path.join('icons', file)
                    zf.write(file_path, arcname)
    
    # Add dist directory
    if os.path.exists('dist'):
        for root, dirs, files in os.walk('dist'):
            for file in files:
                if file.endswith('.js'):
                    file_path = os.path.join(root, file)
                    arcname = os.path.join('dist', file)
                    zf.write(file_path, arcname)

print("Extension packaged as channel-collections-firefox.xpi")
