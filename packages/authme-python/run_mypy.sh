#!/bin/bash
cd /home/islam/projects/Authme/Authme/packages/authme-python
python3 -m mypy authme/ --strict 2>&1 | head -100
