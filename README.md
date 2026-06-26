# Serverless YouTube Movies Database Feed

This repository handles daily ingestion of free-to-watch movies uploaded on YouTube movie channels, cleans up titles, maps them to TMDb metadata, and saves the updates to static JSON files. 

Your React Native mobile client downloads these static JSON files directly from your repository's raw URL (or hosted CDN).

---

## 📁 Repository Structure

* `syncYoutubeMovies.js` - The core synchronization Node.js script.
* `sync_config.json` - Configuration tracking channels, playlist item pagination (`nextPageToken`), and crawl status.
* `movies_all.json` - The master list containing all resolved movies.
* `movies_delta.json` - The rolling delta feed containing the latest 150 added movies.
* `.github/workflows/sync.yml` - Daily workflow task triggering crawler run, matching records, and committing updates automatically.

---

## 🚀 Setup Instructions

Follow these steps to get your automated sync up and running:

### Step 1: Create a Public Repository
Create a new **public** GitHub repository (e.g., `youtube-movies-feed`) and copy all files from the `Temporary` folder into the root of that repository.
*(Note: A public repository allows your mobile app to access the raw JSON files directly without needing any authorization tokens.)*

### Step 2: Configure Repository Secrets
In your new repository, go to **Settings** > **Secrets and variables** > **Actions** > **New repository secret** and add the following:

1. **`YOUTUBE_API_KEYS`** *(Required)*: One or more YouTube Data API v3 keys (separated by commas, spaces, or newlines). The script will rotate them to balance quota load.
2. **`TMDB_API_KEY`** *(Required)*: Your TMDb API key to fetch movie poster paths, original language, year, and genre IDs.
3. **`GROQ_API_KEY`** *(Optional)*: A Groq Cloud API key. If provided, the script uses `llama-3.3-70b-versatile` to clean movie titles accurately. If omitted, the script falls back to custom regular expressions.

### Step 3: Enable Actions Write Permissions
To allow GitHub Actions to commit and push the updated databases back to the repository:
1. Go to **Settings** > **Actions** > **General**.
2. Scroll down to **Workflow permissions**.
3. Select **Read and write permissions**.
4. Click **Save**.

### Step 4: Run the Sync Manually
1. Go to the **Actions** tab in your repository.
2. Select **Daily YouTube Movies Sync** from the left sidebar.
3. Click the **Run workflow** dropdown, and click **Run workflow**.
4. Once completed, you will see `movies_all.json`, `movies_delta.json`, and `sync_config.json` update with populated entries.

---

## 📱 React Native Client Configuration

Once your JSON files are populated, update the raw CDN URLs in your Theater mobile client:

1. Open `src/screens/FreeToWatchScreen.tsx` in your app.
2. Replace the URLs at lines 25–26 with your repository's raw URLs:
   ```typescript
   const CDN_MASTER_URL = 'https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>/main/movies_all.json';
   const CDN_DELTA_URL = 'https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>/main/movies_delta.json';
   ```

*(Example: `https://raw.githubusercontent.com/john-doe/youtube-movies-feed/main/movies_all.json`)*
