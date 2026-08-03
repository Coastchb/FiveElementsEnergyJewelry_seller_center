/* ========== Mock API 层 ==========
   后台对接：将 BASE_URL 改为真实云函数 HTTP 端点
   使用方式：
   1. 云开发 → 云函数 → HTTP 触发器 → 创建 API 网关
   2. 或自建 Node.js 中间件代理 wx-server-sdk 调用
   3. 当前使用 localStorage 模拟数据，方便演示
*/
const API_BASE = window.__API_BASE__ || '';
const MOCK = window.__MOCK__ !== false;

// ========== 内置工具 ==========
function _fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ========== 鉴权 ==========
let AUTH_TOKEN = localStorage.getItem('seller_token') || '';

function setToken(t) { AUTH_TOKEN = t; if(t) localStorage.setItem('seller_token', t); else localStorage.removeItem('seller_token'); }

async function apiCall(fnName, data = {}) {  if (MOCK) return mockCall(fnName, data);
  // 真实后端：login 映射到 adminLogin 云函数，直接调；其他管理接口走 adminApiGateway 网关
  const isLogin = fnName === 'login';
  if (isLogin) {
    const res = await fetch(`${API_BASE}/adminLogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: data.account, password: data.password }),
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || '请求失败');
    return json.data;
  }
  // 其余接口统一通过网关转发
  const res = await fetch(`${API_BASE}/adminApiGateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fnName, data, _adminToken: AUTH_TOKEN }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || '请求失败');
  return json.data;
}

// ========== 图片链接解析 ==========
// 把云存储 fileID（cloud://...）批量换成临时 http 链接，http(s) 链接原样透传。
// 返回 Map<原始值, 可渲染URL>。Mock 模式下 images 已是 http 链接，无需请求后端。
const _urlCache = new Map();
async function resolveImageUrls(values) {
  const arr = (Array.isArray(values) ? values : [values]).filter(v => typeof v === 'string' && v);
  if (arr.length === 0) return new Map();
  const pending = arr.filter(v => !_urlCache.has(v));
  // 只处理 cloud:// 协议，http(s) 直接缓存
  arr.forEach(v => { if (v.startsWith('http') && !_urlCache.has(v)) _urlCache.set(v, v); });
  const toFetch = pending.filter(v => v.startsWith('cloud://'));
  if (toFetch.length > 0 && !MOCK) {
    try {
      const res = await apiCall('getTempFileURL', { fileList: toFetch });
      const map = (res && res.data && res.data.map) || {};
      toFetch.forEach(v => { _urlCache.set(v, map[v] || ''); });
    } catch (e) {
      toFetch.forEach(v => { _urlCache.set(v, ''); });
    }
  } else {
    toFetch.forEach(v => { _urlCache.set(v, v); });
  }
  return new Map(arr.map(v => [v, _urlCache.get(v) || '']));
}

// ========== Mock Data ==========
const STORAGE_KEY = 'seller_mock_data_v5';

function getDB() {
  let db = localStorage.getItem(STORAGE_KEY);
  if (!db) db = JSON.stringify(initMockData());
  return JSON.parse(db);
}

function saveDB(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function initMockData() {
  const now = Date.now();
  const day = 86400000;

  // ---- 用户（含首次登录时间，用于"新用户"统计） ----
  const users = [];
  const TOTAL_USERS = 215;
  for (let i = 0; i < TOTAL_USERS; i++) {
    let firstLogin;
    if (i < 12) firstLogin = now - Math.floor(Math.random() * day);                  // 今日新增
    else if (i < 86) firstLogin = now - day - Math.floor(Math.random() * 29 * day);  // 近30天（非今日）
    else firstLogin = now - 31 * day - Math.floor(Math.random() * 300 * day);        // 更早
    users.push({
      openid: 'u' + i,
      nickname: '用户' + i,
      avatar: '',
      registerTime: firstLogin,
      firstLoginTime: firstLogin,
      lastLoginTime: now - Math.floor(Math.random() * 3 * day),
    });
  }

  // ---- DIY 作品（保存新建记录；购买仅更新同一条记录并记录购买时间） ----
  const diyItems = [];
  const TOTAL_DIY = 540;
  for (let i = 0; i < TOTAL_DIY; i++) {
    const submitTime = now - Math.floor(Math.random() * 200 * day) - Math.floor(Math.random() * day);
    let buyTime = null;
    if (i < 63) {
      // 约 63 件被购买；购买时间需晚于保存且不超过当前
      const maxBuy = Math.min(now - day, submitTime + Math.floor(Math.random() * 10 * day) + day);
      buyTime = maxBuy > submitTime ? maxBuy : null;
    }
    diyItems.push({
      diyId: 'DIY' + String(i).padStart(4, '0'),
      userId: 'u' + (i % TOTAL_USERS),
      diyName: '作品' + i,
      submitTime,
      buyTime,
      status: buyTime ? '已下单' : '草稿',
    });
  }

  // ---- 供应商（登录卖家中心后台的供货方） ----
  const suppliers = [
    { supplierId: 'S001', name: '灵石工坊', account: 'supplier01', loginPassword: 'sup123', firstLoginAt: now - 60 * day, lastLoginAt: now - 2 * day },
    { supplierId: 'S002', name: '晶彩饰品', account: 'supplier02', loginPassword: 'sup456', firstLoginAt: now - 40 * day, lastLoginAt: now - 5 * day }
  ];

  // ---- 管理员（登录卖家中心的账号） ----
  const admins = [
    { account: 'admin', password: 'admin123' }
  ];

  const orders = [
      { orderId: 'OD20260720001', type: 'product', status: '待发货', seqTail: '0001',
        goodsName: '五行转运红绳手链', qty: 2, price: 168, cost: 120, createdAt: now - 3600000,
        nickname: '星辰大海', address: { name: '张先生', phone: '138****5678', address: '广东省深圳市南山区科技园路1号' },
        waybillPrinted: false, diyMaterials: null, buyerRemark: '请在工作日送达', sellerRemark: '' },
      { orderId: 'OD20260720002', type: 'diy', status: '待发货', seqTail: '0002',
        goodsName: '自定义DIY手串·幸运石', qty: 1, price: 258, cost: 95, createdAt: now - 7200000,
        nickname: '月光宝盒', address: { name: '李女士', phone: '159****1234', address: '北京市朝阳区望京SOHO' },
        waybillPrinted: true, diyMaterials: '紫水晶×2, 白水晶×1, 月光石×3, 925银饰×1', buyerRemark: '', sellerRemark: '已与用户确认配石' },
      { orderId: 'OD20260719003', type: 'product', status: '待发货', seqTail: '0003',
        goodsName: '紫水晶能量项链', qty: 1, price: 398, cost: 150, createdAt: now - day,
        nickname: '清风徐来', address: { name: '王先生', phone: '186****9012', address: '上海市浦东新区陆家嘴环路100号' },
        waybillPrinted: false, diyMaterials: null, buyerRemark: '', sellerRemark: '' },
      { orderId: 'OD20260719004', type: 'diy', status: '待发货', seqTail: '0004',
        goodsName: 'DIY·守护之环', qty: 1, price: 320, cost: 110, createdAt: now - day - 3600000,
        nickname: '花间一壶酒', address: { name: '赵女士', phone: '177****3456', address: '浙江省杭州市西湖区文三路' },
        waybillPrinted: false, diyMaterials: '黑曜石×2, 红玛瑙×2, 黄水晶×1, 菩提根×1', buyerRemark: '希望偏红色系', sellerRemark: '' },
      { orderId: 'OD20260718005', type: 'product', status: '待发货', seqTail: '0005',
        goodsName: '招财黄水晶手链', qty: 3, price: 128, cost: 135, createdAt: now - day * 2,
        nickname: '云淡风轻', address: { name: '孙先生', phone: '133****7890', address: '广东省广州市天河区珠江新城' },
        waybillPrinted: true, diyMaterials: null, buyerRemark: '', sellerRemark: '' },
      { orderId: 'OD20260717006', type: 'product', status: '运输中', seqTail: '0006',
        goodsName: '五行转运红绳手链', qty: 1, price: 168, cost: 60, createdAt: now - day * 3,
        shippedAt: now - day * 2.5, nickname: '星辰大海',
        address: { name: '张先生', phone: '138****5678', address: '广东省深圳市南山区科技园路1号' },
        expressCompany: '中通快递', waybillNo: 'ZT77220188391234', signed: false, intercepted: false,
        waybillPrinted: true, diyMaterials: null, buyerRemark: '', sellerRemark: '' },
      { orderId: 'OD20260715007', type: 'diy', status: '已完成', seqTail: '0007',
        goodsName: 'DIY·星空之谜', qty: 1, price: 450, cost: 130, createdAt: now - day * 5,
        shippedAt: now - day * 4, completedAt: now - day * 3, nickname: '月光宝盒',
        address: { name: '李女士', phone: '159****1234', address: '北京市朝阳区望京SOHO' },
        expressCompany: '顺丰速运', waybillNo: 'SF1043829910234', signed: true, intercepted: false,
        waybillPrinted: true, diyMaterials: '蓝砂石×3, 白水晶×2, 925银饰×2', buyerRemark: '', sellerRemark: '' },
      { orderId: 'OD20260714008', type: 'product', status: '已完成', seqTail: '0008',
        goodsName: '紫水晶能量项链', qty: 1, price: 398, cost: 150, createdAt: now - day * 6,
        shippedAt: now - day * 5, completedAt: now - day * 4, nickname: '清风徐来',
        address: { name: '王先生', phone: '186****9012', address: '上海市浦东新区陆家嘴环路100号' },
        expressCompany: '圆通速递', waybillNo: 'YT882301992331', signed: true, intercepted: false,
        waybillPrinted: true, diyMaterials: null, buyerRemark: '', sellerRemark: '' },
      { orderId: 'OD20260711011', type: 'product', status: '待退款', seqTail: '0011',
        goodsName: '紫水晶能量项链', qty: 1, price: 398, cost: 150, createdAt: now - day * 9,
        nickname: '清风徐来', address: { name: '王先生', phone: '186****9012', address: '上海市浦东新区陆家嘴环路100号' },
        expressCompany: '顺丰速运', waybillNo: 'SF1043829910999', signed: false, intercepted: true, interceptInfo: '已向顺丰发起拦截，包裹将在网点退回',
        waybillPrinted: false, diyMaterials: null, buyerRemark: '想退货退款', sellerRemark: '已与用户协商，待寄回后退款' },
      { orderId: 'OD20260712009', type: 'product', status: '已退款', seqTail: '0009', refunded: true,
        goodsName: '五行转运红绳手链', qty: 1, price: 168, costPrice: 60, createdAt: now - day * 8,
        completedAt: now - day * 7.5, nickname: '云淡风轻',
        address: { name: '孙先生', phone: '133****7890', address: '广东省广州市天河区珠江新城' },
        waybillPrinted: false, diyMaterials: null, buyerRemark: '不想要了', sellerRemark: '用户主动取消，已退款' },
      { orderId: 'OD20260710010', type: 'product', status: '已完成', seqTail: '0010',
        goodsName: '招财黄水晶手链', qty: 2, price: 128, costPrice: 90, createdAt: now - day * 10,
        shippedAt: now - day * 9, completedAt: new Date('2026-07-14').getTime(), nickname: '花间一壶酒',
        address: { name: '赵女士', phone: '177****3456', address: '浙江省杭州市西湖区文三路' },
      expressCompany: '中通快递', waybillNo: 'ZT77220188395555', signed: true, intercepted: false,
      waybillPrinted: true, diyMaterials: null, buyerRemark: '', sellerRemark: '' }
    ];
    // 物流费：待发货（未生成面单）为 null；其余按估算 12 元（真实环境由快递助手 API 回填）
    orders.forEach(o => { o.shippingFee = o.status === '待发货' ? null : 12; });

    return {
      session: { account: 'admin', name: '管理员', role: 'admin' },
      stats: {
        productTotal: 48, userTotal: 215
      },
      orders,
      products: [
      { productId: 'P001', productName: '五行转运红绳手链', type: 'product', categoryId: 'bracelet', categoryName: '手链', price: 168, costPrice: 60, stock: 45, status: '在售', tagline: '转运辟邪，守护平安', images: [], colorName: '红', colorHex: '#C0392B', specSize: '17cm', addTime: now - day * 30, updateTime: now - day * 30 },
      { productId: 'P002', productName: '紫水晶能量项链', type: 'product', categoryId: 'necklace', categoryName: '项链', price: 398, costPrice: 150, stock: 12, status: '在售', tagline: '提升智慧，平静心灵', images: [], colorName: '紫', colorHex: '#9B6BC9', specSize: '45cm', addTime: now - day * 28, updateTime: now - day * 28 },
      { productId: 'P003', productName: '招财黄水晶手链', type: 'product', categoryId: 'bracelet', categoryName: '手链', price: 128, costPrice: 45, stock: 88, status: '在售', tagline: '招财纳福，财源广进', images: [], colorName: '黄', colorHex: '#F4C430', specSize: '16cm', addTime: now - day * 26, updateTime: now - day * 26 },
      { productId: 'P004', productName: '月光石耳环', type: 'product', categoryId: 'earrings', categoryName: '耳饰', price: 258, costPrice: 90, stock: 30, status: '在售', tagline: '温润如玉，优雅气质', images: [], colorName: '白', colorHex: '#F5F5F5', specSize: '可调', addTime: now - day * 24, updateTime: now - day * 24 },
      { productId: 'P005', productName: '白虎尊者·和田玉吊坠', type: 'product', categoryId: 'necklace', categoryName: '项链', price: 688, costPrice: 300, stock: 5, status: '在售', tagline: '辟邪镇宅，权威守护', images: [], colorName: '白绿', colorHex: '#3CB371', specSize: '3cm', addTime: now - day * 22, updateTime: now - day * 22 },
      { productId: 'P006', productName: '绿松石手串', type: 'product', categoryId: 'bracelet', categoryName: '手链', price: 328, costPrice: 120, stock: 0, status: '已下架', tagline: '成功之石，幸运之钥', images: [], colorName: '蓝绿', colorHex: '#2E8B57', specSize: '18cm', addTime: now - day * 20, updateTime: now - day * 19 },
      { productId: 'M001', productName: '天然紫水晶8mm圆珠', type: 'material', categoryId: 'crystal', categoryName: '水晶', price: 28, costPrice: 8, stock: 200, status: '在售', tagline: '单颗售卖', images: [], listImages: [], displayImages: [], colorName: '紫', colorHex: '#9B6BC9', specSize: '8mm', threadWidthMm: 8, addTime: now - day * 18, updateTime: now - day * 18 },
      { productId: 'M002', productName: '黑曜石6mm圆珠', type: 'material', categoryId: 'crystal', categoryName: '水晶', price: 18, costPrice: 5, stock: 350, status: '在售', tagline: '单颗售卖', images: [], listImages: [], displayImages: [], colorName: '黑', colorHex: '#1A1A1A', specSize: '6mm', threadWidthMm: 6, addTime: now - day * 16, updateTime: now - day * 16 },
      { productId: 'M003', productName: '925银莲花隔珠', type: 'material', categoryId: 'silver', categoryName: '银饰', price: 35, costPrice: 10, stock: 120, status: '在售', tagline: '精致银饰，提升质感', images: [], listImages: [], displayImages: [], colorName: '银', colorHex: '#C0C0C0', specSize: '6mm', threadWidthMm: 6, addTime: now - day * 14, updateTime: now - day * 14 },
      { productId: 'M004', productName: '红玛瑙10mm圆珠', type: 'material', categoryId: 'crystal', categoryName: '水晶', price: 22, costPrice: 6, stock: 0, status: '已下架', tagline: '单颗售卖', images: [], listImages: [], displayImages: [], colorName: '红', colorHex: '#C0392B', specSize: '10mm', threadWidthMm: 10, addTime: now - day * 12, updateTime: now - day * 11 },
      { productId: 'M005', productName: '菩提根12mm圆珠', type: 'material', categoryId: 'wood', categoryName: '木质', price: 15, costPrice: 4, stock: 500, status: '在售', tagline: '天然菩提，禅意十足', images: [], listImages: [], displayImages: [], colorName: '米白', colorHex: '#F0EAD6', specSize: '12mm', threadWidthMm: 12, addTime: now - day * 10, updateTime: now - day * 10 }
    ],
    categories: [
      { id: 'bracelet', name: '手链' }, { id: 'necklace', name: '项链' },
      { id: 'earrings', name: '耳饰' }, { id: 'crystal', name: '水晶' },
      { id: 'silver', name: '银饰' }, { id: 'wood', name: '木质' }
    ],
    users,
    diyItems,
    suppliers,
    admins
  };
}

// ========== Mock API Router ==========
let _mockCounter = 0;
function mockCall(fnName, data) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const db = getDB();
        let result;
        switch(fnName) {
          case 'login':
            if (data.account && data.password) {
              const name = data.account === 'admin' ? '管理员' : '供应商';
              setToken('mock_token_' + Date.now());
              result = { token: AUTH_TOKEN, name, role: db.session.role };
            } else { return reject(new Error('请输入账号和密码')); }
            break;
          case 'getOrderStats': {
            const FEE = 12; // 每单平均快递费（元），与后端 SHIPPING_FEE_PER_ORDER 一致
            const SALE = ['待发货', '运输中', '已完成']; // 销售额/货款仅统计这三态
            const now = Date.now();
            const DAY = 86400000;
            const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
            const last30Start = now - 30 * DAY;
            const yesterdayStart = todayStart - DAY;
            const prev30Start = last30Start - 30 * DAY;
            const sumRange = (start, end) => {
              const arr = db.orders.filter(o => o.createdAt >= start && o.createdAt < end && SALE.includes(o.status));
              const sales = arr.reduce((s, o) => s + (o.price * o.qty || 0), 0);
              const cost = arr.reduce((s, o) => s + (o.costPrice * o.qty || 0), 0);
              const shipping = Math.round(arr.reduce((s, o) => s + (Number(o.shippingFee) || FEE), 0) * 100) / 100;
              return {
                sales: Math.round(sales * 100) / 100,
                cost: Math.round(cost * 100) / 100,
                shipping,
                profit: Math.round((sales - cost - shipping) * 100) / 100
              };
            };
            const countRange = (start, end) => db.orders.filter(o => o.createdAt >= start && o.createdAt < end).length;
            const t = sumRange(todayStart, todayStart + DAY);
            const y = sumRange(yesterdayStart, todayStart);
            const m = sumRange(last30Start, now);
            const p = sumRange(prev30Start, last30Start);
            const a = sumRange(0, now);

            // 新用户：首次登录时间落在当天/当月
            const newUsers = (s, e) => db.users.filter(u => u.firstLoginTime >= s && u.firstLoginTime < e).length;
            // DIY 作品（按作品记录去重）：保存=提交时间落区间，购买=购买时间落区间，去重=保存+购买-既保存又购买
            const diySaved = (s, e) => db.diyItems.filter(d => d.submitTime >= s && d.submitTime < e).length;
            const diyBought = (s, e) => db.diyItems.filter(d => d.buyTime && d.buyTime >= s && d.buyTime < e).length;
            const diyBoth = (s, e) => db.diyItems.filter(d => d.submitTime >= s && d.submitTime < e && d.buyTime && d.buyTime >= s && d.buyTime < e).length;
            const diyActive = (s, e) => diySaved(s, e) + diyBought(s, e) - diyBoth(s, e);

            const userTotal = db.users.length;
            result = {
              ...db.stats,
              // 今日
              todayOrderCount: countRange(todayStart, todayStart + DAY),
              todaySales: t.sales, todayCostPrice: t.cost, todayShipping: t.shipping, todayProfit: t.profit,
              yesterdaySales: y.sales, yesterdayProfit: y.profit,
              todayNewUsers: newUsers(todayStart, todayStart + DAY),
              todayDiySaved: diySaved(todayStart, todayStart + DAY),
              todayDiyBought: diyBought(todayStart, todayStart + DAY),
              todayDiy: diyActive(todayStart, todayStart + DAY),
              // 近30天
              last30OrderCount: countRange(last30Start, now),
              last30Sales: m.sales, last30CostPrice: m.cost, last30Shipping: m.shipping, last30Profit: m.profit,
              prev30Sales: p.sales, prev30Profit: p.profit,
              last30NewUsers: newUsers(last30Start, now),
              last30DiySaved: diySaved(last30Start, now),
              last30DiyBought: diyBought(last30Start, now),
              last30Diy: diyActive(last30Start, now),
              // 历史累计
              totalOrderCount: db.orders.length,
              totalSales: a.sales, totalCostPrice: a.cost, totalShipping: a.shipping, totalProfit: a.profit,
              totalNewUsers: userTotal,
              totalDiySaved: diySaved(0, now),
              totalDiyBought: diyBought(0, now),
              totalDiy: diyActive(0, now),
              unshippedOrderCount: db.orders.filter(o => o.status === '待发货').length,
              pendingRefundCount: db.orders.filter(o => o.status === '待退款').length,
              userTotal,
              productTotal: db.stats.productTotal
            };
            break;
          }
          case 'getAdminOrders':
            result = mockGetOrders(db, data);
            break;
          case 'adminUpdateOrder':
            result = mockUpdateOrder(db, data);
            break;
          case 'getAdminProducts':
            result = mockGetProducts(db, data);
            break;
          case 'importFromTencentDoc': {
            // 演示桩：真实环境调用 importFromTencentDoc 云函数
            // 支持 type=product / type=material 双分支；配饰走 processBeadImage 处理
            const { type = 'product', colName, useDs } = data;
            const seq = db.products.length + 1000;
            if (type === 'material') {
              const rows = [
                { name: '天然紫水晶8mm圆珠', price: 28, cost: 8, stock: 200, categoryName: '水晶', spec: '8mm', threadWidth: 8 },
                { name: '黑曜石6mm圆珠', price: 18, cost: 5, stock: 350, categoryName: '水晶', spec: '6mm', threadWidth: 6 },
              ];
              const failList = [];
              if (!colName) failList.push({ row: 2, reason: '未指定材料名列号' });
              let success = 0;
              rows.forEach((r, i) => {
                if (!colName) return;
                const cat = db.categories.find(c => c.name === r.categoryName);
                const demoImg = 'https://picsum.photos/seed/mat' + (seq + i) + '/200';
                db.products.push({
                  productId: 'MAT' + (Date.now() + i),
                  materialName: r.name,
                  type: 'material',
                  categoryId: cat ? cat.id : 'crystal',
                  categoryName: cat ? cat.name : '水晶',
                  price: r.price, costPrice: r.cost, stock: r.stock,
                  status: '在售', specSize: r.spec, threadWidthMm: r.threadWidth,
                  listImages: [demoImg], displayImages: [demoImg],
                  images: [demoImg], firstImage: demoImg,
                  addTime: Date.now(), updateTime: Date.now(),
                });
                success++;
              });
              db.stats.productTotal = db.products.length;
              result = { total: rows.length, success, failList };
            } else {
              const rows = [
                { name: '粉晶招桃花手链', price: 188, cost: 56, stock: 30, images: ['https://picsum.photos/seed/pink/200', 'https://picsum.photos/seed/pink2/200'], categoryName: '手链', tagline: '' },
                { name: '黑曜石守护手串', price: 158, cost: 47, stock: 20, images: ['https://picsum.photos/seed/black/200', 'https://picsum.photos/seed/black2/200'], categoryName: '手链', tagline: '' },
                { name: '海蓝宝耳坠', price: 228, cost: 68, stock: 15, images: ['https://picsum.photos/seed/aqua/200'], categoryName: '耳饰', tagline: '' },
                { name: '黄水晶招财手链', price: 128, cost: 38, stock: 40, images: ['https://picsum.photos/seed/citrine/200', 'https://picsum.photos/seed/citrine2/200'], categoryName: '手链', tagline: '' }
              ];
              const failList = [];
              if (!colName) failList.push({ row: 2, reason: '未指定商品名列号' });
              let success = 0;
              rows.forEach((r, i) => {
                if (!colName) return;
                const cat = db.categories.find(c => c.name === r.categoryName);
                db.products.push({
                  productId: 'PRD' + (Date.now() + i),
                  productName: r.name,
                  type: 'product',
                  categoryId: cat ? cat.id : 'bracelet',
                  categoryName: cat ? cat.name : '手链',
                  price: r.price, costPrice: r.cost, stock: r.stock,
                  status: '在售',
                  tagline: useDs ? `【DS推荐】${r.name}，能量加持，助你心想事成` : (r.tagline || ''),
                  firstImage: r.images[0] || '',
                  images: r.images || [],
                  addTime: Date.now(), updateTime: Date.now(),
                });
                success++;
              });
              db.stats.productTotal = db.products.length;
              result = { total: rows.length, success, failList };
            }
            break;
          }
          case 'getSalesTrend':
            result = mockGetSalesTrend(db, data);
            break;
          case 'manageProduct':
            result = mockManageProduct(db, data);
            break;
          case 'processBeadImage': {
            // 演示桩：真实环境调用 processBeadImage 云函数（Node + sharp 重写 process_img.py）
            // mock 下无法做真实图像处理，直接把传入图作为卡片版回显，装配版留空
            const { imageBase64, metadata, output = 'both', paddingPx = 20 } = data;
            if (!imageBase64) throw new Error('缺少 imageBase64');
            if (!metadata || !(metadata.realWmm > 0) || !(metadata.realHmm > 0)) {
              throw new Error('metadata.realWmm / realHmm 必须为正数');
            }
            if (!['left_right', 'up_down', 'front_back'].includes(metadata.threadDirection)) {
              throw new Error('metadata.threadDirection 必须是 left_right / up_down / front_back 之一');
            }
            if (metadata.threadDirection === 'front_back' && !(metadata.thicknessMm > 0)) {
              throw new Error('front_back 必须提供 thicknessMm');
            }
            const resultData = { kPxPerMm: 8, warning: '（mock 模式未做真实处理，仅回显原图）' };
            if (output === 'card' || output === 'both') {
              resultData.cardImageBase64 = imageBase64;
              resultData.cardSize = { w: 100, h: 100 };
            }
            if (output === 'assembly' || output === 'both') {
              resultData.assemblyImageBase64 = imageBase64;
              resultData.assemblySize = { w: 100, h: 100 };
            }
            if (metadata.threadDirection === 'front_back') {
              resultData.note = `front_back：正面挂载，沿穿线方向厚度=${metadata.thicknessMm}mm（mock 未缩放）`;
            }
            result = resultData;
            break;
          }
          case 'getAdminUsers': {
            const role = data.role || 'buyer';
            if (role === 'supplier') {
              result = { list: db.suppliers, total: db.suppliers.length };
            } else if (role === 'admin') {
              result = { list: db.admins, total: db.admins.length };
            } else {
              // 买家用户：展示用户表字段 + 派生 DIY数/购买数（按 submitUserId=openid 聚合）
              const list = db.users.map(u => {
                const myDiy = db.diyItems.filter(d => d.userId === u.openid);
                return {
                  userId: u.openid,
                  nickname: u.nickname,
                  registerAt: u.firstLoginTime,
                  lastLoginAt: u.lastLoginTime,
                  diyCount: myDiy.length,
                  buyCount: myDiy.filter(d => d.buyTime).length
                };
              });
              result = { list, total: list.length };
            }
            break;
          }
          case 'manageUser': {
            const { role, action } = data;
            if (role === 'supplier') {
              if (action === 'create') {
                db.suppliers.push({ supplierId: data.supplierId, name: data.name || '', account: data.account, loginPassword: data.loginPassword, firstLoginAt: Date.now(), lastLoginAt: Date.now() });
              } else if (action === 'update') {
                const s = db.suppliers.find(x => x.supplierId === data.supplierId);
                if (!s) throw new Error('供应商不存在');
                s.account = data.account; s.loginPassword = data.loginPassword; s.name = data.name || s.name || '';
              } else if (action === 'delete') {
                db.suppliers = db.suppliers.filter(x => x.supplierId !== data.supplierId);
              } else throw new Error('未知操作');
              result = { list: db.suppliers, total: db.suppliers.length };
            } else if (role === 'admin') {
              if (action === 'create') {
                if (db.admins.some(x => x.account === data.account)) throw new Error('账号名已存在');
                db.admins.push({ account: data.account, password: data.password });
              } else if (action === 'update') {
                const a = db.admins.find(x => x.account === data.account);
                if (!a) throw new Error('管理员不存在');
                a.password = data.password;
              } else if (action === 'delete') {
                if (db.admins.length <= 1) throw new Error('至少保留一个管理员');
                db.admins = db.admins.filter(x => x.account !== data.account);
              } else throw new Error('未知操作');
              result = { list: db.admins, total: db.admins.length };
            } else throw new Error('未知角色');
            break;
          }
          case 'getCollectionData': {
            const col = data.collection;
            let rows = [];
            switch (col) {
              case 'users': rows = db.users; break;
              case 'addresses': rows = db.addresses || []; break;
              case 'products': rows = db.products.filter(p => p.type !== 'material'); break;
              case 'materials': rows = db.products.filter(p => p.type === 'material'); break;
              case 'categories': rows = db.categories || []; break;
              case 'diy_items': rows = db.diyItems || []; break;
              case 'favorites': rows = db.favorites || []; break;
              case 'orders': rows = db.orders; break;
              case 'reviews': rows = db.reviews || []; break;
              case 'fortune_info': rows = db.fortune_info || []; break;
              case 'chat_messages': rows = db.chat_messages || []; break;
              case 'suppliers': rows = db.suppliers; break;
              case 'admins': rows = db.admins; break;
              default: rows = [];
            }
            result = { collection: col, list: rows, total: rows.length };
            break;
          }
          default:
            result = {};
        }
        saveDB(db);
        resolve(result);
      } catch(e) { reject(e); }
    }, 200);
  });
}

function mockGetOrders(db, { scope, range, startTime, endTime, status, keyword, pageNum = 1, pageSize = 20, subType }) {
  let list = db.orders.slice();

  if (scope === 'pending') {
    list = list.filter(o => o.status === '待发货');
    if (subType === 'product') list = list.filter(o => o.type === 'product');
    if (subType === 'diy') list = list.filter(o => o.type === 'diy');
  }
  if (scope === 'history') {
    // 历史订单包含全部状态（待发货、运输中、已完成、已取消、待退款、已退款），
    // 仅「待支付」未成交订单不展示给供应商/卖家查看
    list = list.filter(o => o.status !== '待支付');
    if (status) list = list.filter(o => o.status === status);
    const now = Date.now();
    if (range === 'today') {
      const todayStart = new Date(now).setHours(0,0,0,0);
      list = list.filter(o => o.createdAt >= todayStart);
    } else if (range === '30d') {
      list = list.filter(o => o.createdAt >= now - 30 * 86400000);
    }
    if (startTime) list = list.filter(o => o.createdAt >= new Date(startTime).getTime());
    if (endTime) list = list.filter(o => o.createdAt <= new Date(endTime).getTime() + 86400000);
  }
  if (keyword) {
    const kw = keyword.toLowerCase();
    list = list.filter(o => o.orderId.toLowerCase().includes(kw) || o.nickname.toLowerCase().includes(kw));
  }

  // 历史订单按下单时间逆序（由近及远，新订单在最前）；其他页保持原升序
  list.sort((a, b) => {
    const va = a.createdAt || 0, vb = b.createdAt || 0;
    return scope === 'history' ? vb - va : va - vb;
  });

  const total = list.length;
  // 总货款：仅统计 待发货/运输中/已完成（待支付未成交，已取消/待退款/已退款不计）
  const totalGoods = list.reduce((s, o) => ['待支付', '已取消', '待退款', '已退款'].includes(o.status) ? s : s + (o.price * o.qty || 0), 0);
  const start = (pageNum - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);

  return {
    list: paged.map(o => ({ ...o, createdAtText: _fmtTime(o.createdAt), shippedAtText: o.shippedAt ? _fmtTime(o.shippedAt) : null })),
    total, totalGoods: Math.round(totalGoods * 100) / 100, pageNum, pageSize, hasMore: start + pageSize < total
  };
}

// ========== 销售趋势（按天近30天 / 按月近12个月）==========
function mockGetSalesTrend(db, { range = 'day' } = {}) {
  const n = range === 'month' ? 12 : 30;
  const labels = [], orders = [], sales = [], cost = [], shipping = [], profit = [];
  const now = new Date();
  let seed = 20260720;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    if (range === 'month') {
      d.setMonth(d.getMonth() - i);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    } else {
      d.setDate(d.getDate() - i);
      labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const base = range === 'month' ? 880 : 85;
    const o = Math.round(base * (0.6 + rnd() * 0.8));
    const s = Math.round(o * (120 + rnd() * 80));
    const c = Math.round(s * (0.35 + rnd() * 0.15));
    // 总快递费：每单约 9~15 元
    const sh = Math.round(o * (9 + rnd() * 6));
    // 利润 = 销售额 - 货款 - 快递费
    orders.push(o); sales.push(s); cost.push(c); shipping.push(sh); profit.push(s - c - sh);
  }
  return { range, labels, series: { orders, sales, cost, shipping, profit } };
}

function mockUpdateOrder(db, { orderId, action, status, sellerRemark }) {
  const idx = db.orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) throw new Error('订单不存在');
  const o = db.orders[idx];
  if (action === 'ship') {
    // 管理员发货：待发货 → 运输中
    if (o.status !== '待发货') throw new Error('仅待发货订单可发货');
    o.status = '运输中'; o.shippedAt = Date.now(); o.refunded = false;
  } else if (action === 'cancel') {
    // 取消：用户手动/超时/换货（发货前或拦截后）一律「已取消」
    if (o.status === '待支付') o.status = '已取消';
    else if (['待发货', '运输中'].includes(o.status)) o.status = '已取消';
    else throw new Error('当前状态不允许取消');
    o.refunded = false;
  } else if (action === 'intercept') {
    // 拦截快递：标记已拦截（不改动订单状态，保留在退款流程中，供物流详情展示）
    if (o.intercepted) throw new Error('该订单已发起拦截');
    o.intercepted = true;
    o.interceptInfo = o.interceptInfo || '已发起快递拦截，包裹退回后将处理退款';
    o.refunded = false;
  } else if (action === 'applyRefund') {
    // 退换货：待发货/运输中/已完成 → 待退款（退款与换货统一入口）
    if (!['待发货', '运输中', '已完成'].includes(o.status)) throw new Error('当前状态不允许退换货');
    o.status = '待退款'; o.refunded = false;
  } else if (action === 'refund') {
    // 确认退款：待退款（用户退回/未发货直接退/换货原单）→ 已退款
    if (!['待退款', '已取消'].includes(o.status)) throw new Error('当前状态不允许退款');
    o.status = '已退款'; o.refunded = true;
  } else if (action === 'remark') {
    o.sellerRemark = sellerRemark || '';
  } else if (action === 'setStatus') {
    if (['待支付', '待发货', '运输中', '已完成', '已取消', '待退款', '已退款'].includes(status)) o.status = status;
    else throw new Error('非法状态值');
  } else {
    throw new Error('未知操作类型');
  }
  return { orderId, status: o.status, refunded: !!o.refunded };
}

function mockGetProducts(db, { type, categoryId, status, keyword, pageNum = 1, pageSize = 20 }) {
  let list = db.products.slice();
  if (type) list = list.filter(p => p.type === type);
  if (categoryId) list = list.filter(p => p.categoryId === categoryId);
  if (status !== undefined && status !== '' && status !== 'all') list = list.filter(p => (p.status || '在售') === status);
  if (keyword) list = list.filter(p => (p.productName || p.materialName || '').toLowerCase().includes(keyword.toLowerCase()));

  list.sort((a, b) => (b.addTime || 0) - (a.addTime || 0));
  const total = list.length;
  const start = (pageNum - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total, pageNum, pageSize, hasMore: start + pageSize < total };
}

function mockManageProduct(db, { type, action, productId, productName, materialName, categoryId, price, stock, tagline, status, images, costPrice, colorName, colorHex, specSize, threadWidthMm, listImages, displayImages, ids, priceDelta, priceDeltaPct }) {
  const name = productName || materialName;
  if (action === 'create' || action === 'update') {
    const cat = db.categories.find(c => c.id === categoryId);
    const isMaterial = type === 'material';
    if (productId) {
      const idx = db.products.findIndex(p => p.productId === productId);
      if (idx >= 0) {
        Object.assign(db.products[idx], {
          productName: name, type, categoryId,
          categoryName: cat ? cat.name : '', price: +price,
          costPrice: costPrice != null && costPrice !== '' ? +costPrice : db.products[idx].costPrice,
          stock: +stock, tagline,
          status: status || db.products[idx].status || '在售',
          images: images || db.products[idx].images || [],
          colorName: colorName != null ? colorName : db.products[idx].colorName,
          colorHex: colorHex != null ? colorHex : db.products[idx].colorHex,
          specSize: specSize != null ? specSize : db.products[idx].specSize,
          updateTime: Date.now()
        });
        if (isMaterial) {
          db.products[idx].listImages = listImages || db.products[idx].listImages || [];
          db.products[idx].displayImages = displayImages || db.products[idx].displayImages || [];
          db.products[idx].threadWidthMm = threadWidthMm != null && threadWidthMm !== '' ? +threadWidthMm : db.products[idx].threadWidthMm;
        }
      }
    } else {
      const item = {
        productId: 'P' + (++_mockCounter + 100), productName: name, type, categoryId,
        categoryName: cat ? cat.name : '', price: +price,
        costPrice: costPrice != null && costPrice !== '' ? +costPrice : 0,
        stock: +stock, tagline, status: status || '在售',
        images: images || [], colorName: colorName || '', colorHex: colorHex || '', specSize: specSize || '',
        addTime: Date.now(), updateTime: Date.now()
      };
      if (isMaterial) {
        item.listImages = listImages || []; item.displayImages = displayImages || [];
        item.threadWidthMm = threadWidthMm != null && threadWidthMm !== '' ? +threadWidthMm : 0;
      }
      db.products.push(item);
    }
  } else if (action === 'delete') {
    db.products = db.products.filter(p => p.productId !== productId);
  } else if (action === 'batchShelf' || action === 'batchOff') {
    const idArr = (ids || '').split(',');
    const target = action === 'batchShelf' ? '在售' : '已下架';
    db.products.forEach(p => { if (idArr.includes(p.productId)) { p.status = target; p.updateTime = Date.now(); } });
  } else if (action === 'batchStock') {
    const idArr = (ids || '').split(',');
    db.products.forEach(p => {
      if (idArr.includes(p.productId)) { p.stock = Number(stock) || 0; p.updateTime = Date.now(); }
    });
  } else if (action === 'batchPrice') {
    const idArr = (ids || '').split(',');
    db.products.forEach(p => {
      if (idArr.includes(p.productId)) {
        if (price != null) {
          p.price = Number(price);
        } else if (priceDeltaPct != null) {
          p.price = Math.round(p.price * (1 + Number(priceDeltaPct) / 100) * 100) / 100;
        } else {
          p.price = p.price + Number(priceDelta || 0);
        }
        p.updateTime = Date.now();
      }
    });
  }
  db.stats.productTotal = db.products.length;
  saveDB(db);
  return { success: true };
}
