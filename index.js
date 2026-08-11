const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

// Cache 20 phút để đảm bảo luồng m3u8 thể thao luôn mới
const appCache = new NodeCache({ stdTTL: 1200, checkperiod: 300 });

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*"
  },
  timeout: 8000
};

// TỔNG HỢP CÁC NGUỒN M3U CHUYÊN THỂ THAO & BÓNG ĐÁ
const SPORTS_M3U_URLS = [
  "https://tinyurl.com/vmt47",        // Thể thao, Bóng đá, TV360+ độc quyền
  "https://tinhlagi.pro/s.m3u",       // Bóng đá, Tiếu Lâm & nguồn tổng hợp
  "https://livesport.s.gy/easport"    // Các kênh thể thao quốc tế
];

// BẢNG LOGO HD CHUẨN CHO CÁC KÊNH VTV & TRUYỀN HÌNH
const FIX_LOGOS = {
  "vtv1": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/VTV1_hd_2023.png/320px-VTV1_hd_2023.png",
  "vtv2": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/VTV2_hd_2023.png/320px-VTV2_hd_2023.png",
  "vtv3": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/VTV3_hd_2023.png/320px-VTV3_hd_2023.png",
  "vtv4": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/VTV4_hd_2023.png/320px-VTV4_hd_2023.png",
  "vtv5": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/VTV5_hd_2023.png/320px-VTV5_hd_2023.png",
  "vtv6": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/VTV6_HD_Logo.png/320px-VTV6_HD_Logo.png",
  "vtv7": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/VTV7_hd_2023.png/320px-VTV7_hd_2023.png",
  "vtv8": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/VTV8_hd_2023.png/320px-VTV8_hd_2023.png",
  "vtv9": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/VTV9_hd_2023.png/320px-VTV9_hd_2023.png"
};

// HÀM TỰ ĐỘNG GÁN LOGO CHUẨN NẾU NGUỒN BỊ HỎNG HOẶC THIẾU
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
  version: "2.1.0",
  name: "Kênh Thể Thao & Bóng Đá Live HD",
  description: "Tối ưu gom Server: 1 Kênh - Đa luồng phát dự phòng & Sửa Logo VTV HD",
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
      id: "sport_all",
      name: "Tất Cả Kênh Thể Thao",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

// TẢI, GIẢI MÃ M3U, GỘP SERVER DỰ PHÒNG & TỰ ĐỘNG SỬA LOGO
async function fetchSportsChannels() {
  const cacheKey = "all_sports_channels_grouped_v21";
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  const channelsMap = new Map();
  const seenUrls = new Set();

  for (const url of SPORTS_M3U_URLS) {
    try {
      const res = await axios.get(url, AXIOS_CONFIG);
      if (!res.data || typeof res.data !== "string") continue;

      const lines = res.data.split("\n");
      let currentExt = null;

      for (let line of lines) {
        line = line.trim();
        if (line.startsWith("#EXTINF:")) {
          const nameMatch = line.match(/,(.+)$/);
          const logoMatch = line.match(/tvg-logo="([^"]+)"/);
          const groupMatch = line.match(/group-title="([^"]+)"/);

          currentExt = {
            name: nameMatch ? nameMatch[1].trim() : "Kênh Thể Thao",
            logo: logoMatch ? logoMatch[1] : null,
            group: groupMatch ? groupMatch[1] : "Sports"
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
    } catch (err) {
      console.log(`[Lỗi M3U Thể Thao] Không tải được từ ${url}`);
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
        /bein|eurosport|arena|sky sport|espn|fox|nba|wwe|astro|supersport|laliga|premier/i.test(ch.name) ||
        /international|quoc te|foreign/i.test(ch.group)
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
    description: `⚽ Trực Tiếp: ${ch.name}\nTổng số máy chủ: ${ch.streams.length} nguồn phát.`
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
          description: `🔴 Đang phát trực tiếp: ${target.name}\n\nKênh này hiện đang có ${target.streams.length} nguồn phát (server) dự phòng. Hãy chọn server mượt nhất để xem.`
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

// TỰ ĐỘNG KEEP-ALIVE: Ping chính server mỗi 10 phút để Render không bị ngủ
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/manifest.json`)
      .then(() => console.log("[Keep-Alive] Tự động ping thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7002;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon Thể Thao Live HD v2.1.0 đang chạy tại: ${url}manifest.json`);
});
