const ORIGINAL_SNIPPET = "const result=classify(app.draft); if(!result.top) return;\n      const extra=document.getElementById('aiUserContext')?.value||'';\n      const payload=buildAiPayload(result, extra);\n      aiReview={busy:true,result:null,error:'',payloadKey:payload.signature}; renderAiOutput();\n      try{\n        const resp=await fetch('/api/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});\n        let data={}; try{ data=await resp.json(); }catch(e){}\n        if(!resp.ok){ throw new Error(data.error || ('Request failed with HTTP '+resp.status)); }";

const PASSWORD_SNIPPET = "const result=classify(app.draft); if(!result.top) return;\n      const password=window.prompt('This feature requires entering the password');\n      if(password===null) return;\n      const extra=document.getElementById('aiUserContext')?.value||'';\n      const payload=buildAiPayload(result, extra);\n      payload.aiFeaturePassword=password;\n      aiReview={busy:true,result:null,error:'',payloadKey:payload.signature}; renderAiOutput();\n      try{\n        const resp=await fetch('/api/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});\n        let data={}; try{ data=await resp.json(); }catch(e){}\n        if(resp.status===401){ throw new Error(data.error || 'Incorrect password.'); }\n        if(!resp.ok){ throw new Error(data.error || ('Request failed with HTTP '+resp.status)); }";

export async function middleware(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('__mw_bypass') === '1') {
    return;
  }

  const upstreamUrl = new URL('/index.html', url.origin);
  upstreamUrl.searchParams.set('__mw_bypass', '1');

  const upstream = await fetch(upstreamUrl);
  let html = await upstream.text();

  if (html.includes(ORIGINAL_SNIPPET)) {
    html = html.replace(ORIGINAL_SNIPPET, PASSWORD_SNIPPET);
  }

  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(html, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export const config = {
  matcher: ['/', '/index.html']
};
