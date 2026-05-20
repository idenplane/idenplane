#!/bin/bash
cd /home/islam/projects/Authme/Authme/packages/idenplane-python
python3 -m mypy idenplane/ --strict 2>&1 | head -100
