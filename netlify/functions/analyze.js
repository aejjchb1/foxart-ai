// FoxArt AI - analyze 함수
// 브라우저(index.html)의 요청을 받아 Anthropic API로 안전하게 전달합니다.
// API 키는 이 서버(Netlify 환경변수)에만 있고, 브라우저에는 절대 노출되지 않습니다.

exports.handler = async function (event) {
  // CORS 헤더 (같은 도메인이라 사실 불필요하지만 안전하게 포함)
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // 브라우저 사전 요청(preflight) 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // POST만 허용
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // API 키 확인
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하세요.' })
    };
  }

  // 요청 본문 파싱
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }) };
  }

  // 브라우저가 보낸 값 사용 (기본값 보강)
  const body = {
    model: payload.model || 'claude-sonnet-4-6',
    max_tokens: payload.max_tokens || 4000,
    messages: payload.messages || []
  };
  if (payload.system) body.system = payload.system;

  try {
    // ★ baseURL을 명시적으로 지정 (Netlify AI Gateway가 가로채는 것을 방지)
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const text = await resp.text();

    // Anthropic이 오류를 주면 그대로 전달 (디버깅에 도움)
    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: CORS,
        body: JSON.stringify({ error: 'Anthropic API 오류', status: resp.status, detail: text })
      };
    }

    // 성공 응답 그대로 전달
    return { statusCode: 200, headers: CORS, body: text };

  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: '서버에서 Anthropic 연결 실패', detail: String(err && err.message || err) })
    };
  }
};
