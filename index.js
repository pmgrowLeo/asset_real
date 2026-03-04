const express = require('express');
const cron = require('node-cron');
const YahooFinance = require('yahoo-finance2').default;

const app = express();
const PORT = process.env.PORT || 3100; 



// 야후 파이낸스 인스턴스 (알림 끄기 설정)
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// [핵심] 서버 메모리에 데이터를 저장할 변수
let priceCache = {
    usdPerOz: 0,
    krwPerGram: 0,
    lastUpdated: "서버 시작 중...",
    status: 'initializing'
};

// 금 시세를 가져와서 'priceCache' 변수 값만 바꾸는 함수
async function updateGoldPrice() {
    try {
        console.log('🔄 [백그라운드] 야후 데이터 수집 시작...');
        const [gold, exchange] = await Promise.all([
            yahooFinance.quote('GC=F'),
            yahooFinance.quote('KRW=X')
        ]);

        const usdPrice = gold.regularMarketPrice;
        const krwRate = exchange.regularMarketPrice;
        const pricePerGram = (usdPrice * krwRate) / 31.1034768;

        // 전역 변수 priceCache 업데이트
        priceCache = {
            usdPerOz: usdPrice,
            krwPerGram: Math.round(pricePerGram),
            lastUpdated: new Date().toLocaleString(),
            status: 'success'
        };
        console.log(`✅ [백그라운드] 업데이트 완료: ₩${priceCache.krwPerGram}/g`);
		console.log(priceCache);
    } catch (error) {
        // 여기서 에러가 나도 브라우저엔 영향을 주지 않음
        console.error('❌ [백그라운드] 업데이트 에러:', error.message);
        priceCache.status = 'error';
    }
}

// 5분마다 실행
cron.schedule('*/5 * * * *', updateGoldPrice);
updateGoldPrice(); // 서버 켜질 때 즉시 실행

// [가장 중요] 사용자가 접속했을 때 처리
app.get('/api/gold', (req, res) => {
    console.log('📱 [API] 클라이언트가 데이터를 요청함');
    
    // 💡 절대 yahooFinance.quote(...)를 여기서 호출하지 마세요.
    // 오직 서버가 미리 준비해둔 'priceCache' 객체만 보냅니다.
    res.json(priceCache); 
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버가 실행되었습니다. 포트: ${PORT}`);
});