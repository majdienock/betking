import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBackendOrigin } from './backend-url';

afterEach(() => vi.unstubAllGlobals());

describe('BetPesa API routing', () => {
  it.each(['betpesa.site', 'www.betpesa.site', 'betpesa-preview.vercel.app'])(
    'routes frontend %s to the dedicated API', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '', origin: `https://${hostname}` } });
      expect(getBackendOrigin()).toBe('https://api.betpesa.site');
    }
  );

  it.each(['localhost', '127.0.0.1', '192.168.1.20'])(
    'keeps local frontend %s on its local API', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '4200', origin: `http://${hostname}:4200` } });
      expect(getBackendOrigin()).toBe(`http://${hostname}:3000`);
    }
  );

  it.each(['api.betpesa.site', 'betpesa-service.onrender.com'])(
    'keeps direct backend %s on its own origin', hostname => {
      vi.stubGlobal('window', { location: { hostname, port: '', origin: `https://${hostname}` } });
      expect(getBackendOrigin()).toBe(`https://${hostname}`);
    }
  );
});
