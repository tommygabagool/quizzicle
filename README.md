# Get Quizzicle — Score Tracker

Trivia score tracker for Get Quizzicle. Built with React + Vite.

## Local Dev

```bash
npm install
npm run dev
```

Opens at http://localhost:5173/quizzicle/

## Deploy to GitHub Pages

### First time setup

1. Create a repo on GitHub named `quizzicle` (or update `base` in `vite.config.js` to match your repo name)

2. Add the homepage field — open `package.json` and update:
   ```json
   "homepage": "https://YOUR_GITHUB_USERNAME.github.io/quizzicle"
   ```

3. Push your code:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/quizzicle.git
   git push -u origin main
   ```

4. Deploy:
   ```bash
   npm run deploy
   ```

This builds the app and pushes the `dist/` folder to the `gh-pages` branch automatically.

### Subsequent deploys

```bash
npm run deploy
```

That's it. Live at: `https://YOUR_USERNAME.github.io/quizzicle/`

---

## Excel Import Format

One workbook per venue. Sheet naming:

**Game night sheets** — named `"Month Day"` e.g. `April 7`

| Team | R1 | R2 | R3 | R4 | R5 | Bonus | POTW | QOD |
|------|----|----|----|----|----|-------|------|-----|
| Quiz Khalifa | 8 | 7 | 9 | 6 | 8 | 5 | 2 | 1 |

**Season leaderboard sheet** — named anything with "Season", "Leader", "Board", or "Standing"

| Team | April 7 | April 14 | Total |
|------|---------|----------|-------|
| Quiz Khalifa | 46 | 51 | 97 |

## Data Persistence

All data is saved to `localStorage` in your browser. Clearing browser data will reset the app. For true persistence, a Supabase backend can be wired in.
