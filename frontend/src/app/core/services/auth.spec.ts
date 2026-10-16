import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it.each(['login', 'register'] as const)('stops a stalled %s request and returns a retry message', operation => {
    vi.useFakeTimers();
    const failure = vi.fn();
    service[operation]({ username: 'test-user', password: 'test-password' }).subscribe({ error: failure });
    const request = http.expectOne(req => req.url.endsWith('/' + operation));
    vi.advanceTimersByTime(30001);
    expect(request.cancelled).toBe(true);
    expect(failure).toHaveBeenCalledWith({ status: 0,
      message: 'The server is taking too long to respond. Please try again.' });
  });

  it('preserves real authentication errors instead of calling them network failures', () => {
    const failure = vi.fn();
    service.login({ username: 'test-user', password: 'wrong-password' }).subscribe({ error: failure });
    http.expectOne(req => req.url.endsWith('/login')).flush({ error: 'Invalid password' },
      { status: 401, statusText: 'Unauthorized' });
    expect(failure).toHaveBeenCalledWith({ status: 401, message: 'Invalid password' });
  });
});
