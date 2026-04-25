# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Blast Math, a client-side HTML/JS math tile game. The PostHog CDN snippet was added to `index.html` (loaded via a gitignored `posthog-config.js` config file so keys stay out of source control). Nine targeted `posthog.capture()` calls were inserted into `app.js` covering the full player journey — from game start through tutorial, blasting, level progression, and game over.

| Event | Description | File |
|---|---|---|
| `game_started` | Fired when the user clicks Play and a new game session begins; includes `high_score` | `app.js` |
| `game_over` | Fired when the player loses all lives and returns to the home screen; includes `score`, `high_score`, `level` | `app.js` |
| `life_lost` | Fired each time a life is lost (lives remaining > 0); includes `lives_remaining`, `score` | `app.js` |
| `blast_triggered` | Fired on each successful blast; includes `tiles_cleared`, `score_awarded`, `combo_step` | `app.js` |
| `combo_achieved` | Fired when a chain combo of 2x or higher completes; includes `combo_step`, `total_score_awarded` | `app.js` |
| `level_up` | Fired when the player's score crosses into a new level tier; includes `level`, `score` | `app.js` |
| `new_high_score` | Fired when the player beats their personal best; includes `score`, `previous_high_score` | `app.js` |
| `intro_skipped` | Fired when the Skip button is pressed during the tutorial; includes `intro_step` | `app.js` |
| `intro_completed` | Fired when the player finishes all tutorial steps without skipping | `app.js` |

## Next steps

We've built some insights and a dashboard to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/380550/dashboard/1463745
- **Daily Active Players** (unique players per day via `game_started`): https://us.posthog.com/project/380550/insights/5vsv9N0H
- **Tutorial Completion Funnel** (`game_started` → `intro_completed`): https://us.posthog.com/project/380550/insights/fdDr8QnJ
- **Game Over vs Game Started** (session churn rate): https://us.posthog.com/project/380550/insights/ew9rqjJL
- **Blasts & Combos per Day** (engagement depth): https://us.posthog.com/project/380550/insights/sxuLGT7V
- **High Scores & Level Ups** (skill progression): https://us.posthog.com/project/380550/insights/1AUkoo3E

### Setup notes

- PostHog is initialized via the CDN snippet in `index.html`, reading `window.POSTHOG_API_KEY` and `window.POSTHOG_HOST` from `posthog-config.js`.
- `posthog-config.js` is gitignored — fill it from your `.env` values before running the app locally or deploying.
- All captures use `if (window.posthog)` guards so the app degrades gracefully if PostHog fails to load.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_web/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
