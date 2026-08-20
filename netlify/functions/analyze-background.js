// FoxArt AI - analyze-background 함수 (백그라운드 함수, 최대 15분 실행)
// 파일명이 '-background'로 끝나면 Netlify가 백그라운드 함수로 인식합니다.
// 브라우저의 요청을 받아 즉시 202를 반환하고, 뒤에서 Anthropic 분석을 수행한 뒤
// 결과를 Netlify Blobs에 저장합니다. 브라우저는 analyze-status로 결과를 가져갑니다.

const { getStore } = require('@netlify/blobs');

// Blobs 저장소를 여는 헬퍼.
// 환경변수에 siteID/token이 있으면 그것을 명시적으로 사용(가장 확실),
// 없으면 자동 구성으로 시도합니다.
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
  // POST가 아니면 무시 (백그라운드 함수는 응답값이 브라우저로 안 감)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 요청 본문 파싱
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  // 브라우저가 보낸 작업 ID (결과를 저장/조회할 키)
  const jobId = payload.jobId;
  if (!jobId) {
    return { statusCode: 400, body: 'jobId 누락' };
  }

  // Blobs 저장소 열기. 환경이 자동 구성 안 되는 경우를 대비해 siteID/token을 명시.
  const store = openStore();

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    await store.setJSON(jobId, { status: 'error', error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
    return { statusCode: 202, body: '' };
  }

  // Anthropic 요청 본문 구성
  const body = {
    model: payload.model || 'claude-sonnet-5',
    max_tokens: payload.max_tokens || 4000,
    messages: payload.messages || []
  };
  if (payload.system) body.system = payload.system;

  try {
    console.log('[BG] 분석 시작 jobId=' + jobId + ' model=' + body.model + ' messages=' + (body.messages ? body.messages.length : 0));
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
    console.log('[BG] API 응답 status=' + resp.status + ' 길이=' + (text ? text.length : 0));

    if (!resp.ok) {
      console.log('[BG] API 오류 본문 앞부분: ' + (text ? text.slice(0, 300) : '(빈 응답)'));
      await store.setJSON(jobId, { status: 'error', error: 'Anthropic API 오류 (' + resp.status + ')', detail: text });
      console.log('[BG] 저장 완료(error) jobId=' + jobId);
      return { statusCode: 202, body: '' };
    }

    // 응답 안에 실제 분석 텍스트(content[0].text)가 있는지 확인
    let hasContent = false;
    try {
      const parsed = JSON.parse(text);
      hasContent = !!(parsed && parsed.content && parsed.content[0] && parsed.content[0].text);
      console.log('[BG] content 존재=' + hasContent + (hasContent ? ' 텍스트길이=' + parsed.content[0].text.length : ' 응답앞부분=' + text.slice(0, 300)));
    } catch (pe) {
      console.log('[BG] 응답 JSON 파싱 실패: ' + text.slice(0, 300));
    }

    if (!hasContent) {
      await store.setJSON(jobId, { status: 'error', error: 'AI 응답에 분석 내용이 없습니다', detail: text.slice(0, 500) });
      console.log('[BG] 저장 완료(내용없음) jobId=' + jobId);
      return { statusCode: 202, body: '' };
    }

    // 성공: 결과를 그대로 저장
    await store.setJSON(jobId, { status: 'done', result: text });
    console.log('[BG] 저장 완료(done) jobId=' + jobId);
    return { statusCode: 202, body: '' };

  } catch (err) {
    console.log('[BG] 예외 발생: ' + String(err && err.message || err));
    await store.setJSON(jobId, { status: 'error', error: '서버에서 Anthropic 연결 실패', detail: String(err && err.message || err) });
    return { statusCode: 202, body: '' };
  }
};
