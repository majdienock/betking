import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBackendOrigin } from './backend-url';

afterEach(() => vi.unstubAllGlobals());

describe('BetKing API routing', () => {
  it.each(['betking.site', 'www.betking.site', 'betking-preview.vercel.app'])(
    'routes frontend %s to the dedicated API', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '', origin: `https://${hostname}` } });
      expect(getBackendOrigin()).toBe('https://api.betking.site');
    }
  );

  it.each(['localhost', '127.0.0.1', '192.168.1.20'])(
    'keeps local frontend %s on its local API', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '4200', origin: `http://${hostname}:4200` } });
      expect(getBackendOrigin()).toBe(`http://${hostname}:3000`);
    }
  );

  it.each(['api.betking.site', 'betking-service.onrender.com'])(
    'keeps direct backend %s on its own origin', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '', origin: `https://${hostname}` } });
      expect(getBackendOrigin()).toBe(`https://${hostname}`);
    }
  );
});
