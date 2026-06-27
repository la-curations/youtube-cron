const fs = require('fs');
const path = require('path');

// Environment variables
const YOUTUBE_KEYS_RAW = process.env.YOUTUBE_API_KEYS || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// File paths (Relative to root of the new repo)
const CONFIG_PATH = path.join(__dirname, 'sync_config.json');
const MASTER_PATH = path.join(__dirname, 'movies_all.json');
const DELTA_PATH = path.join(__dirname, 'movies_delta.json');

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

// Fetch helper with fetch API
async function makeRequest(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} - ${text}`);
  }
  return res.json();
}

// 1. YouTube API: Fetch playlist items
async function fetchPlaylistItems(playlistId, pageToken = null) {
  const key = getYoutubeKey();
  let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${key}`;
  if (pageToken) {
    url += `&pageToken=${pageToken}`;
  }
  return makeRequest(url);
}

// 1b. YouTube API: Fetch video details batch to get duration
async function fetchVideoDetailsBatch(videoIds) {
  if (videoIds.length === 0) return [];
  const key = getYoutubeKey();
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const idStr = chunk.join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${idStr}&key=${key}`;
    const res = await makeRequest(url);
    if (res.items) {
      results.push(...res.items);
    }
  }
  return results;
}

// Helper to parse ISO 8601 duration to seconds
function parseDurationToSeconds(durationStr) {
  if (!durationStr) return 0;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// 2. Groq AI: Clean YouTube titles in a single batch request
async function cleanTitlesWithAIBatch(videoTitles) {
  if (videoTitles.length === 0) return [];
  if (!GROQ_API_KEY) {
    return videoTitles.map(title => ({
      originalTitle: title,
      title: title,
      year: null,
      language: null
    }));
  }

  try {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a professional movie archivist. Clean a list of YouTube video titles to extract the official movie title, release year, and original language. Suffixes like "Full Movie", "Action Film", "Free Movie", or actor names in parentheses should be stripped. Return a valid JSON object containing an array of objects under the key "movies" in the exact order of the input titles. Format:\n{\n  "movies": [\n    {"title": "Movie Name", "year": 2004, "language": "en"}\n  ]\n}'
        },
        {
          role: 'user',
          content: JSON.stringify(videoTitles)
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

    return videoTitles.map((original, index) => {
      const resolved = parsed.movies && parsed.movies[index];
      return {
        originalTitle: original,
        title: resolved ? resolved.title : original,
        year: resolved ? resolved.year : null,
        language: resolved ? resolved.language : null
      };
    });
  } catch (err) {
    console.warn(`Groq AI batch cleanup failed, falling back to original title:`, err.message);
    return videoTitles.map(title => ({
      originalTitle: title,
      title: title,
      year: null,
      language: null
    }));
  }
}

// 3. TMDb API: Search movie by Title/Year
async function fetchTmdbMetadata(title, year, originalLang) {
  if (!TMDB_API_KEY) {
    throw new Error('Missing TMDB_API_KEY environment variable');
  }

  try {
    // Path B: Title-based search
    if (year) {
      // 1. Try with name + year + lang
      let url1 = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&primary_release_year=${year}`;
      if (originalLang) {
        url1 += `&language=${originalLang}`;
      }
      const res1 = await makeRequest(url1);
      if (res1.results && res1.results.length > 0) {
        return res1.results[0];
      }

      // 2. Try with name + year (ignoring lang)
      const url2 = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&primary_release_year=${year}`;
      const res2 = await makeRequest(url2);
      if (res2.results && res2.results.length > 0) {
        return res2.results[0];
      }

      // 3. Try name only. If results has exactly one row, take it; otherwise skip.
      const url3 = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
      const res3 = await makeRequest(url3);
      if (res3.results && res3.results.length === 1) {
        return res3.results[0];
      }
    } else {
      // AI has no year
      // 1. Try name and lang (if present). If results has exactly one row, take it; otherwise skip.
      let url1 = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
      if (originalLang) {
        url1 += `&language=${originalLang}`;
      }
      const res1 = await makeRequest(url1);
      if (res1.results && res1.results.length === 1) {
        return res1.results[0];
      }
    }

    return null;
  } catch (err) {
    console.error(`TMDb lookup failed for "${title}":`, err.message);
    return null;
  }
}

// Main execution block
async function startSync() {
  console.log('--- STARTING YOUTUBE MOVIE SYNCHRONIZATION ---');

  // 1. Initialize files if they don't exist
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify([
      { channelId: 'UCVFYikepF-avelvuIaQ_lHA', name: 'Popcornflix' },
      { channelId: 'UC8IHAQMuiJdY6ALuhG7iU8Q', name: 'FilmRise Movies' },
      { channelId: 'UCGBzBkV-MinlBvHBzZawfLQ', name: 'Movie Central' }
    ], null, 2));
  }
  if (!fs.existsSync(MASTER_PATH)) {
    fs.writeFileSync(MASTER_PATH, JSON.stringify([], null, 2));
  }

  const channelsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const masterMovies = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));

  // Create active lookup maps for duplicate checks
  const existingYtIds = new Set(masterMovies.map(m => m.ytId));
  const existingTmdbIds = new Set(masterMovies.map(m => m.tmdbId));

  // Determine next auto-increment ID
  let nextId = masterMovies.length > 0 ? Math.max(...masterMovies.map(m => m.id)) + 1 : 1;

  let hasMasterChanges = false;
  let hasConfigChanges = false;

  for (const channel of channelsConfig) {
    console.log(`\nProcessing Channel: ${channel.name} (${channel.channelId})`);

    // Auto-generate uploads playlist ID if missing
    const playlistId = 'UU' + channel.channelId.substring(2);
    channel.nextPageToken = channel.nextPageToken || null;
    channel.isHistoryComplete = channel.isHistoryComplete !== undefined ? channel.isHistoryComplete : false;

    const limitPerPage = channel.limitPerPage || 50;
    let newItemsFound = [];

    // --- PHASE 1: Fetch New Daily Uploads (Page 1 Only) ---
    try {
      console.log('Step 1: Checking for new uploads...');
      const response = await fetchPlaylistItems(playlistId, null);
      const items = response.items || [];

      // If this is a new channel or token is missing, initialize token from Page 1 response
      if (!channel.nextPageToken && !channel.isHistoryComplete) {
        channel.nextPageToken = response.nextPageToken || null;
        if (!response.nextPageToken) {
          channel.isHistoryComplete = true;
        }
        hasConfigChanges = true;
      }

      for (const item of items) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) continue;

        // Stop condition: reach a video we already have mapped
        if (existingYtIds.has(videoId)) {
          console.log(`Reached index point. Stop scanning updates.`);
          break;
        }

        newItemsFound.push(item);
      }
    } catch (err) {
      console.error(`Failed to pull updates for ${channel.name}:`, err.message);
    }

    // --- PHASE 2: Crawl History Backwards (If not complete) ---
    if (!channel.isHistoryComplete && newItemsFound.length === 0) {
      try {
        console.log(`Step 2: Crawling older history (token: ${channel.nextPageToken || 'Start'})...`);
        const response = await fetchPlaylistItems(playlistId, channel.nextPageToken);
        const items = response.items || [];

        for (const item of items) {
          const videoId = item.snippet?.resourceId?.videoId;
          if (!videoId) continue;

          if (!existingYtIds.has(videoId)) {
            newItemsFound.push(item);
          }
        }

        // Save progress token
        const oldToken = channel.nextPageToken;
        channel.nextPageToken = response.nextPageToken || null;

        if (!channel.nextPageToken) {
          channel.isHistoryComplete = true;
          console.log('History crawling has reached the oldest upload!');
        }

        if (oldToken !== channel.nextPageToken || channel.isHistoryComplete) {
          hasConfigChanges = true;
        }
      } catch (err) {
        console.error(`Failed to crawl history for ${channel.name}:`, err.message);
      }
    }

    // --- PHASE 2.5: Filter by Duration (>= 1 hour) ---
    if (newItemsFound.length > 0) {
      console.log(`Checking durations for ${newItemsFound.length} discovered items...`);
      try {
        const videoIds = newItemsFound.map(item => item.snippet?.resourceId?.videoId).filter(Boolean);
        const detailsList = await fetchVideoDetailsBatch(videoIds);
        
        const durationMap = {};
        for (const detail of detailsList) {
          if (detail.id && detail.contentDetails?.duration) {
            durationMap[detail.id] = detail.contentDetails.duration;
          }
        }

        const initialCount = newItemsFound.length;
        newItemsFound = newItemsFound.filter(item => {
          const videoId = item.snippet?.resourceId?.videoId;
          const durationStr = durationMap[videoId];
          const durationSec = parseDurationToSeconds(durationStr);
          return durationSec >= 3600; // 1 hour (3600 seconds)
        });

        const skippedCount = initialCount - newItemsFound.length;
        if (skippedCount > 0) {
          console.log(`Skipped ${skippedCount} videos that are under 1 hour in duration.`);
        }
      } catch (err) {
        console.error(`Failed to filter videos by duration:`, err.message);
      }
    }

    // --- PHASE 3: Clean and Resolve metadata for all discovered movies ---
    if (newItemsFound.length > 0) {
      console.log(`Found ${newItemsFound.length} new items to process.`);
      const processedMovies = [];

      // A. Extract and batch clean all YouTube video titles with AI in one request
      console.log('Batch cleaning YouTube titles using AI...');
      const videoTitles = newItemsFound.map(item => item.snippet?.title || '');
      const cleanedMetaList = await cleanTitlesWithAIBatch(videoTitles);

      for (let i = 0; i < newItemsFound.length; i++) {
        const item = newItemsFound[i];
        const snippet = item.snippet;
        const videoId = snippet?.resourceId?.videoId;
        const videoTitle = snippet?.title;
        const description = snippet?.description;

        if (!videoId || !videoTitle) continue;

        const cleanMeta = cleanedMetaList[i];
        console.log(`  Searching TMDb for: "${cleanMeta.title}" (Original: "${videoTitle}")`);

        // B. TMDb Lookup
        const tmdbData = await fetchTmdbMetadata(cleanMeta.title, cleanMeta.year, cleanMeta.language);

        if (tmdbData) {
          // Check if TMDb ID is already in the database to prevent re-upload duplicates
          if (existingTmdbIds.has(tmdbData.id)) {
            console.log(`    SKIPPED (Duplicate TMDb ID: ${tmdbData.id}): "${tmdbData.title}"`);
            continue;
          }

          console.log(`    MATCHED TMDb: "${tmdbData.title}" (ID: ${tmdbData.id})`);
          processedMovies.push({
            ytId: videoId,
            tmdbId: tmdbData.id,
            title: tmdbData.title,
            poster_path: tmdbData.poster_path,
            genre_ids: tmdbData.genre_ids || [],
            year: tmdbData.release_date ? tmdbData.release_date.split('-')[0] : String(cleanMeta.year || ''),
            original_language: tmdbData.original_language || cleanMeta.language,
            channelName: channel.name,
            addedAt: new Date().toISOString().split('T')[0]
          });
          existingTmdbIds.add(tmdbData.id);
        } else {
          console.log(`    NO MATCH found on TMDb for: "${cleanMeta.title}"`);
        }

        // Delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));
      }

      // Appending and auto-incrementing ID
      if (processedMovies.length > 0) {
        processedMovies.reverse().forEach(movie => {
          movie.id = nextId++;
          masterMovies.unshift(movie); // Prepend to keep sorted by newest ID
          existingYtIds.add(movie.ytId);
        });
        hasMasterChanges = true;
      }
    }
  }

  // 4. Save Master Database & Generate Delta
  if (hasMasterChanges) {
    console.log('\nWriting updates to master database file...');
    fs.writeFileSync(MASTER_PATH, JSON.stringify(masterMovies, null, 2));

    // Generate Delta File (Contains the last 150 movies added)
    console.log('Generating recent updates delta file...');
    const deltaMovies = masterMovies.slice(0, 150);
    fs.writeFileSync(DELTA_PATH, JSON.stringify(deltaMovies, null, 2));
  }

  // 5. Save Sync Config
  if (hasConfigChanges || hasMasterChanges) {
    console.log('Saving synchronization status configurations...');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(channelsConfig, null, 2));
  }

  console.log('\n--- SYNCHRONIZATION COMPLETED SUCCESSFULLY ---');
}

// Start
startSync().catch(err => {
  console.error('Fatal synchronization crash:', err);
  process.exit(1);
});
