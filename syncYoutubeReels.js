const fs = require('fs');
const path = require('path');

// Auto-load .env file if running locally
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/(^["']|["']$)/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

// Environment variables
const YOUTUBE_KEYS_RAW = process.env.YOUTUBE_API_KEYS || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// File paths
const CONFIG_PATH = path.join(__dirname, 'sync_config.json');
const MASTER_PATH = path.join(__dirname, 'movies_all.json');
const REELS_PATH = path.join(__dirname, 'reels.json');

// Max reels to store (FIFO rolling window)
const MAX_REELS_COUNT = 200;

// Parse YouTube API Keys for rotation
const youtubeKeys = YOUTUBE_KEYS_RAW.split(/[\s,;\n]+/)
  .map(k => k.trim())
  .filter(Boolean);

// Pick a random YouTube API key to balance quota
function getYoutubeKey() {
  if (youtubeKeys.length === 0) {
    throw new Error('Missing YOUTUBE_API_KEYS environment variable');
  }
  return youtubeKeys[Math.floor(Math.random() * youtubeKeys.length)];
}

// Fetch helper with timeout
async function makeRequest(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} - ${text}`);
  }
  return res.json();
}

// 1. YouTube API: Fetch playlist items (uploads) with pagination
async function fetchPlaylistItems(playlistId, pageToken = null, maxResults = 50) {
  const key = getYoutubeKey();
  let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${playlistId}&key=${key}`;
  if (pageToken) {
    url += `&pageToken=${pageToken}`;
  }
  return makeRequest(url);
}

// 2. YouTube API: Fetch video details to verify duration (Shorts <= 60s)
async function fetchVideoDetailsBatch(videoIds) {
  if (videoIds.length === 0) return [];
  const key = getYoutubeKey();
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const idStr = chunk.join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${idStr}&key=${key}`;
    const res = await makeRequest(url);
    if (res.items) {
      results.push(...res.items);
    }
  }
  return results;
}

// Parse ISO 8601 duration to seconds
function parseDurationToSeconds(durationStr) {
  if (!durationStr) return 0;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// Clean boilerplate and extract high-signal snippet from Description (Zero-token filter)
function extractHighSignalSnippet(title, description = '') {
  // Strip URLs
  let text = (description || '').replace(/https?:\/\/\S+/gi, '');

  // Strip common YouTube boilerplate lines
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      const lower = l.toLowerCase();
      if (lower.includes('subscribe') || lower.includes('copyright disclaimer') || lower.includes('follow us') || lower.includes('download our app')) {
        return false;
      }
      return true;
    });

  // Extract movie-identifying lines or top 2 lines
  const keyLines = lines.filter(l => {
    const lower = l.toLowerCase();
    return (
      lower.includes('movie:') ||
      lower.includes('film:') ||
      lower.includes('cinema:') ||
      lower.includes('starring:') ||
      lower.includes('cast:') ||
      lower.includes('scene from:') ||
      lower.includes('#')
    );
  });

  const selectedSnippet = (keyLines.length > 0 ? keyLines.slice(0, 3) : lines.slice(0, 2)).join(' ');
  return `${title} | ${selectedSnippet}`.slice(0, 250);
}

// 3. Match against existing master database (0 tokens)
function matchAgainstMasterCatalog(title, description, masterMovies) {
  const combinedText = `${title} ${description}`.toLowerCase();

  for (const movie of masterMovies) {
    if (!movie.title || movie.title.length < 3) continue;
    const movieTitleLower = movie.title.toLowerCase();

    // Regex check on word boundaries
    const regex = new RegExp(`\\b${movieTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(combinedText)) {
      return movie;
    }
  }
  return null;
}

// 4. Groq AI: Clean short snippet to extract movie title in batches
async function extractMovieTitleWithAIBatch(items) {
  if (items.length === 0) return [];
  if (!GROQ_API_KEY) {
    return items.map(item => ({
      title: item.title,
      year: null,
      language: null
    }));
  }

  try {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'qwen/qwen3.6-27b',
      messages: [
        {
          role: 'system',
          content: 'You are an expert movie archivist. Given short YouTube video title snippets and hashtags from movie clips/shorts (e.g. "#billymadison", "#Vikram", "Billy tries to find out if his teacher is single"), identify and extract the official movie title (e.g. "Billy Madison"), release year (e.g. 1995), and original language ("en"). Suffixes like "scene", "funny clip", "4k", "status", "shorts" should be ignored. Return a valid JSON object with key "movies" matching the input array order:\n{\n  "movies": [\n    {"title": "Movie Name", "year": 1995, "language": "en"}\n  ]\n}'
        },
        {
          role: 'user',
          content: JSON.stringify(items.map(it => it.snippetText))
        }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    };

    const res = await makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const content = res.choices[0].message.content.trim();
    const parsed = JSON.parse(content);

    return items.map((orig, index) => {
      const resolved = parsed.movies && parsed.movies[index];
      return {
        title: resolved?.title || orig.title,
        year: resolved?.year || null,
        language: resolved?.language || null
      };
    });
  } catch (err) {
    console.warn(`Groq AI batch cleanup failed:`, err.message);
    return items.map(item => ({
      title: item.title,
      year: null,
      language: null
    }));
  }
}

// 5. TMDb API: Search movie metadata
async function fetchTmdbMetadata(title, year, originalLang) {
  if (!TMDB_API_KEY || !title) return null;

  const cleanTitle = title.replace(/[#@]/g, '').trim();

  try {
    let url = `https://api.tmdb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`;
    if (year) url += `&primary_release_year=${year}`;
    if (originalLang) url += `&language=${originalLang}`;

    let res = await makeRequest(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.results && res.results.length > 0) {
      return res.results[0];
    }

    // Fallback without year or lang
    if (year || originalLang) {
      const fallbackUrl = `https://api.tmdb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`;
      res = await makeRequest(fallbackUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.results && res.results.length > 0) {
        return res.results[0];
      }
    }
    return null;
  } catch (err) {
    console.error(`TMDb lookup failed for "${title}":`, err.message);
    return null;
  }
}

// Main execution function
async function syncReels() {
  console.log('=== STARTING YOUTUBE REELS / SHORTS SYNC ===');

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('sync_config.json not found!');
    return;
  }

  const channelsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const masterMovies = fs.existsSync(MASTER_PATH) ? JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8')) : [];
  let existingReels = fs.existsSync(REELS_PATH) ? JSON.parse(fs.readFileSync(REELS_PATH, 'utf8')) : [];

  const existingYtIds = new Set(existingReels.map(r => r.ytId));
  const newReelsFound = [];
  // Create lookup structures from master movies
  const masterTmdbIds = new Set(masterMovies.map(m => m.tmdbId).filter(Boolean));
  const masterTitles = new Map(masterMovies.map(m => [m.title.toLowerCase().trim(), m]));

  for (const channel of channelsConfig) {
    if (newReelsFound.length + existingReels.length >= MAX_REELS_COUNT) {
      console.log(`Reached maximum reels capacity (${MAX_REELS_COUNT}).`);
      break;
    }

    console.log(`\nScanning channel: ${channel.name} (${channel.channelId})`);
    const playlistId = 'UU' + channel.channelId.substring(2);

    let pageToken = null;
    let pageCount = 0;
    const MAX_PAGES_PER_CHANNEL = 4;

    while (pageCount < MAX_PAGES_PER_CHANNEL && (newReelsFound.length + existingReels.length) < MAX_REELS_COUNT) {
      pageCount++;
      try {
        console.log(`  Fetching page ${pageCount} (token: ${pageToken || 'Start'})...`);
        const playlistRes = await fetchPlaylistItems(playlistId, pageToken, 50);
        const items = playlistRes.items || [];
        if (items.length === 0) break;

        // Collect video IDs
        const videoIds = items
          .map(it => it.snippet?.resourceId?.videoId)
          .filter(id => id && !existingYtIds.has(id));

        if (videoIds.length > 0) {
          // Fetch duration & snippet
          const details = await fetchVideoDetailsBatch(videoIds);

          // Filter Shorts (duration <= 65s)
          const shortsItems = details.filter(d => {
            const durationSec = parseDurationToSeconds(d.contentDetails?.duration);
            return durationSec > 0 && durationSec <= 65;
          });

          console.log(`  Found ${shortsItems.length} new shorts out of ${videoIds.length} videos on page ${pageCount}.`);

          // Separate items into: matched by master catalog vs needs AI
          const pendingAI = [];

          for (const item of shortsItems) {
            const title = item.snippet?.title || '';
            const desc = item.snippet?.description || '';
            const ytId = item.id;

            // Try direct master catalog match (0 tokens)
            const masterMatch = matchAgainstMasterCatalog(title, desc, masterMovies);

            if (masterMatch) {
              console.log(`  [0-Token Match] "${title}" -> ${masterMatch.title} (${masterMatch.tmdbId})`);
              const posterUrl = masterMatch.poster_path ? (masterMatch.poster_path.startsWith('http') ? masterMatch.poster_path : `https://image.tmdb.org/t/p/w500${masterMatch.poster_path}`) : `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
              newReelsFound.push({
                id: masterMatch.tmdbId || ytId,
                tmdbId: masterMatch.tmdbId || null,
                movieKey: String(masterMatch.tmdbId || masterMatch.title.toLowerCase().trim()),
                title: masterMatch.title,
                overview: masterMatch.overview || '',
                poster_path: posterUrl,
                release_date: masterMatch.release_date || (masterMatch.year ? `${masterMatch.year}-01-01` : ''),
                original_language: masterMatch.original_language || 'en',
                type: 'movie',
                ytId: ytId,
                channelName: channel.name,
                createdAt: item.snippet?.publishedAt || new Date().toISOString()
              });
              existingYtIds.add(ytId);
            } else {
              // Prepare for AI batch
              pendingAI.push({
                item,
                ytId,
                title,
                desc,
                channelName: channel.name,
                snippetText: extractHighSignalSnippet(title, desc)
              });
            }
          }

          // Batch process non-matched shorts with AI
          if (pendingAI.length > 0) {
            console.log(`  Processing ${pendingAI.length} shorts with Groq AI in batch...`);
            const aiResults = await extractMovieTitleWithAIBatch(pendingAI);

            for (let i = 0; i < pendingAI.length; i++) {
              const p = pendingAI[i];
              const ai = aiResults[i];

              // Check if AI title or TMDB result is in movies_all.json
              let matchedMaster = null;
              const cleanAiTitle = (ai.title || '').toLowerCase().trim();
              if (masterTitles.has(cleanAiTitle)) {
                matchedMaster = masterTitles.get(cleanAiTitle);
              }

              // Fetch TMDB metadata
              const tmdb = await fetchTmdbMetadata(ai.title, ai.year, ai.language);
              if (!matchedMaster && tmdb?.id && masterTmdbIds.has(tmdb.id)) {
                matchedMaster = masterMovies.find(m => m.tmdbId === tmdb.id);
              }

              // Rule: Must be present in movies_all.json
              if (!matchedMaster) {
                console.log(`  [Skipped - Not in movies_all.json] "${p.title}" -> "${ai.title}"`);
                continue;
              }

              console.log(`  [AI Matched to Master] "${p.title}" -> "${matchedMaster.title}" (${matchedMaster.tmdbId})`);

              const posterUrl = matchedMaster.poster_path
                ? (matchedMaster.poster_path.startsWith('http') ? matchedMaster.poster_path : `https://image.tmdb.org/t/p/w500${matchedMaster.poster_path}`)
                : (tmdb?.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : `https://img.youtube.com/vi/${p.ytId}/hqdefault.jpg`);

              newReelsFound.push({
                id: matchedMaster.tmdbId || tmdb?.id || p.ytId,
                tmdbId: matchedMaster.tmdbId || tmdb?.id || null,
                movieKey: String(matchedMaster.tmdbId || matchedMaster.title.toLowerCase().trim()),
                title: matchedMaster.title,
                overview: matchedMaster.overview || tmdb?.overview || '',
                poster_path: posterUrl,
                release_date: matchedMaster.release_date || tmdb?.release_date || (ai.year ? `${ai.year}-01-01` : ''),
                original_language: matchedMaster.original_language || tmdb?.original_language || ai.language || 'en',
                type: 'movie',
                ytId: p.ytId,
                channelName: p.channelName,
                createdAt: p.item.snippet?.publishedAt || new Date().toISOString()
              });
              existingYtIds.add(p.ytId);
            }
          }
        }

        pageToken = playlistRes.nextPageToken;
        if (!pageToken) break;
      } catch (err) {
        console.error(`Error scanning channel ${channel.name} page ${pageCount}:`, err.message);
        break;
      }
    }
  }

  // Combine new and existing reels with Max 2 reels per movie + middle distribution
  const allReels = [...newReelsFound, ...existingReels];
  const movieCountMap = new Map();
  const primaryReels = [];
  const secondaryReels = [];

  for (const reel of allReels) {
    const key = reel.movieKey || String(reel.tmdbId || reel.title.toLowerCase().trim());
    const count = movieCountMap.get(key) || 0;

    if (count === 0) {
      primaryReels.push(reel);
      movieCountMap.set(key, 1);
    } else if (count === 1) {
      secondaryReels.push(reel);
      movieCountMap.set(key, 2);
    }
    // count >= 2 is skipped (max 2 per movie)
  }

  // Place 2nd reel of a movie in the middle / second half of the array
  const half = Math.floor(primaryReels.length / 2);
  const mergedReels = [
    ...primaryReels.slice(0, half),
    ...secondaryReels,
    ...primaryReels.slice(half)
  ].slice(0, MAX_REELS_COUNT);

  // Clean helper key before saving
  const finalReels = mergedReels.map(({ movieKey, ...rest }) => rest);

  console.log(`\nTotal verified reels in library: ${finalReels.length} (Primary: ${primaryReels.length}, Secondary: ${secondaryReels.length})`);
  fs.writeFileSync(REELS_PATH, JSON.stringify(finalReels, null, 2));
  console.log(`Saved ${finalReels.length} reels to reels.json (max ${MAX_REELS_COUNT}).`);
  console.log('=== YOUTUBE REELS SYNC COMPLETE ===');
}

syncReels();
