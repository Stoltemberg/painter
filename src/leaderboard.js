/**
 * Leaderboard Service — Score tracking, team scores, and global leaderboard.
 * Extracted from server.js for modularity.
 */
const fs = require('fs');
const path = require('path');

const TEAMS = ['none', 'red', 'blue', 'green'];
const TEAM_SCORES_FILE = path.join(__dirname, '..', 'team_scores.json');

let teamScores = { red: 0, blue: 0, green: 0 };
let globalLeaderboard = [];

// Dirty score tracking for Supabase sync
const dirtyScores = new Map();

/**
 * Initialize team scores from Supabase or local file.
 * @param {object|null} supabase - Supabase client
 */
async function initTeamScores(supabase) {
    let loaded = false;

    if (supabase) {
        try {
            const { data, error } = await supabase.storage
                .from('pixel-board')
                .download('team_scores.json');

            if (data) {
                const text = await data.text();
                teamScores = JSON.parse(text);
                console.log('Loaded Team Scores from Cloud:', teamScores);
                saveTeamScores();
                loaded = true;
            }
        } catch (err) {
            console.warn('Cloud team scores load failed:', err.message);
        }
    }

    if (!loaded && fs.existsSync(TEAM_SCORES_FILE)) {
        try {
            teamScores = JSON.parse(fs.readFileSync(TEAM_SCORES_FILE, 'utf8'));
            console.log('Loaded Team Scores from local file:', teamScores);
        } catch (err) {
            console.warn('Local team scores parse error:', err.message);
        }
    }
}

/**
 * Save team scores to local file.
 */
function saveTeamScores() {
    try {
        fs.writeFileSync(TEAM_SCORES_FILE, JSON.stringify(teamScores));
    } catch (err) {
        console.error('Team scores save error:', err.message);
    }
}

/**
 * Add score to a team.
 * @param {string} team - Team name (red, blue, green)
 * @param {number} count - Number of pixels to add
 */
function addTeamScore(team, count = 1) {
    if (teamScores[team] !== undefined) {
        teamScores[team] += count;
    }
}

/**
 * Update the global leaderboard with a player's score.
 * @param {string} name - Player name
 * @param {number} score - Total pixel count
 * @param {string} guestId - Unique guest identifier
 */
function updateGlobalLeaderboard(name, score, guestId) {
    const existingIndex = globalLeaderboard.findIndex(p => p.guestId === guestId || p.name === name);

    if (existingIndex !== -1) {
        globalLeaderboard[existingIndex].score = score;
        globalLeaderboard[existingIndex].name = name;
    } else {
        globalLeaderboard.push({ name, score, guestId });
    }

    globalLeaderboard.sort((a, b) => b.score - a.score);
    if (globalLeaderboard.length > 10) globalLeaderboard.length = 10;
}

/**
 * Sync dirty scores to Supabase (called on interval).
 * @param {object|null} supabase - Supabase client
 */
async function syncScores(supabase) {
    if (!supabase || dirtyScores.size === 0) return;

    const entries = [...dirtyScores.values()];
    dirtyScores.clear();

    try {
        const { error } = await supabase
            .from('leaderboard')
            .upsert(entries, { onConflict: 'id' });

        if (error) {
            console.error('Leaderboard sync error:', error.message);
            // Re-queue on failure
            entries.forEach(e => dirtyScores.set(e.id, e));
        }
    } catch (err) {
        console.error('Leaderboard sync failed:', err.message);
        entries.forEach(e => dirtyScores.set(e.id, e));
    }
}

/**
 * Broadcast leaderboard as legacy format (for non-Supabase setups).
 * @param {object} io - Socket.IO server instance
 * @param {Map} socketStates - Map of socket states
 */
function broadcastLeaderboardLegacy(io, socketStates) {
    const scores = [];
    for (const [sid, state] of socketStates) {
        if (state.pixelScore > 0) {
            scores.push({
                name: state.name || 'Guest',
                score: state.pixelScore
            });
        }
    }
    scores.sort((a, b) => b.score - a.score);
    io.emit('leaderboard', scores.slice(0, 10));
}

module.exports = {
    TEAMS,
    get teamScores() { return teamScores; },
    get globalLeaderboard() { return globalLeaderboard; },
    get dirtyScores() { return dirtyScores; },
    initTeamScores,
    saveTeamScores,
    addTeamScore,
    updateGlobalLeaderboard,
    syncScores,
    broadcastLeaderboardLegacy,
};
