const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

// 자신의 Render 주소 (실제 주소로 확인 필요)
const MY_RENDER_URL = "https://asset-real.onrender.com/api/gold";

let priceCache = {
    usdPerOz: 0,
    krwPerGram: 0,
    lastUpdated: "데이터 수집 중...",
    status: 'initializing'
};

async function getGoldPrice() {
    try {
        console.log('🔄 [System] 네이버 금융 데이터 수집 시도...');
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' };

        const goldUrl = 'https://finance.naver.com/marketindex/worldGoldDetail.naver?marketindexCd=CMDT_GC&fdtc=2';
        const goldRes = await axios.get(goldUrl, { headers, responseType: 'arraybuffer' });
        const goldHtml = iconv.decode(goldRes.data, 'euc-kr');
        const $gold = cheerio.load(goldHtml);
        const usdText = $gold('div.no_today span.blind').first().text();
        const usdPerOz = parseFloat(usdText.replace(/[^0-9.]/g, ''));

        const exUrl = 'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW';
        const exRes = await axios.get(exUrl, { headers, responseType: 'arraybuffer' });
        const exHtml = iconv.decode(exRes.data, 'euc-kr');
        const $ex = cheerio.load(exHtml);
        const exText = $ex('div.no_today span.blind').first().text();
        const krwRate = parseFloat(exText.replace(/[^0-9.]/g, ''));

        if (isNaN(usdPerOz) || isNaN(krwRate)) throw new Error("데이터 파싱 실패");

        const pricePerGram = (usdPerOz * krwRate) / 31.1034768;
        priceCache = {
            usdPerOz,
            krwPerGram: Math.round(pricePerGram),
            lastUpdated: new Date().toLocaleString(),
            status: 'success'
        };
        console.log(`✅ 업데이트 성공: ₩${priceCache.krwPerGram}/g`);
    } catch (error) {
        console.error('❌ 수집 에러:', error.message);
        priceCache.status = 'error';
    }
}

// 1. 10분마다 금 시세 업데이트
cron.schedule('*/10 * * * *', getGoldPrice);

// 2. 서버를 깨우기 위한 셀프 핑 (10분마다 실행)
cron.schedule('*/10 * * * *', async () => {
    try {
        console.log('📡 [Keep-Alive] 서버 수면 방지 핑 전송...');
        await axios.get(MY_RENDER_URL);
    } catch (err) {
        console.error('📡 [Keep-Alive] 핑 실패:', err.message);
    }
});

getGoldPrice();

app.get('/api/gold', (req, res) => res.json(priceCache));
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 서버 가동 중: 포트 ${PORT}`));