const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

// Giảm Cache xuống 10 phút (600s) để link bóng đá Xôi Lạc cập nhật token liên tục
const appCache = new NodeCache({ stdTTL: 600, checkperiod: 300 });

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*"
  },
  timeout: 4000 // Tải đa luồng siêu tốc, đá văng ngay nếu nguồn nào bị chết
};

// FULL 14 NGUỒN M3U: Kênh TV + Giải Trí + Trực tiếp Bóng Đá Xôi Lạc
const SPORTS_M3U_URLS = [
  "https://1.org.vn/vmttv",               
  "https://tinyurl.com/vietxiaomi",       
  "https://tv.vietanhtv.top/tv",          
  "https://tinyurl.com/vmt47",            
  "https://tinhlagi.pro/s.m3u",           
  "https://bit.ly/quidntv",               
  "http://bit.ly/coocaa-tv",              
  "https://livesport.s.gy/easport",
  "https://tt.8share.pro/chuoichien",     
  "https://tt.8share.pro/buncha",         
  "https://tt.8share.pro/khandaia",       
  "https://tt.8share.pro/gavang",         
  "https://tt.8share.pro/hoiquan",        
  "https://tt.8share.pro/hoadao"          
];

// BẢNG SỬA LOGO HD CHUẨN
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
  // Mặc định ảnh bóng đá nếu không tìm thấy logo
  return (originalLogo && originalLogo.startsWith("http")) ? originalLogo : "https://i.imgur.com/26X3bY4.png";
}

const manifest = {
  id: "org.thethao.livehd",
  version: "3.0.0",
  name: "Kênh Thể Thao & Truyền Hình Live HD",
  description: "Cập nhật kho 14 nguồn M3U. Phân loại chuẩn Bóng đá trực tiếp & Kênh TV.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["sport:"],
  catalogs: [
    {
      type: "tv",
      id: "live_match",
      name: "⚽ Trực Tiếp Bóng Đá", // Gom riêng trận đấu, xôi lạc
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "sport_vn",
      name: "📺 Kênh TV (VTV, K+, TV360)", // Trả lại sự trong sạch cho kênh truyền thống
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "sport_int",
      name: "🌍 Thể Thao Quốc Tế",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "tv",
      id: "tv_entertainment",
      name: "🎬 Phim & Giải Trí (4K, HBO)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

async function fetchSportsChannels() {
  const cacheKey = "all_sports_channels_grouped_v300";
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  const channelsMap = new Map();
  const seenUrls = new Set();

  // Bắn đồng loạt 14 request cùng 1 lúc
  const requests = SPORTS_M3U_URLS.map(url =>
    axios.get(url, AXIOS_CONFIG).catch(() => null)
  );
  const responses = await Promise.all(requests);

  for (const res of responses) {
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
          group: groupMatch ? groupMatch[1] : ""
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
    appCache.set(cacheKey, channels, 600);
  }
  return channels;
}

// 1. CATALOG HANDLER (Logic phân loại thông minh)
builder.defineCatalogHandler(async (args) => {
  const allChannels = await fetchSportsChannels();
  let filteredChannels = [];

  if (args.extra && args.extra.search) {
    const query = args.extra.search.toLowerCase();
    filteredChannels = allChannels.filter(ch => ch.name.toLowerCase().includes(query));
  } else {
    if (args.id === "live_match") {
      // Bắt các trận đá live (chứa chữ 'vs', 'xoilac', 'vòng', 'ngoại hạng', 'cúp')
      filteredChannels = allChannels.filter(ch => 
        / vs |trực tiếp|live|xoilac|ngoại hạng|cúp|cup|đá/i.test(ch.name) ||
        /bóng đá|trực tiếp|live match/i.test(ch.group)
      );
    } else if (args.id === "sport_vn") {
      // Lọc kênh truyền hình VN (Ép bỏ các kênh có chữ 'vs' hoặc 'xoilac' để không lẫn trận đấu vào)
      filteredChannels = allChannels.filter(ch => 
        (!/ vs |xoilac/i.test(ch.name)) && 
        (/tv360|on sport|k\+|vtvcab|sctv|vtv|htv|thể thao/i.test(ch.name) || /tv360|vietnam|trong nuoc/i.test(ch.group))
      );
    } else if (args.id === "sport_int") {
      filteredChannels = allChannels.filter(ch => 
        /bein|eurosport|arena|sky sport|espn|fox|nba|wwe|astro|supersport|laliga|premier|true premier/i.test(ch.name) ||
        /international|quoc te|foreign/i.test(ch.group)
      );
    } else if (args.id === "tv_entertainment") {
      filteredChannels = allChannels.filter(ch => 
        /hbo|cinemax|cartoon|animal|4k|coocaa|hit|discovery|axn|warner|phim/i.test(ch.name) ||
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
    description: `📺 ${ch.name}\n⚡ Có ${ch.streams.length} Server dự phòng. Nếu lag hãy chọn Server khác.`
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
          description: `🔴 Đang phát: ${target.name}\n\nKênh này hiện có ${target.streams.length} nguồn phát dự phòng. Bạn vui lòng chuyển Server mượt nhất ở danh sách bên cạnh để xem.`
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
        title: `Nguồn ${index + 1} - ${target.name}\n▶ Bấm để xem`,
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
  console.log(`Addon Thể Thao v3.0.0 đang chạy tại: ${url}manifest.json`);
});
