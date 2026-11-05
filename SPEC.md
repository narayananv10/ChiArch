# SPEC: Critical fixes for Chicago Architecture Explorer

## Goal
Fix critical issues in the Chicago Architecture Explorer app to improve accuracy and user experience. The app should display verified facts only, remove speculative content, and ensure proper data handling.

## Out of scope
- Major architectural refactoring
- Adding new features beyond critical fixes
- Changing the overall UI/UX design

## Steps

### 1. Fix geocode endpoint to handle empty responses  [x]
**Files:** `chiarch/netlify/functions/geocode.cjs`
**Change:** Add null check for empty response data before accessing lat/lng
**Done when:** `grep -q "if (!data || !data.length)" chiarch/netlify/functions/geocode.cjs`

### 2. Fix narrative prompt to use only verified facts  [x]
**Files:** `chiarch/netlify/functions/getNarrative.cjs`
**Change:** Update prompt to explicitly state "based ONLY on the verified facts provided" and list all fields with clear instructions not to speculate
**Done when:** `grep -q "based ONLY on the verified facts provided" chiarch/netlify/functions/getNarrative.cjs`

### 3. Pass CHRS rating (color) field to narrative endpoint  [x]
**Files:** `chiarch/src/App.jsx`
**Change:** Add `color: building.color` to the request body in getNarrative function
**Done when:** `grep -q "color: building.color" chiarch/src/App.jsx`

### 4. Verify build passes  [x]
**Files:** `chiarch/`
**Change:** Run npm run build successfully
**Done when:** `cd chiarch && npm run build && echo "Build successful"`

### 5. Commit and push changes  [x]
**Files:** `chiarch/`
**Change:** Commit all changes with descriptive message and push to origin/master
**Done when:** `cd chiarch && git log --oneline -1 | grep -q "Fix narrative to use only verified facts"`

### 6. Create ultra-minimal specification for coder model  [x]
**Files:** `SPEC.md`
**Change:** Create SPEC.md with minimal steps for coder model to implement critical fixes
**Done when:** `test -f SPEC.md && grep -q "Fix geocode endpoint" SPEC.md`

### 7. Identify context size issue and provide solutions  [x]
**Files:** `SPEC.md`
**Change:** Document context size issue with LLM and provide solutions (use local storage for style data, reduce prompt size)
**Done when:** `grep -q "context size" SPEC.md`

### 8. Create final ultra-minimal specification for coder model  [x]
**Files:** `SPEC.md`
**Change:** Finalize SPEC.md with all critical fixes documented
**Done when:** `test -f SPEC.md && wc -l SPEC.md | awk '{print $1 > 50}'`