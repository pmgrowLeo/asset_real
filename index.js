const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const cron = require('node-cron');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3100;

// 1. 통합 캐시 구조
let priceCache = {
    gold: { usdPerOz: 0, krwPerGram: 0, lastUpdated: "데이터 수집 중...", status: 'initializing' },
    stocks: {} 
};

// 브라우저처럼 보이게 하는 헤더
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://stock.naver.com/'
};

/**
 * 주식 데이터 수집 함수 (종목 코드 기반)
 */
async function fetchStockDataByCode(inputCode) {
    try {
        let finalCode = inputCode.toUpperCase();
        const isEnglish = /^[A-Z.]+$/.test(finalCode);

		const rfMap = { "1": "↑", "2": "▲", "3": "-", "4": "↓", "5": "▼" };

        if (isEnglish) {
            // [해외 주식] 사용자가 요청한 전용 basic API 활용
            const overseasUrl = `https://api.stock.naver.com/stock/${finalCode}/basic`;
            const res = await axios.get(overseasUrl, { headers });
            const data = res.data;
            
            //https://api.stock.naver.com/stock/NVDA.O/price or basic
            //https://api.stock.naver.com/stock/XRPT.O/price or basic

            if (!data || !data.stockName) {
                console.error(`❌ [Overseas Error] 데이터를 찾을 수 없음: ${finalCode}.O`);
                return null;
            }

			const totalInfos = data.stockItemTotalInfos;
			const highInfo = totalInfos.find(info => info.code === 'highPrice');
            const lowInfo = totalInfos.find(info => info.code === 'lowPrice');

            return {
                name: data.stockName,
                code: data.symbol,
                price: data.closePrice,
                currencyType: data.currencyType.code,
                change: `${rfMap[data.compareToPreviousPrice.code] || ""} ${data.compareToPreviousClosePrice} (${data.fluctuationsRatio}%)`,
                high: (highInfo ? highInfo.value : "N/A"),
                low: (lowInfo ? lowInfo.value : "N/A"),
                updatedAt: new Date().toLocaleString()
            };

        } else {
            // [국내 주식] 기존 폴링 API 활용 (EUC-KR 처리 포함)
            const domesticUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${finalCode}`;
            const priceRes = await axios.get(domesticUrl, { headers, responseType: 'arraybuffer' });
            
            const decodedData = iconv.decode(priceRes.data, 'euc-kr');
            const jsonResult = JSON.parse(decodedData);
            const data = jsonResult.result.areas[0].datas[0];

            if (!data) return null;

            return {
                name: data.nm,
                code: finalCode,
                price: data.nv.toLocaleString(),
                currencyType : "원",
                change: `${rfMap[data.rf] || ""} ${data.cv.toLocaleString()} (${data.cr}%)`,
                high: data.hv.toLocaleString(),
                low: data.lv.toLocaleString(),
                updatedAt: new Date().toLocaleString()
            };
        }
    } catch (error) {
        console.error(`[Stock Error] ${inputCode}:`, error.message);
        return null;
    }
}

/**
 * 금 시세 수집 함수 (기존 유지하되 한글 깨짐 방지 처리)
 */
async function getGoldPrice() {
    try {
        const goldUrl = 'https://search.naver.com/search.naver?query=%EA%B5%AD%EC%A0%9C%EA%B8%88%EC%8B%9C%EC%84%B8';
        const goldRes = await axios.get(goldUrl, { headers, responseType: 'arraybuffer' });
        // 네이버 검색결과는 utf-8 이므로 정확히 디코딩
        const $ = cheerio.load(iconv.decode(goldRes.data, 'utf-8'));
        
        const usdText = $('.spt_con strong').first().text() || $('._price_value').first().text();
        const usdPerOz = parseFloat(usdText.replace(/[^0-9.]/g, ''));

        const exUrl = 'https://search.naver.com/search.naver?query=%ED%99%98%EC%9C%A8';
        const exRes = await axios.get(exUrl, { headers, responseType: 'arraybuffer' });
        const ex$ = cheerio.load(iconv.decode(exRes.data, 'utf-8'));
        const krwRate = parseFloat(ex$('.spt_con strong').first().text().replace(/[^0-9.]/g, ''));

        if (usdPerOz && krwRate) {
            priceCache.gold = {
                usdPerOz,
                krwPerGram: Math.round((usdPerOz * krwRate) / 31.1034768),
                lastUpdated: new Date().toLocaleString(),
                status: 'success'
            };
        }
    } catch (e) { console.error('금 수집 실패'); }
}

// 스케줄러
cron.schedule('*/5 * * * *', async () => {
    const stockCodes = Object.keys(priceCache.stocks);
    for (const code of stockCodes) {
        const newData = await fetchStockDataByCode(code);
        if (newData) priceCache.stocks[code] = newData;
    }
});
cron.schedule('*/10 * * * *', getGoldPrice);

// API 라우트
app.get('/api/gold', (req, res) => res.json(priceCache.gold));

app.get('/api/stock/:code', async (req, res) => {
    const code = req.params.code;
    
    // 캐시 확인
    if (priceCache.stocks[code]) {
        return res.json({ ...priceCache.stocks[code], source: 'cache' });
    }

    const stockData = await fetchStockDataByCode(code);
    if (stockData) {
        priceCache.stocks[code] = stockData;
        res.json({ ...stockData, source: 'network' });
    } else {
        res.status(404).json({ success: false, message: "코드를 확인하세요." });
    }
});

getGoldPrice();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});

// Render Keep-Alive 핑
const MY_RENDER_URL = "https://asset-real.onrender.com/api/gold";
cron.schedule('*/10 * * * *', async () => {
    try {
        await axios.get(MY_RENDER_URL, { timeout: 5000 });
        console.log(`📡 [Keep-Alive] 핑 성공`);
    } catch (err) {
        console.error(`📡 [Keep-Alive] 핑 실패: ${err.message}`);
    }
});

