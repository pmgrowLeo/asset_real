const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3100;

let priceCache = {
    usdPerOz: 0,
    krwPerGram: 0,
    lastUpdated: "데이터 수집 중...",
    status: 'initializing'
};

async function getGoldPrice() {
    try {
        console.log('🔄 [System] 네이버 검색 기반 데이터 수집 시작...');

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        };

        // 1. 국제 금 시세 (네이버 검색 결과 페이지)
        const goldUrl = 'https://search.naver.com/search.naver?query=%EA%B5%AD%EC%A0%9C%EA%B8%88%EC%8B%9C%EC%84%B8';
        const goldRes = await axios.get(goldUrl, { headers, responseType: 'arraybuffer' });
        const goldHtml = iconv.decode(goldRes.data, 'utf-8'); // 검색 페이지는 보통 UTF-8입니다.
        const $gold = cheerio.load(goldHtml);
        
        // 검색 결과 카드에서 가격 추출
        const usdPriceText = $gold('.spt_con strong').first().text() || $gold('._price_value').first().text();
        const usdPerOz = parseFloat(usdPriceText.replace(/[^0-9.]/g, ''));

        // 2. 환율 (네이버 검색 결과 페이지)
        const exUrl = 'https://search.naver.com/search.naver?query=%ED%99%98%EC%9C%A8';
        const exRes = await axios.get(exUrl, { headers, responseType: 'arraybuffer' });
        const exHtml = iconv.decode(exRes.data, 'utf-8');
        const $ex = cheerio.load(exHtml);
        
        const krwRateText = $ex('.spt_con strong').first().text() || $ex('.rate_tlt strong').first().text();
        const krwRate = parseFloat(krwRateText.replace(/[^0-9.]/g, ''));

        // 3. 검증 및 계산
        if (!usdPerOz || !krwRate) {
            throw new Error(`데이터 추출 실패 - Gold: ${usdPerOz}, Ex: ${krwRate}`);
        }

        const pricePerGram = (usdPerOz * krwRate) / 31.1034768;

        priceCache = {
            usdPerOz: usdPerOz,
            krwPerGram: Math.round(pricePerGram),
            lastUpdated: new Date().toLocaleString(),
            status: 'success'
        };

        console.log(`✅ 업데이트 성공: ₩${priceCache.krwPerGram}/g ($${usdPerOz})`);
    } catch (error) {
        console.error('❌ 수집 실패:', error.message);
        priceCache.status = 'error';
    }
}

cron.schedule('*/10 * * * *', getGoldPrice);
getGoldPrice();

app.get('/api/gold', (req, res) => res.json(priceCache));

// [수정 포인트 1] 주소 끝에 슬래시(/) 등 오타가 없는지 다시 확인하세요.
const MY_RENDER_URL = "https://asset-real.onrender.com/api/gold";

// [수정 포인트 2] 핑 주기를 1분에서 5~10분 사이로 조정하는 것이 좋습니다.
// 1분은 너무 잦아 Render 측에서 거부할 수 있습니다.
cron.schedule('*/10 * * * *', async () => {
    try {
        // [수정 포인트 3] 타임아웃 설정을 추가하여 요청이 무한 대기하지 않게 합니다.
        const response = await axios.get(MY_RENDER_URL, { timeout: 5000 });
        console.log(`📡 [Keep-Alive] 핑 성공 - 상태: ${response.status}`);
    } catch (err) {
        // [수정 포인트 4] 에러 로그를 더 자세히 찍어 원인을 파악합니다.
        console.error(`📡 [Keep-Alive] 핑 실패: ${err.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}/api/gold`);
});

