const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

// Cache 20 phút để đảm bảo các luồng m3u8 live luôn tươi mới
const appCache = new NodeCache({ stdTTL: 1200, checkperiod: 300 });

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*"
  },
  // Ép thời gian chờ xuống 4 giây để fail-fast, không làm treo hệ thống
  timeout: 4000 
};

// TỔNG HỢP TOÀN BỘ NGUỒN M3U TỪ ẢNH MỚI
const SPORTS_M3U_URLS = [
  "https://1.org.vn/vmttv",               
  "https://tinyurl.com/vietxiaomi",       
  "https://tv.vietanhtv.top/tv",          
  "https://tinyurl.com/vmt47",            
  "https://tinhlagi.pro/s.m3u",           
  "https://bit.ly/quidntv",               
  "http://bit.ly/coocaa-tv",              
  "https://livesport.s.gy/easport"        
];

// BẢNG LOGO HD CHUẨN
const FIX_LOGOS = {
  "vtv1": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/VTV1_hd_2023.png/320px-VTV1_hd_2023.png",
  "vtv2": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/VTV2_hd_2023.png/320px-VTV2_hd_2023.png",
  "vtv3": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/VTV3_hd_2023.png/320px-VTV3_hd_2023.png",
  "vtv4": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/VTV4_hd_2023.png/320px-VTV4_hd_2023.png",
  "vtv5": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/VTV5_hd_2023.png/320px-VTV5_hd_2023.png",
  "vtv6": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/VTV6_HD_Logo.png/320px-VTV6_HD_Logo.png",
  "vtv7": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/VTV7_hd_2023.png/320px-VTV7_hd_2023.png",
  "vtv8": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/VTV8_hd_2023.png/320px-VTV8_hd_2023.png",
  "vtv9": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/VTV9_hd_2023.png/320px-VTV9_hd_2023.png",
  "hbo": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/HBO_logo.svg/320px-HBO_logo.svg.png",
  "cinemax": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Cinemax_2011_logo.svg/320px-Cinemax_2011_logo.svg.png"
};

function getSmartLogo(channelName, originalLogo) {
  const cleanName = channelName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const key in FIX_LOGOS) {
    if (cleanName.includes(key)) {
      return FIX_LOGOS[key];
    }
  }
  return (originalLogo && originalLogo.startsWith("http")) ? originalLogo : "https://i.imgur.com/26X3bY4.png";
}

const manifest = {
  id: "org.thethao.livehd",
  version: "2.3.0",
  name: "Kênh Thể Thao & Truyền Hình Live HD",
  description: "Tải siêu tốc song song 8 luồng M3U, chống treo Stremio",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["sport:"],
  catalogs: [
    {
      type: "tv",
      id: "sport_vn",
      name: "Bóng Đá VN & TV360+",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "sport_int",
      name: "Thể Thao Quốc Tế",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "tv_entertainment",
      name: "Phim & Giải Trí (HBO, 4K, Cartoon)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "sport_all",
      name: "Tất Cả Kênh Truyền Hình",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

async function fetchSportsChannels() {
  const cacheKey = "all_sports_channels_grouped_v23";
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  const channelsMap = new Map();
  const seenUrls = new Set();

  // [THUẬT TOÁN MỚI] Bắn 8 request cùng 1 lúc (Parallel), bỏ qua ngay nếu lỗi/chậm
  const requests = SPORTS_M3U_URLS.map(url =>
    axios.get(url, AXIOS_CONFIG).catch(() => null)
  );

  // Chờ tất cả phản hồi (tối đa mất 4 giây cho dù link hỏng)
  const responses = await Promise.all(requests);

  for (const res of responses) {
    // Nếu kết quả trả về null hoặc không phải chuỗi M3U thì bỏ qua
    if (!res || !res.data || typeof res.data !== "string") continue;

    const lines = res.data.split("\n");
    let currentExt = null;

    for (let line of lines) {
      line = line.trim();
      if (line.startsWith("#EXTINF:")) {
        const nameMatch = line.match(/,(.+)$/);
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const groupMatch = line.match(/group-title="([^"]+)"/);

        currentExt = {
          name: nameMatch ? nameMatch[1].trim() : "Kênh Live",
          logo: logoMatch ? logoMatch[1] : null,
          group: groupMatch ? groupMatch[1] : "TV"
        };
      } else if (line.startsWith("http") && currentExt) {
        const streamUrl = line;
        
        if (!seenUrls.has(streamUrl)) {
          seenUrls.add(streamUrl);
          
          const slug = currentExt.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
          const channelId = `sport:${slug}`;

          if (channelsMap.has(channelId)) {
            channelsMap.get(channelId).streams.push(streamUrl);
          } else {
            channelsMap.set(channelId, {
              id: channelId,
              name: currentExt.name,
              logo: getSmartLogo(currentExt.name, currentExt.logo),
              group: currentExt.group,
              streams: [streamUrl]
            });
          }
        }
        currentExt = null;
      }
    }
  }

  const channels = Array.from(channelsMap.values());
  if (channels.length > 0) {
    appCache.set(cacheKey, channels, 1200);
  }
  return channels;
}

// 1. CATALOG HANDLER
builder.defineCatalogHandler(async (args) => {
  const allChannels = await fetchSportsChannels();
  let filteredChannels = [];

  if (args.extra && args.extra.search) {
    const query = args.extra.search.toLowerCase();
    filteredChannels = allChannels.filter(ch => ch.name.toLowerCase().includes(query));
  } else {
    if (args.id === "sport_vn") {
      filteredChannels = allChannels.filter(ch => 
        /tv360|on sport|k\+|vtvcab|sctv17|vtv|bóng đá|thể thao/i.test(ch.name) ||
        /tv360|vietnam|trong nuoc/i.test(ch.group)
      );
    } else if (args.id === "sport_int") {
      filteredChannels = allChannels.filter(ch => 
        /bein|eurosport|arena|sky sport|espn|fox|nba|wwe|astro|supersport|laliga|premier|true premier/i.test(ch.name) ||
        /international|quoc te|foreign/i.test(ch.group)
      );
    } else if (args.id === "tv_entertainment") {
      filteredChannels = allChannels.filter(ch => 
        /hbo|cinemax|cartoon|animal|4k|coocaa|hit|discovery|axn|warner/i.test(ch.name) ||
        /phim|movie|cinema|4k|entertainment/i.test(ch.group)
      );
    } else {
      filteredChannels = allChannels;
    }
  }

  const skip = args.extra?.skip || 0;
  const paginatedChannels = filteredChannels.slice(skip, skip + 100);

  const metas = paginatedChannels.map(ch => ({
    id: ch.id,
    type: "tv",
    name: ch.name,
    poster: ch.logo,
    background: ch.logo,
    description: `📺 Trực Tiếp: ${ch.name}\nTổng số máy chủ: ${ch.streams.length} nguồn phát.`
  }));

  return { metas: metas };
});

// 2. META HANDLER
builder.defineMetaHandler(async (args) => {
  if (args.id?.startsWith("sport:")) {
    const allChannels = await fetchSportsChannels();
    const target = allChannels.find(ch => ch.id === args.id);

    if (target) {
      return {
        meta: {
          id: target.id,
          type: "tv",
          name: target.name,
          poster: target.logo,
          background: target.logo,
          description: `🔴 Đang phát trực tiếp: ${target.name}\n\nKênh này hiện có ${target.streams.length} nguồn phát (server) dự phòng. Hãy chuyển server nếu bị nghẽn.`
        }
      };
    }
  }
  return { meta: {} };
});

// 3. STREAM HANDLER
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("sport:")) {
    const allChannels = await fetchSportsChannels();
    const target = allChannels.find(ch => ch.id === args.id);

    if (target && target.streams.length > 0) {
      const streams = target.streams.map((url, index) => ({
        name: `Server ${index + 1}`,
        title: `Nguồn phát ${index + 1} - ${target.name}\n▶ Bấm để xem`,
        url: url
      }));

      return { streams: streams };
    }
  }
  return { streams: [] };
});

// KEEP-ALIVE
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/manifest.json`)
      .then(() => console.log("[Keep-Alive] Ping thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7002;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon Thể Thao & TV v2.3.0 đang chạy tại: ${url}manifest.json`);
});
