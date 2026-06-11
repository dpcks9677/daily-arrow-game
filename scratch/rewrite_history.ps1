$ErrorActionPreference = "Stop"

# Create a temporary branch to backup current state
git branch temp main

# Checkout the good commit before the merge
git checkout be434de

# Cherry pick the two hotfix commits
git cherry-pick 48cb503
git cherry-pick 81bd745

# Move tags to the new commits (they will have new hashes because of cherry-pick)
git tag -f v.0.7.1-hotfix.1 HEAD~1
git tag -f v.0.7.1-hotfix.2 HEAD

# Update main branch to the new HEAD
git branch -f main HEAD
git checkout main

# Force push to remote to clean up the graph
git push -f origin main

# Delete the temporary backup branch
git branch -D temp
