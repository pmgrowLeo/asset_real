const express = require('express');
const cron = require('node-cron');
const YahooFinance = require('yahoo-finance2').default;

const app = express();
const PORT = process.env.PORT || 3100;

// 1. 옵션 오류 수정: 허용되지 않는 속성(timeout) 제거
const yahooFinance = new YahooFinance({ 
    suppressNotices: ['yahooSurvey'] 
});

let priceCache = {
    usdPerOz: 0,
    krwPerGram: 0,
    lastUpdated: "데이터 수집 전",
    status: 'initializing'
};

// 2. 재시도 로직이 포함된 수집 함수
async function updateGoldPrice(retries = 3) {
    try {
        console.log('🔄 [백그라운드] 데이터 수집 시도 중...');
        
        // fetchOptions는 호출 시점에 전달 (헤더만 포함)
        const options = {
            fetchOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            }
        };

        const [gold, exchange] = await Promise.all([
            yahooFinance.quote('GC=F', {}, options),
            yahooFinance.quote('KRW=X', {}, options)
        ]);

        const usdPrice = gold.regularMarketPrice;
        const krwRate = exchange.regularMarketPrice;
        const pricePerGram = (usdPrice * krwRate) / 31.1034768;

        priceCache = {
            usdPerOz: usdPrice,
            krwPerGram: Math.round(pricePerGram),
            lastUpdated: new Date().toLocaleString(),
            status: 'success'
        };
        console.log(`✅ 업데이트 완료: ₩${priceCache.krwPerGram}/g`);

    } catch (error) {
        console.error(`❌ 에러 발생: ${error.message}`);
        
        // 429 에러 발생 시 재시도 (10초 대기 후)
        if (retries > 0 && error.message.includes('429')) {
            console.log(`⚠️ 차단됨. 10초 후 다시 시도합니다... (남은 횟수: ${retries})`);
            setTimeout(() => updateGoldPrice(retries - 1), 10000);
        } else {
            priceCache.status = 'error';
        }
    }
}

cron.schedule('*/10 * * * *', () => updateGoldPrice());
updateGoldPrice();

app.get('/api/gold', (req, res) => res.json(priceCache));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버 가동 중: http://localhost:${PORT}/api/gold`);
});