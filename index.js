const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

// Cache 20 phút (1200s), kiểm tra hết hạn mỗi 5 phút (300s)
const appCache = new NodeCache({ stdTTL: 1200, checkperiod: 300 });
const CACHE_KEY = "all_sports_channels_grouped_v23";

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*"
  },
  timeout: 4000 
};

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

// Đưa Regex ra ngoài để biên dịch 1 lần duy nhất, giảm tải CPU khi user lướt danh mục
const RE_VN = /tv360|on sport|k\+|vtvcab|sctv17|vtv|bóng đá|thể thao|vietnam|trong nuoc/i;
const RE_INT = /bein|eurosport|arena|sky sport|espn|fox|nba|wwe|astro|supersport|laliga|premier|true premier|international|quoc te|foreign/i;
const RE_ENT = /hbo|cinemax|cartoon|animal|4k|coocaa|hit|discovery|axn|warner|phim|movie|cinema|entertainment/i;

function getSmartLogo(channelName, originalLogo) {
  const cleanName = channelName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const key in FIX_LOGOS) {
    if (cleanName.includes(key)) return FIX_LOGOS[key];
  }
  return (originalLogo && originalLogo.startsWith("http")) ? originalLogo : "https://i.imgur.com/26X3bY4.png";
}

const manifest = {
  id: "org.thethao.livehd",
  version: "2.3.1",
  name: "Kênh Thể Thao & Truyền Hình Live HD",
  description: "Tải siêu tốc song song 8 luồng M3U, chống treo Stremio",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["sport:"],
  catalogs: [
    { type: "tv", id: "sport_vn", name: "Bóng Đá VN & TV360+", extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] },
    { type: "tv", id: "sport_int", name: "Thể Thao Quốc Tế", extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] },
    { type: "tv", id: "tv_entertainment", name: "Phim & Giải Trí (HBO, 4K, Cartoon)", extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] },
    { type: "tv", id: "sport_all", name: "Tất Cả Kênh Truyền Hình", extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] }
  ]
};

const builder = new addonBuilder(manifest);

async function fetchSportsChannels() {
  const cachedData = appCache.get(CACHE_KEY);
  if (cachedData) return cachedData;

  const channelsMap = new Map();
  const seenUrls = new Set();

  const requests = SPORTS_M3U_URLS.map(url =>
    axios.get(url, AXIOS_CONFIG).catch(() => null)
  );

  const responses = await Promise.all(requests);

  for (const res of responses) {
    if (!res?.data || typeof res.data !== "string") continue;

    // Tối ưu: Dùng /\r?\n/ để xử lý file M3U được tạo từ môi trường Windows
    const lines = res.data.split(/\r?\n/);
    let currentExt = null;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith("#EXTINF:")) {
        // Tối ưu: Regex match chi tiết hơn và an toàn hơn
        const nameMatch = line.match(/,([^,]+)$/);
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const groupMatch = line.match(/group-title="([^"]+)"/);

        currentExt = {
          name: nameMatch ? nameMatch[1].trim() : "Kênh Live",
          logo: logoMatch ? logoMatch[1] : null,
          group: groupMatch ? groupMatch[1] : "TV"
        };
      } else if (line.startsWith("http") && currentExt) {
        if (!seenUrls.has(line)) {
          seenUrls.add(line);
          
          const slug = currentExt.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
          const channelId = `sport:${slug}`;

          let channelData = channelsMap.get(channelId);
          if (channelData) {
            channelData.streams.push(line);
          } else {
            channelsMap.set(channelId, {
              id: channelId,
              name: currentExt.name,
              // Gộp chuỗi tìm kiếm (search string) ngay từ lúc khởi tạo để tối ưu hàm filter ở Catalog
              searchString: `${currentExt.name} ${currentExt.group}`.toLowerCase(),
              logo: getSmartLogo(currentExt.name, currentExt.logo),
              group: currentExt.group,
              streams: [line]
            });
          }
        }
        currentExt = null;
      }
    }
  }

  const channels = Array.from(channelsMap.values());
  
  // Cơ chế Fallback: Chỉ lưu cache mới nếu fetch thành công ít nhất 1 kênh.
  // Tránh trường hợp mất mạng / lỗi server nguồn ghi đè mảng rỗng lên cache đang chạy tốt.
  if (channels.length > 0) {
    appCache.set(CACHE_KEY, channels);
    return channels;
  }
  
  // Trả về cache rỗng nếu mọi cách đều thất bại
  return [];
}

// 1. CATALOG HANDLER
builder.defineCatalogHandler(async (args) => {
  const allChannels = await fetchSportsChannels();
  let filteredChannels = [];

  if (args.extra?.search) {
    const query = args.extra.search.toLowerCase();
    filteredChannels = allChannels.filter(ch => ch.name.toLowerCase().includes(query));
  } else {
    // Tối ưu: Chỉ test chuỗi gom (searchString) với Regex đã biên dịch sẵn
    switch (args.id) {
      case "sport_vn":
        filteredChannels = allChannels.filter(ch => RE_VN.test(ch.searchString));
        break;
      case "sport_int":
        filteredChannels = allChannels.filter(ch => RE_INT.test(ch.searchString));
        break;
      case "tv_entertainment":
        filteredChannels = allChannels.filter(ch => RE_ENT.test(ch.searchString));
        break;
      default:
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

  return { metas };
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

      return { streams };
    }
  }
  return { streams: [] };
});

// KEEP-ALIVE
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    // Tối ưu: Bổ sung timeout cho cronjob ping để không treo request ngầm
    axios.get(`${RENDER_URL}/manifest.json`, { timeout: 5000 })
      .then(() => console.log("[Keep-Alive] Ping thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7002;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon Thể Thao & TV v2.3.1 đang chạy tại: ${url}manifest.json`);
});
