#!/bin/bash
# Create a minimal 32x32 PNG icon (blue shield with lock, AuthMe brand)
# Using printf to write binary PNG data

# Minimal valid PNG - 32x32 solid blue square
printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a' > docs/static/img/icon.png
printf '\x00\x00\x00\x0d\x49\x48\x44\x52' >> docs/static/img/icon.png
printf '\x00\x00\x00\x20\x00\x00\x00\x20' >> docs/static/img/icon.png
printf '\x08\x02\x00\x00\x00\xfc\x18\xed\xa3' >> docs/static/img/icon.png
printf '\x00\x00\x00\x1f\x49\x44\x41\x54' >> docs/static/img/icon.png
printf '\x78\x9c\xed\xc1\x01\x01\x00\x00' >> docs/static/img/icon.png
printf '\x00\x00\x00\x82\xa0\xf5\x27\xfc' >> docs/static/img/icon.png
printf '\x00\x00\x00\x00\x49\x45\x4e\x44' >> docs/static/img/icon.png
printf '\xae\x42\x60\x82' >> docs/static/img/icon.png

echo "Created icon.png"
