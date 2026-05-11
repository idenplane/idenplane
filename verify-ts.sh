#!/bin/bash
cd /home/islam/projects/Authme/Authme/.auto-claude/worktrees/tasks/011-automated-upgrade-migration-tooling
rm -f .claude
npx tsc --noEmit src/upgrade/database-backup.service.ts 2>&1