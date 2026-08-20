// FoxArt AI - analyze-status 함수 (동기, 빠름)
// 브라우저가 jobId로 "분석 다 됐나요?"를 물어보면
// Netlify Blobs에서 결과를 꺼내 알려줍니다.

const { getStore } = require('@netlify/blobs');

// Blobs 저장소를 여는 헬퍼 (background 함수와 동일).
function openStore() {
  const opts = { name: 'foxart-analysis', consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: opts.name, consistency: opts.consistency, siteID: siteID, token: token });
  }
  return getStore(opts);
}

exports.handler = async function (event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // jobId는 쿼리스트링(?jobId=) 또는 POST 본문 둘 다 지원
  let jobId = '';
  if (event.queryStringParameters && event.queryStringParameters.jobId) {
    jobId = event.queryStringParameters.jobId;
  } else if (event.body) {
    try { jobId = (JSON.parse(event.body) || {}).jobId || ''; } catch (e) {}
  }

  if (!jobId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ status: 'error', error: 'jobId 누락' }) };
  }

  try {
    const store = openStore();
    const data = await store.get(jobId, { type: 'json' });

    if (!data) {
      // 아직 백그라운드 함수가 결과를 저장하기 전 → 진행 중
      console.log('[STATUS] jobId=' + jobId + ' → 아직 없음(pending)');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'pending' }) };
    }

    // 결과가 있으면 그대로 전달 (done 또는 error)
    console.log('[STATUS] jobId=' + jobId + ' → 찾음 status=' + (data.status || '?'));
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };

  } catch (err) {
    console.log('[STATUS] jobId=' + jobId + ' → 조회 예외: ' + String(err && err.message || err));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'pending' }) };
  }
};
