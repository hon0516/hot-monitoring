import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { env } from './env.js';

let configured = false;

export function configureFetchProxy() {
  if (configured) {
    return true;
  }

  if (!env.outboundHttpProxy && !env.outboundHttpsProxy) {
    return false;
  }

  const options = {
    ...(env.outboundHttpProxy ? { httpProxy: env.outboundHttpProxy } : {}),
    ...(env.outboundHttpsProxy ? { httpsProxy: env.outboundHttpsProxy } : {}),
    ...(env.outboundNoProxy ? { noProxy: env.outboundNoProxy } : {})
  };

  setGlobalDispatcher(new EnvHttpProxyAgent(options));
  configured = true;
  console.log('[network] 出站 HTTP(S) 代理已启用');
  return true;
}
