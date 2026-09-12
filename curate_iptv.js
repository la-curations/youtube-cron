const fs = require('fs');
const path = require('path');

// Friendly category mapping
const CATEGORY_MAP = {
  news: 'News',
  business: 'News',
  weather: 'News',
  legislative: 'News',
  sports: 'Sports',
  auto: 'Sports',
  movies: 'Movies',
  classic: 'Movies',
  comedy: 'Entertainment',
  entertainment: 'Entertainment',
  series: 'Movies',
  documentary: 'Documentary',
  science: 'Documentary',
  travel: 'Documentary',
  music: 'Music',
  animation: 'Animation & Anime',
  kids: 'Kids & Family',
  family: 'Kids & Family',
};

// Descriptions for known channels
const DESCRIPTIONS = {
  'BloombergTV.us': '24/7 global business, finance, stock market data, and breaking economic news.',
  'EuronewsEnglish.fr': 'All the latest European and world news, culture, and business in English.',
  'NBCNewsNOW.us': 'Live breaking news, in-depth reporting, and news headlines from NBC News 24/7.',
  'WION.in': 'World Is One News: Global news stories with unbiased South Asian perspective.',
  'CNA.sg': 'Channel NewsAsia: 24-hour Asian news network covering global and regional affairs.',
  'NHKWorldJapan.jp': 'English-language international broadcasting service from Japanese public broadcaster NHK.',
  'TRTWorld.tr': 'International news channel broadcasting from Istanbul, London, Washington, and Singapore.',
  'ArirangTV.kr': 'Korea\'s premier global TV network providing Korean culture, news, and entertainment.',
  'RedBullTV.at': 'High-octane action sports, extreme adventures, live music festivals, and sports films.',
  'WorldPokerTour.us': 'High-stakes poker action, tournament highlights, and player insights from the WPT.',
  'SportsGrid.us': '24/7 live sports betting insights, odds analysis, game stats, and real-time coverage.',
  'OutdoorChannel.us': 'Outdoor adventures, hunting, fishing, and off-road expeditions.',
  'FuboSportsNetwork.us': 'Live sports coverage, original programming, and behind-the-scenes athlete stories.',
  'Pac12Insider.us': 'Collegiate athletics, football, basketball highlights, and student-athlete features.',
  'PursuitChannel.us': 'Hunting, fishing, and outdoor recreation entertainment across North America.',
  'CinevaultWesterns.us': 'Classic Western films, cowboys, gunfights, and timeless cinema legends.',
  'MidnightPulp.us': 'Cult films, midnight movies, action cinema, horror, and bizarre retro classics.',
  'RetroCrush.us': 'The golden age of anime: classic mecha, sci-fi, and vintage anime series from the 70s-90s.',
  'ShoutFactoryTV.us': 'Classic TV series, cult cinema, mystery science theater, and pop-culture marathons.',
  'AsianCrush.us': 'Popular Asian cinema, blockbuster martial arts, dramas, thrillers, and award-winning films.',
  'MagellanTVNow.us': 'Premium documentaries exploring space, history, science, crime, and natural wonders.',
  'WildEarth.za': 'Live African safari drives, wildlife conservation, and real-time nature streaming.',
  'ToonGoggles.us': 'Safe, family-friendly animation, cartoons, and fun kids educational shows.',
  'KartoonChannel.us': 'Top-tier animated adventures, comedy cartoons, and superhero series for all ages.',
  'SkyNews.uk': 'First for breaking news, video, audio and headlines from the UK and around the world.',
  'AlJazeeraEnglish.qa': 'Global news from a distinct perspective, in-depth reports, and human stories.',
  'NASATVPublic.us': 'Live rocket launches, space station views, spacewalks, and NASA astronomy discoveries.',
  'DWNews.de': 'Deutsche Welle: German and international news, documentaries, and global insights.',
  'France24English.fr': 'International news channel based in Paris providing global perspectives 24/7.',
  'FilmRiseFreeMovies.us': 'Blockbuster Hollywood films, indie favorites, and star-studded cinema classics.',
  'Dust.us': 'Thought-provoking sci-fi short films, futuristic stories, and high-concept fiction.',
  'ClubbingTV.fr': 'The world\'s #1 electronic music channel: DJ sets, festivals, EDM, and dance culture.',
  'DeluxeLoungeHD.de': 'Smooth ambient sounds, chill lounge music, and stunning scenic landscapes.',
  'LoFiGirl.live': '24/7 lofi hip hop radio - beats to relax/study to.',
};

// YouTube-based 24/7 Live streams that are extremely stable and high-quality
const YOUTUBE_LIVE_CHANNELS = [
  {
    id: 'sky-news-live',
    name: 'Sky News',
    category: 'news',
    categoryName: 'News',
    country: 'GB',
    language: 'en',
    logo: 'https://i.imgur.com/G5yNfJd.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=9Auq9mYxFEE',
    ytId: '9Auq9mYxFEE',
    epgId: 'SkyNews.uk',
    description: DESCRIPTIONS['SkyNews.uk'],
    quality: '1080p',
    featured: true,
    is24_7: true,
    website: 'https://news.sky.com/',
  },
  {
    id: 'al-jazeera-live',
    name: 'Al Jazeera English',
    category: 'news',
    categoryName: 'News',
    country: 'QA',
    language: 'en',
    logo: 'https://i.imgur.com/fD0vL7M.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=gCNeDWCI0vo',
    ytId: 'gCNeDWCI0vo',
    epgId: 'AlJazeeraEnglish.qa',
    description: DESCRIPTIONS['AlJazeeraEnglish.qa'],
    quality: '1080p',
    featured: true,
    is24_7: true,
    website: 'https://www.aljazeera.com/',
  },
  {
    id: 'nasa-tv-live',
    name: 'NASA TV',
    category: 'documentary',
    categoryName: 'Documentary',
    country: 'US',
    language: 'en',
    logo: 'https://i.imgur.com/gK2JkWJ.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=21X5lGlDOfg',
    ytId: '21X5lGlDOfg',
    epgId: 'NASATVPublic.us',
    description: DESCRIPTIONS['NASATVPublic.us'],
    quality: '1080p',
    featured: true,
    is24_7: true,
    website: 'https://www.nasa.gov/nasatv',
  },
  {
    id: 'dw-news-live',
    name: 'DW News',
    category: 'news',
    categoryName: 'News',
    country: 'DE',
    language: 'en',
    logo: 'https://i.imgur.com/OqG32uA.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=v_b_vS5WbYs',
    ytId: 'v_b_vS5WbYs',
    epgId: 'DWNews.de',
    description: DESCRIPTIONS['DWNews.de'],
    quality: '1080p',
    featured: false,
    is24_7: true,
    website: 'https://www.dw.com/',
  },
  {
    id: 'france-24-live',
    name: 'France 24 English',
    category: 'news',
    categoryName: 'News',
    country: 'FR',
    language: 'en',
    logo: 'https://i.imgur.com/qLwRkZy.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=h3MuIUNCCzI',
    ytId: 'h3MuIUNCCzI',
    epgId: 'France24English.fr',
    description: DESCRIPTIONS['France24English.fr'],
    quality: '1080p',
    featured: false,
    is24_7: true,
    website: 'https://www.france24.com/en/',
  },
  {
    id: 'lofi-girl-live',
    name: 'Lofi Girl 24/7',
    category: 'music',
    categoryName: 'Music',
    country: 'FR',
    language: 'en',
    logo: 'https://i.imgur.com/uRj0p1w.png',
    streamType: 'youtube',
    streamUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    ytId: 'jfKfPfyJRdk',
    epgId: 'LoFiGirl.live',
    description: DESCRIPTIONS['LoFiGirl.live'],
    quality: '1080p',
    featured: true,
    is24_7: true,
    website: 'https://lofigirl.com/',
  },
];

async function testStream(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Fetching channels, streams, and logos from iptv-org API...');

  const [channelsRes, streamsRes, logosRes] = await Promise.all([
    fetch('https://iptv-org.github.io/api/channels.json').then(r => r.json()),
    fetch('https://iptv-org.github.io/api/streams.json').then(r => r.json()),
    fetch('https://iptv-org.github.io/api/logos.json').then(r => r.json()),
  ]);

  console.log(
    `Loaded ${channelsRes.length} channels, ${streamsRes.length} streams, ${logosRes.length} logos.`
  );

  const logosMap = new Map();
  for (const l of logosRes) {
    if (l.channel && l.url && !logosMap.has(l.channel)) {
      logosMap.set(l.channel, l.url);
    }
  }

  const streamsMap = new Map();
  for (const s of streamsRes) {
    if (s.channel && s.url && s.url.startsWith('http')) {
      if (!streamsMap.has(s.channel)) {
        streamsMap.set(s.channel, []);
      }
      streamsMap.get(s.channel).push(s);
    }
  }

  // Premier target channel IDs across all key categories
  const TARGET_IDS = [
    // News & Business
    'BloombergTV.us',
    'EuronewsEnglish.fr',
    'NBCNewsNOW.us',
    'WION.in',
    'CNA.sg',
    'NHKWorldJapan.jp',
    'TRTWorld.tr',
    'ArirangTV.kr',
    'Reuters.us',
    'ScrippsNews.us',
    'CBCNewsExplore.ca',
    // Sports & Extreme
    'RedBullTV.at',
    'WorldPokerTour.us',
    'SportsGrid.us',
    'OutdoorChannel.us',
    'FuboSportsNetwork.us',
    'Pac12Insider.us',
    'PursuitChannel.us',
    'MAVTVSelect.us',
    'FightNetwork.us',
    'EdgeSport.us',
    'ESTV.us',
    // Movies & Cult Cinema
    'CinevaultWesterns.us',
    'MidnightPulp.us',
    'RetroCrush.us',
    'ShoutFactoryTV.us',
    'AsianCrush.us',
    'FilmRiseFreeMovies.us',
    'Dust.us',
    'Alter.us',
    'MovieCentral.ca',
    'GravitasMovies.us',
    'WesternMania.us',
    // Documentary & Nature
    'MagellanTVNow.us',
    'WildEarth.za',
    'DocuBay.in',
    'RealStories.uk',
    'Timeline.uk',
    // Music
    'ClubbingTV.fr',
    'DeluxeLoungeHD.de',
    'StingrayCMusic.ca',
    'KEXPTV.us',
    'QelloConcerts.us',
    // Animation & Kids
    'ToonGoggles.us',
    'KartoonChannel.us',
    'DuckTV.sk',
  ];

  const candidates = [];

  for (const premierId of TARGET_IDS) {
    const channelInfo = channelsRes.find(c => c.id === premierId);
    if (!channelInfo) continue;

    const streams = streamsMap.get(premierId) || [];
    if (streams.length === 0) continue;

    const bestStream =
      streams.find(s => s.quality === '1080p') ||
      streams.find(s => s.quality === '720p') ||
      streams[0];

    const rawCategory = channelInfo.categories?.[0] || 'general';
    const normalizedCategory = ['news', 'sports', 'movies', 'documentary', 'music', 'animation'].includes(rawCategory)
      ? rawCategory
      : (CATEGORY_MAP[rawCategory] || 'entertainment').toLowerCase();

    candidates.push({
      id: premierId.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: channelInfo.name,
      category: normalizedCategory,
      categoryName: CATEGORY_MAP[normalizedCategory] || channelInfo.name,
      country: channelInfo.country,
      language: channelInfo.languages?.[0] || 'en',
      logo: logosMap.get(premierId) || null,
      streamType: 'hls',
      streamUrl: bestStream.url,
      epgId: premierId,
      description: DESCRIPTIONS[premierId] || `${channelInfo.name} live 24/7 broadcast.`,
      quality: bestStream.quality || 'Auto',
      featured: [
        'BloombergTV.us',
        'RedBullTV.at',
        'RetroCrush.us',
        'MagellanTVNow.us',
        'ShoutFactoryTV.us',
      ].includes(premierId),
      is24_7: !bestStream.labels?.includes('Not 24/7'),
      website: channelInfo.website,
    });
  }

  console.log(`Testing ${candidates.length} candidate streams...`);
  const verifiedHls = [];
  for (const ch of candidates) {
    process.stdout.write(`Testing ${ch.name}... `);
    const isLive = await testStream(ch.streamUrl);
    if (isLive) {
      console.log('✅ LIVE');
      verifiedHls.push(ch);
    } else {
      console.log('❌ OFFLINE');
    }
  }

  // Combine Verified HLS streams + Guaranteed YouTube 24/7 Live streams
  const finalChannels = [...YOUTUBE_LIVE_CHANNELS, ...verifiedHls];

  // Sort by category, then featured first
  finalChannels.sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.name.localeCompare(b.name);
  });

  const outputPath = path.join(__dirname, 'iptv.json');
  fs.writeFileSync(outputPath, JSON.stringify(finalChannels, null, 2), 'utf-8');
  console.log(`\n🎉 Total Curated Live Channels: ${finalChannels.length}`);
  console.log(`Saved to: ${outputPath}`);
}

main().catch(console.error);
